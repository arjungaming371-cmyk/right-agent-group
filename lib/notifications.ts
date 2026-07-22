// Real-time dashboard notifications — separate from email escalations
// (lib/frustration.ts still emails ADMIN_EMAIL; this is the in-app bell).
//
// Five event types, matching what the dashboard actually surfaces:
//   loan_application  — a customer submitted the loan application form
//   escalation        — frustration detected on a call or WhatsApp chat
//   login             — a team member signed into the dashboard
//   whatsapp_message  — a brand-new contact messaged in on WhatsApp
//   loan_edit_request — Priya flagged a correction to a submitted application, pending staff approval

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
