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

/**
 * OUTPERO-STYLE AUTO-RESCHEDULE TIMELINE (2026-10-09): a successful requeue
 * also drops a callback event on the Calendar — "10:00 AM Call 1 (missed) →
 * auto-scheduled 10:12 AM" becomes a visible, reschedulable appointment
 * instead of living only inside the queue table.
 *
 * Stored as source_type 'outbound_queue' (allowed by the calendar_events
 * CHECK constraint — no migration dance) with source_id
 * '<queueRowId>:r<attempt>', so every retry is its own idempotent row (the
 * uq_calendar_event_source index makes webhook double-fires a no-op) while
 * the lead's REAL customer-promised callback stays a separate row and is
 * never clobbered by a machine retry.
 */
async function logRetryToCalendar(opts: {
  queueRowId: string
  retryCount: number
  scheduledAt: string
  leadId: string | null
  name: string | null
  outcome: string | null | undefined
  branchId: string | null
}): Promise<void> {
  try {
    const who = opts.name || "Customer"
    const endAt = new Date(new Date(opts.scheduledAt).getTime() + 10 * 60000).toISOString()
    await query(
      `INSERT INTO calendar_events
         (lead_id, title, event_type, event_at, end_at, channel,
          confidence, confidence_score, status, raw_quote,
          source_type, source_id, source_at, outbound_queue_id, branch_id,
          notes, reminder_enabled, original_event_at, created_by)
       VALUES ($1, $2, 'callback', $3, $4, 'phone',
               'high', 1.0, 'confirmed', $5,
               'outbound_queue', $6, now(), $7, $8,
               $9, false, $3, 'retry_engine')
       ON CONFLICT (source_type, source_id, event_type, original_event_at) DO NOTHING`,
      [
        opts.leadId,
        `Auto-retry scheduled: ${who}`,
        opts.scheduledAt,
        endAt,
        `Previous attempt ended "${opts.outcome || "no answer"}" — auto-rescheduled by the retry engine`,
        `${opts.queueRowId}:r${opts.retryCount}`,
        opts.queueRowId,
        opts.branchId,
        `Attempt ended "${opts.outcome || "no answer"}" with zero conversation time. Auto-retry #${opts.retryCount} scheduled — the operator can reschedule or cancel from here and the queue follows.`,
      ]
    )
  } catch (e) {
    // calendar_events may not exist on a fresh DB that hasn't run the
    // 2026-10-08 migrations — a failed calendar note must never fail the
    // requeue itself.
    console.error("auto-retry calendar note failed:", e instanceof Error ? e.message : e)
  }
}

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
      `SELECT id, retry_count, lead_id, name, phone, branch_id FROM outbound_queue
        WHERE call_sid = $1 AND status = 'called'
        ORDER BY created_at DESC LIMIT 1`,
      [callSid]
    )
    const queueRow = row.rows[0] as { id: string; retry_count: number; lead_id: string | null; name: string | null; phone: string; branch_id: string | null } | undefined
    if (!queueRow) return { requeued: false }

    const retryCount = Number(queueRow.retry_count) || 0
    if (!shouldAutoRetry(outcome, Number(duration) || 0, retryCount, settings.maxRetries)) {
      return { requeued: false }
    }

    // Optimistic claim: WHERE retry_count = <the value we read> means two
    // concurrent webhook retries can't both requeue (the loser matches 0 rows).
    // A 23505 here means the number ALREADY has another pending/dialing row
    // (e.g. the operator re-added the lead while this webhook was in flight)
    // — the anti-stacking index doing its job, not an error.
    // BACKOFF: base delay × retry attempt (1st retry 12 min, 2nd 24 min …)
    // — fast enough to catch the lead the same morning, spaced enough to
    // never feel like harassment.
    const delayMinutes = Math.min(1440, Math.max(5, settings.retryDelayMinutes * (retryCount + 1)))
    let win: { retry_count: number; scheduled_at: string } | undefined
    try {
      const updated = await query(
        `UPDATE outbound_queue
            SET status = 'pending',
                retry_count = retry_count + 1,
                scheduled_at = now() + ($2 || ' minutes')::interval,
                called_at = NULL,
                claimed_at = NULL,
                cancelled_at = NULL,
                cancelled_by = NULL,
                outcome = NULL, outcome_at = NULL, outcome_detail = NULL
          WHERE id = $1 AND retry_count = $3
          RETURNING retry_count, scheduled_at`,
        [queueRow.id, String(delayMinutes), retryCount]
      )
      win = updated.rows[0] as { retry_count: number; scheduled_at: string } | undefined
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "23505") {
        console.log(`🔁 auto-requeue: queue row ${queueRow.id} skipped — number already active in another queue row`)
        return { requeued: false }
      }
      throw e
    }
    if (!win) return { requeued: false }
    console.log(`🔁 auto-requeue: queue row ${queueRow.id} → pending (retry ${win.retry_count}/${settings.maxRetries}, outcome=${outcome})`)
    // Calendar timeline (fire-and-forget — never blocks the webhook).
    void logRetryToCalendar({
      queueRowId: queueRow.id,
      retryCount: Number(win.retry_count),
      scheduledAt: win.scheduled_at,
      leadId: queueRow.lead_id,
      name: queueRow.name,
      outcome,
      branchId: queueRow.branch_id,
    })
    return { requeued: true, retryCount: Number(win.retry_count), scheduledAt: win.scheduled_at }
  } catch (e) {
    // A failed requeue must never fail the status webhook itself.
    console.error("auto-requeue error:", e instanceof Error ? e.message : e)
    return { requeued: false }
  }
}
