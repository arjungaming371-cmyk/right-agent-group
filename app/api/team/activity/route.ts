import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"

// Own recent activity only (never another teammate's) — powers the "recent
// activity" section of the profile modal. Any logged-in role may see their
// own history; this is intentionally NOT the admin-only /api/security audit
// log, which returns everyone's activity.
export const GET = withRoute("team/activity", async (req: NextRequest) => {
  const session = await requireRole(req, ["admin", "agent", "viewer", "developer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const result = await query(
    `SELECT id, action, created_at FROM audit_logs
     WHERE lower(performed_by) = lower($1)
     ORDER BY created_at DESC LIMIT 10`,
    [session.email]
  )

  return NextResponse.json(result.rows)
})
