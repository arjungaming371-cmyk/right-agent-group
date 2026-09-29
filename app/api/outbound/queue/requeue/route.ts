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
//   → { ok, requeuedCount, skippedDuplicate }
//
// DUPLICATION GUARDS (the unique partial index uq_outbound_queue_active_phone
// allows at most ONE active — pending/dialing — row per last-10 phone, and a
// naive UPDATE into 'pending' that violates it dies with 23505 → HTTP 500):
//   1. Within the batch, only the NEWEST row per phone is re-queued (a
//      campaign's history keeps failed + cancelled rows of the same number;
//      re-queueing all of them would stack actives).
//   2. A phone that ALREADY has an active row anywhere is skipped, not
//      stacked — the add-to-queue endpoint enforces the same rule at insert.
// Both guards keep the oldest campaign position meaningful: history rows are
// left untouched, the audit trail survives, and the response reports exactly
// how many duplicates were refused.

const REQUEUEABLE_SQL = "('failed', 'cancelled', 'skipped_do_not_call', 'skipped_dnd_suppressed', 'skipped_outside_window')"
const LAST10_SQL = "right(regexp_replace(phone, '\\D', '', 'g'), 10)"

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
  let branchWhere = ""
  if (branchId) {
    params.push(branchId)
    branchWhere = `AND branch_id = $${params.length}`
  }

  // How many of the requested rows are requeueable at all (before dedup)?
  const matchedRes = await query(
    `SELECT count(*)::int AS n FROM outbound_queue
      WHERE id = ANY($1::uuid[]) AND status IN ${REQUEUEABLE_SQL} ${branchWhere}`,
    params
  )
  const matched = (matchedRes.rows[0] as { n: number })?.n || 0

  const res = await query(
    `WITH picked AS (
       SELECT DISTINCT ON (${LAST10_SQL}) id, ${LAST10_SQL} AS k
         FROM outbound_queue
        WHERE id = ANY($1::uuid[]) AND status IN ${REQUEUEABLE_SQL} ${branchWhere}
        ORDER BY ${LAST10_SQL}, created_at DESC, id DESC
     )
     UPDATE outbound_queue q
        SET status = 'pending', scheduled_at = $2, claimed_at = NULL,
            cancelled_at = NULL, cancelled_by = NULL
       FROM picked
      WHERE q.id = picked.id
        AND NOT EXISTS (
          SELECT 1 FROM outbound_queue act
           WHERE act.status IN ('pending', 'dialing')
             AND ${LAST10_SQL} = picked.k
             AND act.id <> q.id
        )
      RETURNING q.id`,
    params
  )
  const requeuedCount = res.rowCount || 0
  const skippedDuplicate = Math.max(0, matched - requeuedCount)
  logAudit("outbound queue requeued", session.email, { requested: ids.length, requeuedCount, skippedDuplicate })
  return NextResponse.json({ ok: true, requeuedCount, skippedDuplicate })
}
