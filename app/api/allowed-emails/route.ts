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
    `SELECT ae.email, ae.added_by, ae.role, ae.created_at, ae.branch_id, b.name AS branch_name, b.code AS branch_code
       FROM allowed_emails ae LEFT JOIN branches b ON b.id = ae.branch_id
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
    // The creator's account is always admin via ADMIN_EMAIL regardless of
    // this table — keep the row consistent with that so the Team Access
    // list never shows the creator as anything else.
    role = "admin"
  } else if (role === "admin") {
    // Max 2 admins total: the bootstrap ADMIN_EMAIL (always admin, doesn't
    // occupy a table row necessarily) + at most 1 more from this table.
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
    // Same cap as admin, not exposed through the normal Team Access UI.
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
    `INSERT INTO allowed_emails (email, added_by, role, branch_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET role = $3, branch_id = $4`,
    [email, session.email, role, branchId]
  )
  return NextResponse.json({ ok: true, email, role, branch_id: branchId })
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
