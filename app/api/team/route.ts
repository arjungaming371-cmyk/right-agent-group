import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

// Team roster — joins team_profiles (name/avatar/last login, captured
// automatically from Google at sign-in) with allowed_emails (role). The
// admin (identified via ADMIN_EMAIL, not necessarily a row in
// allowed_emails) is included separately since their role is a special
// case, not a table row. Used by the profile modal (own + teammates) and
// the /access team management page.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "viewer", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase()

  const result = await query(
    `SELECT ae.email, ae.role, tp.display_name, tp.avatar_url, tp.last_login_at, tp.created_at,
            tp.phone, tp.address, tp.age
     FROM allowed_emails ae
     LEFT JOIN team_profiles tp ON lower(tp.email) = lower(ae.email)
     ORDER BY ae.created_at ASC`
  )

  // Phone/address/age are only handed back to admins (viewing the team) or
  // the person themselves (viewing/editing their own profile) — every other
  // role only gets name + avatar, which is all the rest of the dashboard
  // (lead/call attribution, etc.) actually needs.
  const canSeeDetails = session.role === "admin" || session.role === "developer"
  const withDetails = (r: any, base: any) =>
    canSeeDetails || r.email.toLowerCase() === session.email.toLowerCase()
      ? { ...base, phone: r.phone, address: r.address, age: r.age }
      : base

  // The full-access role never appears in this roster for anyone but
  // themselves — this powers name/avatar lookups across the dashboard
  // (profile modal, Team Access page) and none of those need to see it.
  const rows = result.rows
    .filter((r: any) => r.role !== "developer" || r.email.toLowerCase() === session.email.toLowerCase())
    .map((r: any) =>
      withDetails(r, {
        email: r.email,
        role: r.role,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        lastLoginAt: r.last_login_at,
        memberSince: r.created_at,
      })
    )

  // Admin may not have an allowed_emails row — surface them separately if
  // they're not already present (e.g. via their own team_profiles row).
  if (adminEmail && !rows.some((r) => r.email.toLowerCase() === adminEmail)) {
    const adminProfile = await query(
      `SELECT display_name, avatar_url, last_login_at, created_at, phone, address, age
       FROM team_profiles WHERE lower(email) = $1`,
      [adminEmail]
    )
    const p = { ...(adminProfile.rows[0] || {}), email: adminEmail }
    rows.unshift(
      withDetails(p, {
        email: adminEmail,
        role: "admin",
        displayName: p?.display_name || null,
        avatarUrl: p?.avatar_url || null,
        lastLoginAt: p?.last_login_at || null,
        memberSince: p?.created_at || null,
      })
    )
  }

  return NextResponse.json(rows)
}
