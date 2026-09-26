import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// Granular queue cancellation (Feature 2 of the bulk plan):
//
//   POST /api/outbound/queue/cancel
//   { ids?: string[], allPending?: boolean }
//   → { ok, cancelledCount }
//
// SOFT cancel only: status → 'cancelled' with who/when stamped, so the
// historical/analytics record survives (the plan's "without losing
// historical analytics"). The dialer claim only ever takes 'pending' rows,
// so a cancelled row is instantly ignored — no runner change needed.
// A row already 'dialing' is a live phone call — it cannot be un-rung, so
// only 'pending' rows cancel.

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)
  const body = await req.json().catch(() => ({}))

  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map((x: unknown) => String(x)).filter(Boolean) : []
  const allPending = body?.allPending === true
  if (!allPending && !ids.length) {
    return NextResponse.json({ error: "ids or allPending required" }, { status: 400 })
  }

  const params: unknown[] = [session.email]
  let where = "status = 'pending'"
  if (branchId) {
    params.push(branchId)
    where += ` AND branch_id = $${params.length}`
  }
  if (!allPending) {
    params.push(ids)
    where += ` AND id = ANY($${params.length}::uuid[])`
  }

  const res = await query(
    `UPDATE outbound_queue
        SET status = 'cancelled', cancelled_at = now(), cancelled_by = $1
      WHERE ${where}
      RETURNING id`,
    params
  )
  const cancelledCount = res.rowCount || 0
  logAudit("outbound queue cancelled", session.email, { allPending, ids: ids.length, cancelledCount })
  return NextResponse.json({ ok: true, cancelledCount })
}
