// Queue outcome feedback loop (2026-10-01) — the terminal call webhooks
// tell the QUEUE what actually happened to each dialed row.
//
// THE GAP THIS CLOSES: outbound_queue.status = 'called' has only ever meant
// "the dial was placed". Whether the human answered, rang out, declined or
// the carrier failed landed exclusively on the voice_calls row — so the
// Call Queue view's "Completed" tab and the Campaign Radar's "completed"
// counter mixed answered calls with never-picked-up ones, and the only way
// to know how a campaign really went was to cross-reference Voice Logs.
//
// Writers (both networks, same vocabulary as voice_calls.outcome):
//   • /api/calls/status        — Exotel status webhook (phone rows)
//   • /api/whatsapp terminate  — Meta calls webhook (whatsapp_voice rows)
//   • dialQueueRow failure     — provider rejections at dial time (detail =
//                                the DialError text, e.g. Meta's raw reason)
//
// Contract: best-effort and idempotent. A stamp must NEVER fail the
// webhook that carries it, and a retried webhook must never overwrite a
// result already written (first terminal report wins — same posture as the
// follow-up claim in /api/calls/status).

import { query } from "@/lib/db"

export type QueueOutcome = "resolved" | "missed" | "rejected" | "failed"

export async function stampQueueCallOutcome(opts: {
  callSid: string
  outcome: QueueOutcome | string
  detail?: string | null
}): Promise<void> {
  const { callSid, outcome } = opts
  if (!callSid) return
  // Only the funnel outcomes are storable — unknown provider statuses are
  // recorded in the DETAIL column, not the typed column.
  const KNOWN = new Set(["resolved", "missed", "rejected", "failed"])
  const o = String(outcome || "").toLowerCase()
  if (!KNOWN.has(o)) return
  const detail = opts.detail ? String(opts.detail).slice(0, 300) : null
  try {
    await query(
      `UPDATE outbound_queue
          SET outcome = $2,
              outcome_at = now(),
              outcome_detail = COALESCE($3, outcome_detail)
        WHERE call_sid = $1
          AND status = 'called'
          AND outcome IS NULL`,
      [callSid, o, detail]
    )
  } catch (e) {
    // A missing column (migration not run yet) or a DB blip must never
    // break the webhook — the radar simply keeps showing "dialed".
    console.error(
      "queue-outcome stamp failed:",
      e instanceof Error ? e.message : e
    )
  }
}
