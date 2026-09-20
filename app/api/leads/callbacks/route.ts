import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

// Lightweight read for the dashboard's Calendar view — deliberately separate
// from GET /api/leads (which has its own search/sort/pagination machinery
// for a different purpose); the calendar just needs a small, date-scoped
// shape for whatever month is currently visible.
export async function GET(req: NextRequest) {
  // 2026-09 fix: branch_manager was missing from this read (branch staff saw
  // an empty calendar) and the query had NO branch filter (cross-branch IDOR
  // — any agent could read every branch's callbacks).
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 })
  }

  const branchId = sessionBranchId(session)
  const result = await query(
    `SELECT id, name, phone, callback_at, callback_note, product_interest
     FROM leads
     WHERE callback_at IS NOT NULL AND callback_at >= $1 AND callback_at < $2
       AND ($3::uuid IS NULL OR branch_id = $3)
     ORDER BY callback_at ASC`,
    [from, to, branchId]
  )

  return NextResponse.json(result.rows)
}
