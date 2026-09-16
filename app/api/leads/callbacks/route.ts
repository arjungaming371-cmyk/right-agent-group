import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

// Lightweight read for the dashboard's Calendar view — deliberately separate
// from GET /api/leads (which has its own search/sort/pagination machinery
// for a different purpose); the calendar just needs a small, date-scoped
// shape for whatever month is currently visible.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "viewer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (!from || !to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 })

  const result = await query(
    `SELECT id, name, phone, callback_at, callback_note, product_interest
     FROM leads
     WHERE callback_at IS NOT NULL AND callback_at >= $1 AND callback_at < $2
     ORDER BY callback_at ASC`,
    [from, to]
  )

  return NextResponse.json(result.rows)
}
