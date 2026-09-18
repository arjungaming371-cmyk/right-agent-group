import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"
import { isValidUUID } from "@/lib/lead-brain"

// Set, update, or clear a lead's scheduled callback date/time — manual,
// dashboard-set only (not Priya parsing spoken dates live on a call).
// Powers the dashboard's Calendar view.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isValidUUID(id)) return NextResponse.json({ error: "invalid lead id" }, { status: 400 })

  const branchId = sessionBranchId(session)
  const current = await query(`SELECT id, branch_id FROM leads WHERE id = $1`, [id])
  if (current.rows.length === 0) return NextResponse.json({ error: "lead not found" }, { status: 404 })
  if (branchId && current.rows[0].branch_id !== branchId) {
    return NextResponse.json({ error: "lead not found in your branch" }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}) as any)

  // null clears the callback; otherwise must be a valid, parseable date.
  let callbackAt: string | null = null
  if (body?.callbackAt !== null && body?.callbackAt !== undefined) {
    const parsed = new Date(body.callbackAt)
    if (isNaN(parsed.getTime())) return NextResponse.json({ error: "invalid callbackAt" }, { status: 400 })
    callbackAt = parsed.toISOString()
  }
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null

  const updated = await query(
    `UPDATE leads SET callback_at = $1, callback_note = $2 WHERE id = $3
     RETURNING id, callback_at, callback_note`,
    [callbackAt, note, id]
  )

  logAudit(callbackAt ? "callback scheduled" : "callback cleared", session.email, { leadId: id, callbackAt })

  return NextResponse.json(updated.rows[0])
}
