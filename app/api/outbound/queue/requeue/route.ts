import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// Re-queue (the plan's "Retry / Re-queue"): push failed / cancelled /
// skipped rows back to pending so the dialer takes them again. retry_count
// is deliberately NOT reset — a lead who already burned their auto-retry cap
// stays capped; a manual re-queue by an operator is a conscious decision and
// still allowed.
//
//   POST /api/outbound/queue/requeue  { ids: string[] }
//   → { ok, requeuedCount }

const REQUEUEABLE_SQL = "('failed', 'cancelled', 'skipped_do_not_call', 'skipped_dnd_suppressed', 'skipped_outside_window')"

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)
  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map((x: unknown) => String(x)).filter(Boolean) : []
  if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 })
  if (!ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return NextResponse.json({ error: "invalid ids" }, { status: 400 })
  }

  const params: unknown[] = [ids, new Date().toISOString()]
  let where = `id = ANY($1::uuid[]) AND status IN ${REQUEUEABLE_SQL}`
  if (branchId) {
    params.push(branchId)
    where += ` AND branch_id = $${params.length}`
  }

  const res = await query(
    `UPDATE outbound_queue
        SET status = 'pending', scheduled_at = $2, claimed_at = NULL,
            cancelled_at = NULL, cancelled_by = NULL
      WHERE ${where}
      RETURNING id`,
    params
  )
  const requeuedCount = res.rowCount || 0
  logAudit("outbound queue requeued", session.email, { requested: ids.length, requeuedCount })
  return NextResponse.json({ ok: true, requeuedCount })
}
