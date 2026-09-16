import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

// GET — list suggestions, newest first. Admin-only: this surface exists
// inside the Script Manager, which is already admin-gated end to end.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") // "pending" | "approved" | "rejected" | null (= all)

  const where = status && ["pending", "approved", "rejected"].includes(status) ? `WHERE status = $1` : ""
  const params = where ? [status] : []
  const res = await query(
    `SELECT id, channel, short_guideline, situation, risk, source_summary, status, applied_to, reviewed_by, reviewed_at, created_at
     FROM prompt_suggestions ${where} ORDER BY created_at DESC LIMIT 100`,
    params
  )
  return NextResponse.json({ suggestions: res.rows })
}
