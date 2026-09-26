// Real-time dashboard notifications — separate from email escalations
// (lib/frustration.ts still emails ADMIN_EMAIL; this is the in-app bell).
//
// Five event types, matching what the dashboard actually surfaces:
//   loan_application  — a customer submitted the loan application form
//   escalation        — frustration detected on a call or WhatsApp chat
//   login             — a team member signed into the dashboard
//   whatsapp_message  — a brand-new contact messaged in on WhatsApp
//   loan_edit_request — Priya flagged a correction to a submitted application, pending staff approval
//
// (2026-09-26) The notifications.type CHECK in local-setup.sql knows all five;
// the widening is idempotent (DROP CONSTRAINT IF EXISTS → ADD), so fresh
// installs and old databases both accept every type emitted here.

import { query } from "./db"

export type NotificationType = "loan_application" | "escalation" | "login" | "whatsapp_message" | "loan_edit_request"

/** Fire-and-forget: never throws, never blocks the caller's real work. */
export async function createNotification(opts: {
  type: NotificationType
  title: string
  body?: string
  linkView?: string
}): Promise<void> {
  try {
    await query(
      `INSERT INTO notifications (type, title, body, link_view) VALUES ($1, $2, $3, $4)`,
      [opts.type, opts.title, opts.body || null, opts.linkView || null]
    )
  } catch (e: any) {
    console.error("createNotification error:", e.message)
  }
}

// ---------------------------------------------------------------------------
// LOGIN DEDUPE (2026-09-26): every sign-in used to fire a "Team member signed
// in" notification. The bell shows the 30 MOST RECENT items, so a busy team's
// daily logins pushed the alerts that actually matter (escalations — "customer
// needs a human") out of view. Login pings are now once per email+role per
// calendar day; the first sign-in of the day shows, repeats are silent.
// ---------------------------------------------------------------------------

/**
 * Pure guard, exported for tests: a notification id is only ever a UUID.
 * PATCH /api/notifications used to pass garbage straight into
 * `WHERE id = $1` and Postgres answered "invalid input syntax for type uuid"
 * as a 500. The route now 400s via this check.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isValidNotificationId(id: unknown): boolean {
  return typeof id === "string" && UUID_RE.test(id)
}

/** Fire-and-forget login ping — see the dedupe rationale above. */
export async function createLoginNotificationOncePerDay(body: string): Promise<void> {
  try {
    const dup = await query(
      `SELECT 1 FROM notifications
        WHERE type = 'login' AND body = $1 AND created_at >= date_trunc('day', now())
        LIMIT 1`,
      [body]
    )
    if (dup.rows[0]) return
    await query(
      `INSERT INTO notifications (type, title, body) VALUES ('login', 'Team member signed in', $1)`,
      [body]
    )
  } catch (e: any) {
    console.error("createLoginNotificationOncePerDay error:", e.message)
  }
}

// ---------------------------------------------------------------------------
// RETENTION (2026-09-26): nothing ever deleted a notification — the table
// grew forever (logins alone are several rows per staff-day). The GET route
// calls pruneNotifications() behind a ~5% random gate, so an open dashboard
// self-heals roughly once every few minutes with one cheap indexed DELETE:
//   * read items                    → dropped after 14 days
//   * anything unread but ancient   → dropped after 90 days (stale alerts
//                                     nobody acted on are not alerts anymore)
// Never throws; a failed prune costs nothing.
// ---------------------------------------------------------------------------
export async function pruneNotifications(): Promise<void> {
  try {
    await query(
      `DELETE FROM notifications
        WHERE (read = true AND created_at < now() - interval '14 days')
           OR (created_at < now() - interval '90 days')`
    )
  } catch (e: any) {
    console.error("pruneNotifications error:", e.message)
  }
}
