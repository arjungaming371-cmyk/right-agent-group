import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole, type Role } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const VALID_BUILTIN_ROLES: Role[] = ["admin", "agent", "viewer", "developer", "branch_manager"]

async function getBaseRole(roleId: string): Promise<Role> {
  const norm = String(roleId || "").trim().toLowerCase()
  if (VALID_BUILTIN_ROLES.includes(norm as Role)) {
    return norm as Role
  }
  try {
    const res = await query(`SELECT config FROM form_configs WHERE id = 'custom_roles_config'`)
    if (res.rowCount && res.rows[0]?.config?.roles) {
      // Case-insensitive on id AND label: "Admin" must resolve to the role
      // whose id is "admin" — a case mismatch let a crafted role name slip
      // past every gate and escalate at login time (2026-09-26 audit).
      const needle = norm
      const found = res.rows[0].config.roles.find(
        (r: any) => String(r?.id || "").toLowerCase() === needle || String(r?.label || "").toLowerCase() === needle
      )
      if (found?.baseRole) return found.baseRole as Role
    }
  } catch {}
  return "agent"
}

// Team access management. Admin/developer manage everyone; branch managers
// can see and manage teammates inside their own branch.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // Admin sees all branches; branch_manager sees only teammates in their own branch.
  const isBM = session.role === "branch_manager"

  const r = await query(
    `SELECT ae.email, ae.added_by, ae.role, ae.created_at, ae.branch_id, ae.display_name, ae.allowed_modules,
            tp.display_name AS profile_name, tp.avatar_url,
            b.name AS branch_name, b.code AS branch_code
       FROM allowed_emails ae
       LEFT JOIN branches b ON b.id = ae.branch_id
       LEFT JOIN team_profiles tp ON lower(tp.email) = lower(ae.email)
      WHERE ae.role != 'developer' AND ($1::uuid IS NULL OR ae.branch_id = $1) ORDER BY ae.created_at DESC`,
    [isBM ? session.branchId || null : null]
  )

  const branches = isBM && session.branchId
    ? await query(`SELECT id, name, code FROM branches WHERE id = $1 ORDER BY name`, [session.branchId])
    : await query(`SELECT id, name, code FROM branches ORDER BY name`)

  return NextResponse.json({ emails: r.rows, you: session.email, branches: branches.rows, isBranchManager: isBM })
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }
  const email = String(body?.email || "").trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid email address" }, { status: 400 })
  }

  const isBM = session.role === "branch_manager"
  const roleInput = String(body?.role || "agent").trim()
  // SECURITY (2026-09-26 audit): baseRole is DERVED, never trusted from the
  // body. A branch manager could previously send {role:"developer",
  // baseRole:"agent"} — the gate validated baseRole while the INSERT wrote
  // the raw role string, minting a full-access developer account (the
  // single-developer cap only fired when baseRole === "developer").
  // body.baseRole is honored ONLY for trusted callers (admin/developer)
  // declaring the base of a NEW custom title; the effective base of the
  // role we actually store is recomputed below and drives every gate.
  const baseRole: Role = (!isBM && body?.baseRole && VALID_BUILTIN_ROLES.includes(body.baseRole))
    ? (body.baseRole as Role)
    : await getBaseRole(roleInput)

  // Branch managers can only add agents or viewers to their own branch
  if (isBM) {
    if (baseRole !== "agent" && baseRole !== "viewer") {
      return NextResponse.json({ error: "Branch managers can only add Loan Officers and Viewers to their branch." }, { status: 403 })
    }
    if (!session.branchId) {
      return NextResponse.json({ error: "Branch manager session is not pinned to a branch." }, { status: 400 })
    }
  }

  // Verify existing target email to prevent cross-branch overwrites or privilege escalation
  const existingTarget = await query(`SELECT role, branch_id FROM allowed_emails WHERE lower(email) = $1 LIMIT 1`, [email])
  if (existingTarget.rowCount) {
    const targetBranch = existingTarget.rows[0].branch_id
    const targetRole = existingTarget.rows[0].role
    const targetBaseRole = await getBaseRole(targetRole)
    if (isBM) {
      if (targetBranch && targetBranch !== session.branchId) {
        return NextResponse.json({ error: "Cannot overwrite an account belonging to another branch." }, { status: 403 })
      }
      if (targetBaseRole === "admin" || targetBaseRole === "developer" || targetBaseRole === "branch_manager") {
        return NextResponse.json({ error: "Cannot modify this account." }, { status: 403 })
      }
    }
  }

  const displayName = String(body?.displayName || body?.display_name || "").trim()

  // Multi-branch binding
  let branchId: string | null = isBM ? (session.branchId || null) : null
  if (!isBM && body?.branch_id) {
    const b = await query(`SELECT id FROM branches WHERE id = $1`, [String(body.branch_id)])
    if (!b.rowCount) return NextResponse.json({ error: "unknown branch" }, { status: 400 })
    branchId = b.rows[0].id
  }
  let finalRole = roleInput
  const adminEmailEnv = (process.env.ADMIN_EMAIL || "").toLowerCase()
  if (email === adminEmailEnv) {
    finalRole = "admin"
  }
  // The effective base of the role we will ACTUALLY store — the single
  // source of truth for every privilege gate below, immune to whatever the
  // client declared in body.baseRole.
  const effBase = await getBaseRole(finalRole)
  if (effBase === "branch_manager" && !branchId) {
    return NextResponse.json({ error: "branch_manager requires a branch" }, { status: 400 })
  }
  if (isBM && effBase !== "agent" && effBase !== "viewer") {
    return NextResponse.json({ error: "Branch managers can only assign Loan Officer or Viewer roles." }, { status: 403 })
  }
  if (email !== adminEmailEnv && effBase === "admin") {
    const existingAdmins = await query(
      `SELECT COUNT(*)::int AS n FROM allowed_emails WHERE role = 'admin' AND lower(email) != $1`,
      [email]
    )
    if (existingAdmins.rows[0].n >= 5) {
      return NextResponse.json(
        { error: "Maximum number of admin accounts (5) reached. Remove an existing admin first, or assign a different role." },
        { status: 400 }
      )
    }
  } else if (email !== adminEmailEnv && effBase === "developer") {
    const existingDevs = await query(
      `SELECT COUNT(*)::int AS n FROM allowed_emails WHERE role = 'developer' AND lower(email) != $1`,
      [email]
    )
    if (existingDevs.rows[0].n >= 1) {
      return NextResponse.json(
        { error: "That role already has the maximum number of accounts. Remove the existing one first, or assign a different role." },
        { status: 400 }
      )
    }
  }

  const allowedModules = Array.isArray(body?.allowed_modules)
    ? body.allowed_modules.map((m: any) => String(m))
    : null

  await query(
    `INSERT INTO allowed_emails (email, added_by, role, branch_id, display_name, allowed_modules)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET role = $3, branch_id = $4, display_name = COALESCE(NULLIF($5, ''), allowed_emails.display_name), allowed_modules = $6`,
    [email, session.email, finalRole, branchId, displayName || null, allowedModules]
  )

  if (displayName) {
    await query(
      `INSERT INTO team_profiles (email, display_name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET display_name = $2`,
      [email, displayName]
    )
  }

  // Auto-register custom role definition if it's a new custom title
  if (!VALID_BUILTIN_ROLES.includes(finalRole as Role)) {
    try {
      const id = finalRole.toLowerCase().replace(/[^a-z0-9]+/g, "_")
      const cfRes = await query(`SELECT config FROM form_configs WHERE id = 'custom_roles_config'`)
      let rolesList: any[] = []
      if (cfRes.rowCount && cfRes.rows[0]?.config?.roles) {
        rolesList = cfRes.rows[0].config.roles
      }
      if (!rolesList.some((r: any) => r.id === id || r.label.toLowerCase() === finalRole.toLowerCase())) {
        rolesList.push({
          id,
          label: finalRole,
          desc: `Custom ${baseRole.replace("_", " ")} role`,
          color: "var(--accent-violet)",
          baseRole: isBM ? effBase : baseRole,
          isDefault: false,
          defaultModules: allowedModules || ["analytics", "leads", "loans", "voice", "whatsapp", "comms", "knowledge"],
        })
        await query(
          `INSERT INTO form_configs (id, config) VALUES ('custom_roles_config', $1)
           ON CONFLICT (id) DO UPDATE SET config = $1, updated_at = now()`,
          [JSON.stringify({ roles: rolesList })]
        )
      }
    } catch {}
  }

  logAudit("team member added", session.email, { email, role: finalRole, baseRole: effBase, branchId })
  return NextResponse.json({ ok: true, email, role: finalRole, baseRole: effBase, branch_id: branchId, displayName, allowed_modules: allowedModules })
}

export async function PATCH(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const email = String(body?.email || "").trim().toLowerCase()
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 })

  const isBM = session.role === "branch_manager"
  if (isBM && !session.branchId) {
    // A null-pinned BM must not pass the branch_id !== session.branchId
    // checks below (NULL != NULL is true in SQL, and the JS comparison here
    // would compare against null) — fail closed instead.
    return NextResponse.json({ error: "Branch manager session is not pinned to a branch." }, { status: 400 })
  }
  if (isBM) {
    // Verify target belongs to BM's branch and is an agent or viewer
    const target = await query(`SELECT role, branch_id FROM allowed_emails WHERE lower(email) = $1`, [email])
    if (!target.rowCount || target.rows[0].branch_id !== session.branchId) {
      return NextResponse.json({ error: "Teammate not found in your branch." }, { status: 404 })
    }
    const targetBaseRole = await getBaseRole(target.rows[0].role)
    if (targetBaseRole !== "agent" && targetBaseRole !== "viewer") {
      return NextResponse.json({ error: "Cannot modify this member." }, { status: 403 })
    }
    if (body?.role) {
      // SECURITY (2026-09-26 audit): derived from the role being written —
      // body.baseRole is NOT trusted (a BM could declare baseRole:"agent"
      // while writing role:"developer" onto an own-branch agent).
      const newBaseRole = await getBaseRole(String(body.role))
      if (newBaseRole !== "agent" && newBaseRole !== "viewer") {
        return NextResponse.json({ error: "Branch managers can only assign Loan Officer or Viewer roles." }, { status: 403 })
      }
    }
  }

  const roleInput = body?.role !== undefined ? String(body.role).trim() : undefined
  const baseRole = body?.baseRole && VALID_BUILTIN_ROLES.includes(body.baseRole)
    ? (body.baseRole as Role)
    : (roleInput ? await getBaseRole(roleInput) : undefined)

  const branchId = !isBM && body?.branch_id !== undefined ? (body.branch_id ? String(body.branch_id) : null) : undefined
  const displayName = body?.displayName !== undefined ? String(body.displayName).trim() : undefined
  const allowedModules = body?.allowed_modules !== undefined
    ? (Array.isArray(body.allowed_modules) ? body.allowed_modules.map((m: any) => String(m)) : null)
    : undefined

  if (baseRole === "branch_manager" && !branchId && !isBM) {
    return NextResponse.json({ error: "branch_manager requires an allotted branch" }, { status: 400 })
  }

  const updates: string[] = []
  const values: any[] = [email]

  if (roleInput) {
    // Caps on privilege changes via PATCH (POST had them; PATCH didn't — an
    // admin could mint a 3rd admin or a 2nd developer through the edit form).
    // No-op role writes (target already has this base) skip the cap.
    const newBase = await getBaseRole(roleInput)
    const current = await query(`SELECT role FROM allowed_emails WHERE lower(email) = $1 LIMIT 1`, [email])
    const currentBase = current.rowCount ? await getBaseRole(current.rows[0].role) : null
    if (newBase !== currentBase && newBase === "admin") {
      const others = await query(`SELECT COUNT(*)::int AS n FROM allowed_emails WHERE role = 'admin' AND lower(email) != $1`, [email])
      if (others.rows[0].n >= 5) {
        return NextResponse.json({ error: "Maximum number of admin accounts (5) reached. Remove an existing admin first." }, { status: 400 })
      }
    }
    if (newBase !== currentBase && newBase === "developer") {
      const others = await query(`SELECT COUNT(*)::int AS n FROM allowed_emails WHERE role = 'developer' AND lower(email) != $1`, [email])
      if (others.rows[0].n >= 1) {
        return NextResponse.json({ error: "That role already has the maximum number of accounts." }, { status: 400 })
      }
    }
    values.push(roleInput)
    updates.push(`role = $${values.length}`)
  }
  if (branchId !== undefined) {
    values.push(branchId)
    updates.push(`branch_id = $${values.length}`)
  }
  if (displayName !== undefined) {
    values.push(displayName || null)
    updates.push(`display_name = $${values.length}`)
  }
  if (allowedModules !== undefined) {
    values.push(allowedModules)
    updates.push(`allowed_modules = $${values.length}`)
  }

  if (updates.length > 0) {
    await query(
      `UPDATE allowed_emails SET ${updates.join(", ")} WHERE lower(email) = $1`,
      values
    )
    logAudit("team member updated", session.email, { email, fields: updates.map((u) => u.split(" ")[0]) })
  }

  if (displayName !== undefined && displayName) {
    await query(
      `INSERT INTO team_profiles (email, display_name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET display_name = $2`,
      [email, displayName]
    )
  }

  return NextResponse.json({ ok: true, email })
}

export async function DELETE(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const email = String(new URL(req.url).searchParams.get("email") || "").trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid email" }, { status: 400 })

  if (email === session.email) return NextResponse.json({ error: "you cannot remove your own access" }, { status: 400 })
  if (email === (process.env.ADMIN_EMAIL || "").toLowerCase()) {
    return NextResponse.json({ error: "the admin email cannot be removed" }, { status: 400 })
  }

  const targetUser = await query(
    `SELECT role, branch_id FROM allowed_emails WHERE lower(email) = $1 LIMIT 1`,
    [email]
  )
  if (targetUser.rows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const targetRole = targetUser.rows[0].role
  // SECURITY (2026-10-05): resolve the target's BASE role (custom roles map
  // to one) before the privilege check — a raw string check let a custom
  // role wrapping admin/developer slip past — and block branch_manager
  // targets too, so a BM can no longer delete a fellow BM of the same
  // branch (POST/PATCH already refuse to create/edit one).
  const targetBaseRole = await getBaseRole(targetRole)
  if (targetBaseRole === "developer" || targetBaseRole === "admin" || targetBaseRole === "branch_manager") {
    return NextResponse.json({ error: "This account cannot be removed here." }, { status: 403 })
  }

  const isBM = session.role === "branch_manager"
  if (isBM) {
    if (targetUser.rows[0].branch_id !== session.branchId) {
      return NextResponse.json({ error: "Teammate not in your branch." }, { status: 403 })
    }
  }

  await query(`DELETE FROM allowed_emails WHERE lower(email) = $1`, [email])
  logAudit("team member removed", session.email, { email, role: targetRole })
  return NextResponse.json({ ok: true })
}
