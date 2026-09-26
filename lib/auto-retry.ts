// Auto-redial (Feature 4 of the bulk calling plan): when a queued call ends
// busy / no-answer with zero conversation time, the queue row goes back to
// pending with a +retryDelayMinutes scheduled_at — capped by the dialer
// settings so a lead never gets more than maxRetries automatic redials.
//
// Hooked from BOTH terminal paths:
//   - /api/calls/status          (Exotel phone calls)
//   - /api/whatsapp terminate    (WhatsApp voice calls, via finalizeWhatsAppCall)
//
// Idempotent under webhook retries: the re-queue UPDATE is conditional on
// retry_count still being the value we decided on, so a double status
// callback can never double-increment.

import { query } from "@/lib/db"
import { getDialerSettings } from "@/lib/dialer-settings"
import { shouldAutoRetry } from "@/lib/dialer-logic"

export async function maybeRequeueMissed(opts: {
  callSid: string
  outcome: string | null | undefined
  duration: number | null | undefined
}): Promise<{ requeued: boolean; retryCount?: number; scheduledAt?: string }> {
  const { callSid, outcome, duration } = opts
  if (!callSid) return { requeued: false }
  try {
    const settings = await getDialerSettings()
    if (!settings.autoRetry) return { requeued: false }

    // The queue row this call came from (the runner stamps call_sid when it
    // dials). Only a 'called' row (dial attempt completed) is retryable.
    const row = await query(
      `SELECT id, retry_count FROM outbound_queue
        WHERE call_sid = $1 AND status = 'called'
        ORDER BY created_at DESC LIMIT 1`,
      [callSid]
    )
    const queueRow = row.rows[0] as { id: string; retry_count: number } | undefined
    if (!queueRow) return { requeued: false }

    const retryCount = Number(queueRow.retry_count) || 0
    if (!shouldAutoRetry(outcome, Number(duration) || 0, retryCount, settings.maxRetries)) {
      return { requeued: false }
    }

    // Optimistic claim: WHERE retry_count = <the value we read> means two
    // concurrent webhook retries can't both requeue (the loser matches 0 rows).
    const updated = await query(
      `UPDATE outbound_queue
          SET status = 'pending',
              retry_count = retry_count + 1,
              scheduled_at = now() + ($2 || ' minutes')::interval,
              called_at = NULL,
              claimed_at = NULL,
              cancelled_at = NULL,
              cancelled_by = NULL
        WHERE id = $1 AND retry_count = $3
        RETURNING retry_count, scheduled_at`,
      [queueRow.id, String(settings.retryDelayMinutes), retryCount]
    )
    const win = updated.rows[0] as { retry_count: number; scheduled_at: string } | undefined
    if (!win) return { requeued: false }
    console.log(`🔁 auto-requeue: queue row ${queueRow.id} → pending (retry ${win.retry_count}/${settings.maxRetries}, outcome=${outcome})`)
    return { requeued: true, retryCount: Number(win.retry_count), scheduledAt: win.scheduled_at }
  } catch (e) {
    // A failed requeue must never fail the status webhook itself.
    console.error("auto-requeue error:", e instanceof Error ? e.message : e)
    return { requeued: false }
  }
}
