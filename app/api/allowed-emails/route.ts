import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole, type Role } from "@/lib/auth"

export const dynamic = "force-dynamic"

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const VALID_ROLES: Role[] = ["admin", "agent", "viewer"]

// Team access management is admin-only. Middleware already blocks
// unauthenticated calls, but we verify the role again here — never trust a
// single layer for an access-control endpoint.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const r = await query(`SELECT email, added_by, role, created_at FROM allowed_emails ORDER BY created_at DESC`)
  return NextResponse.json({ emails: r.rows, you: session.email })
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
  }

  await query(
    `INSERT INTO allowed_emails (email, added_by, role) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET role = $3`,
    [email, session.email, role]
  )
  return NextResponse.json({ ok: true, email, role })
}

export async function DELETE(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const email = String(new URL(req.url).searchParams.get("email") || "").trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid email" }, { status: 400 })

  // Safety: a user cannot remove their own access (prevents locking everyone out one by one),
  // and the ADMIN_EMAIL bootstrap account can never be removed.
  if (email === session.email) return NextResponse.json({ error: "you cannot remove your own access" }, { status: 400 })
  if (email === (process.env.ADMIN_EMAIL || "").toLowerCase()) {
    return NextResponse.json({ error: "the admin email cannot be removed" }, { status: 400 })
  }

  await query(`DELETE FROM allowed_emails WHERE lower(email) = $1`, [email])
  return NextResponse.json({ ok: true })
}
