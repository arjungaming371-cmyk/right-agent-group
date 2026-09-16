import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole, type Role } from "@/lib/auth"

export const dynamic = "force-dynamic"

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const VALID_ROLES: Role[] = ["admin", "agent", "viewer", "developer", "branch_manager"]

// Team access management is admin-only. Middleware already blocks
// unauthenticated calls, but we verify the role again here — never trust a
// single layer for an access-control endpoint.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // Rows with the full-access role never appear in the admin-facing list.
  const r = await query(
    `SELECT ae.email, ae.added_by, ae.role, ae.created_at, ae.branch_id, ae.display_name,
            tp.display_name AS profile_name, tp.avatar_url,
            b.name AS branch_name, b.code AS branch_code
       FROM allowed_emails ae
       LEFT JOIN branches b ON b.id = ae.branch_id
       LEFT JOIN team_profiles tp ON lower(tp.email) = lower(ae.email)
      WHERE ae.role != 'developer' ORDER BY ae.created_at DESC`
  )
  const branches = await query(`SELECT id, name, code FROM branches ORDER BY name`)
  return NextResponse.json({ emails: r.rows, you: session.email, branches: branches.rows })
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
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
  let role: Role = VALID_ROLES.includes(body?.role) ? body.role : "agent"
  const displayName = String(body?.displayName || body?.display_name || "").trim()

  // Multi-branch binding: agents/viewers/branch_managers can be pinned to a
  // branch at invite time. Their session carries that branchId from login on;
  // they see and touch ONLY that branch's data.
  let branchId: string | null = null
  if (body?.branch_id) {
    const b = await query(`SELECT id FROM branches WHERE id = $1`, [String(body.branch_id)])
    if (!b.rowCount) return NextResponse.json({ error: "unknown branch" }, { status: 400 })
    branchId = b.rows[0].id
  }
  if (role === "branch_manager" && !branchId) {
    return NextResponse.json({ error: "branch_manager requires a branch" }, { status: 400 })
  }

  const adminEmailEnv = (process.env.ADMIN_EMAIL || "").toLowerCase()
  if (email === adminEmailEnv) {
    role = "admin"
  } else if (role === "admin") {
    const existingAdmins = await query(
      `SELECT COUNT(*)::int AS n FROM allowed_emails WHERE role = 'admin' AND lower(email) != $1`,
      [email]
    )
    if (existingAdmins.rows[0].n >= 1) {
      return NextResponse.json(
        { error: "Only 2 admins are allowed in total (including the creator account). Remove the other admin first, or assign a different role." },
        { status: 400 }
      )
    }
  } else if (role === "developer") {
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

  await query(
    `INSERT INTO allowed_emails (email, added_by, role, branch_id, display_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET role = $3, branch_id = $4, display_name = COALESCE(NULLIF($5, ''), allowed_emails.display_name)`,
    [email, session.email, role, branchId, displayName || null]
  )

  if (displayName) {
    await query(
      `INSERT INTO team_profiles (email, display_name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET display_name = $2`,
      [email, displayName]
    )
  }

  return NextResponse.json({ ok: true, email, role, branch_id: branchId, displayName })
}

export async function PATCH(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const email = String(body?.email || "").trim().toLowerCase()
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 })

  const role: Role | undefined = VALID_ROLES.includes(body?.role) ? body.role : undefined
  const branchId = body?.branch_id !== undefined ? (body.branch_id ? String(body.branch_id) : null) : undefined
  const displayName = body?.displayName !== undefined ? String(body.displayName).trim() : undefined

  if (role === "branch_manager" && !branchId) {
    return NextResponse.json({ error: "branch_manager requires an allotted branch" }, { status: 400 })
  }

  const updates: string[] = []
  const values: any[] = [email]

  if (role) {
    values.push(role)
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

  if (updates.length > 0) {
    await query(
      `UPDATE allowed_emails SET ${updates.join(", ")} WHERE lower(email) = $1`,
      values
    )
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
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const email = String(new URL(req.url).searchParams.get("email") || "").trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid email" }, { status: 400 })

  // Safety: a user cannot remove their own access (prevents locking everyone
  // out one by one), the ADMIN_EMAIL bootstrap account can never be removed,
  // and some roles are protected from admin removal entirely.
  if (email === session.email) return NextResponse.json({ error: "you cannot remove your own access" }, { status: 400 })
  if (email === (process.env.ADMIN_EMAIL || "").toLowerCase()) {
    return NextResponse.json({ error: "the admin email cannot be removed" }, { status: 400 })
  }

  const targetUser = await query(
    `SELECT role FROM allowed_emails WHERE lower(email) = $1 LIMIT 1`,
    [email]
  )
  if (targetUser.rows.length > 0 && targetUser.rows[0].role === "developer") {
    return NextResponse.json({ error: "This account cannot be removed." }, { status: 400 })
  }

  await query(`DELETE FROM allowed_emails WHERE lower(email) = $1`, [email])
  return NextResponse.json({ ok: true })
}
