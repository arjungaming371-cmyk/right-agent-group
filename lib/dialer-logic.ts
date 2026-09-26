// Pure (zero-import) dialer decision logic for the bulk-calling engine.
// Import-free on purpose: scripts/test-bulk-queue.js compiles THIS file with
// the repo's own tsc and exercises the exact production math (retry policy,
// IST calling-window scheduling, status grouping) — no DB, no mocks.

export type QueueChannel = "phone" | "whatsapp_voice"

/** Accept the plan's vocabulary + legacy aliases; anything unknown = phone
 *  (the channel that works for every number, everywhere). */
export function normalizeChannel(raw: unknown): QueueChannel {
  const s = String(raw ?? "").toLowerCase()
  return s === "whatsapp_voice" || s === "whatsapp" ? "whatsapp_voice" : "phone"
}

/**
 * Auto-redial decision (Feature 4 of the bulk plan): busy / no-answer calls
 * with ZERO conversation time are re-queued; a call where someone actually
 * talked (duration > 0), a provider failure (bad number), or a lead who
 * already burned the retry cap never auto-requeues.
 *
 * outcome vocabulary comes from /api/calls/status + whatsapp-call-finalize:
 *   resolved | missed | failed | rejected | voicemail | ...
 */
export function shouldAutoRetry(
  outcome: string | null | undefined,
  durationSec: number,
  retryCount: number,
  maxRetries: number
): boolean {
  if (!Number.isFinite(maxRetries) || maxRetries <= 0) return false
  if (retryCount >= maxRetries) return false
  if (Number(durationSec) > 0) return false // a human answered and talked
  const o = String(outcome || "").toLowerCase()
  return o === "missed" || o === "rejected"
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // UTC+5:30, no DST — fixed offset is safe
const DAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

/**
 * Next moment the calling window (compliance_settings: start/end hour IST +
 * allowed weekdays) OPENS, as a UTC millisecond timestamp.
 *
 * Used by the bulk runner's auto-pause: instead of terminally skipping rows
 * it catches outside the window, it re-schedules them here so the campaign
 * resumes by itself when the window re-opens. Returns a time strictly AFTER
 * `nowMs` (if the window is open right now, that means tomorrow's open —
 * callers only ask this when the window is closed).
 */
export function nextWindowStartMs(
  nowMs: number = Date.now(),
  startHour = 8,
  days: string[] = ["mon", "tue", "wed", "thu", "fri", "sat"]
): number {
  const allowed = new Set(days.map((d) => String(d).trim().toLowerCase()).filter(Boolean))
  if (allowed.size === 0) allowed.add("mon")
  const h = Math.min(23, Math.max(0, Math.floor(Number(startHour) || 8)))
  // Walk up to 8 candidate days in the IST-shifted frame.
  let ist = new Date(nowMs + IST_OFFSET_MS)
  for (let i = 0; i < 8; i++) {
    const dayCode = DAY_CODES[ist.getUTCDay()]
    if (allowed.has(dayCode)) {
      const startMs =
        Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, 0, 0, 0) - IST_OFFSET_MS
      if (startMs > nowMs) return startMs
    }
    // Jump to 00:00 IST of the next day (still in the shifted frame).
    ist = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, 0, 0, 0) + 24 * 60 * 60 * 1000)
  }
  return nowMs + 24 * 60 * 60 * 1000 // unreachable in practice; fail forward
}

export type QueueStatusGroup = "pending" | "dialing" | "called" | "failed" | "skipped" | "cancelled"

/** Map a raw outbound_queue.status to the Call Queue view's status tabs.
 *  The real skip codes are skipped_do_not_call / skipped_dnd_suppressed /
 *  skipped_outside_window — the plan's "skipped_dnd" never existed. */
export function statusGroup(status: string): QueueStatusGroup {
  const s = String(status || "")
  if (s === "pending" || s === "dialing" || s === "called" || s === "failed" || s === "cancelled") {
    return s as QueueStatusGroup
  }
  if (s.startsWith("skipped")) return "skipped"
  return "skipped"
}

export const STATUS_GROUP_COLORS: Record<QueueStatusGroup, string> = {
  pending: "var(--accent-yellow)",
  dialing: "var(--accent-blue)",
  called: "var(--accent-green)",
  failed: "var(--accent-red)",
  skipped: "var(--accent-violet)",
  cancelled: "var(--text-muted)",
}

/** Which terminal statuses the Re-queue action may push back to pending. */
export function isRequeueable(status: string): boolean {
  const s = String(status || "")
  return s === "failed" || s === "cancelled" || s.startsWith("skipped")
}
