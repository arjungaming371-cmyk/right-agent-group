import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

// Lightweight read for the dashboard's Calendar view — deliberately separate
// from GET /api/leads (which has its own search/sort/pagination machinery
// for a different purpose); the calendar just needs a small, date-scoped
// shape for whatever month is currently visible.
export async function GET(req: NextRequest) {
  // FIX (2026-09-20): two bugs — branch_manager was missing from the role
  // list (branch managers got a broken calendar), and the query had NO
  // branch filter (branch users saw EVERY branch's customer names + phones).
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const { searchParams } = new URL(req.url)
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  // FIX (2026-09-20): validate the window params — garbage dates silently
  // produced an empty (or wildly unscoped) calendar result.
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 })
  }

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
