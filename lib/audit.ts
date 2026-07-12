// Audit trail helper — previously audit_logs only recorded security-setting
// toggles and (as of this session) logins. Extending it to cover the real
// mutations staff actually make: lead changes, loan status updates, script
// edits, and outbound campaign triggers. Fire-and-forget, never blocks the
// actual operation, never throws into the caller.

import { query } from "./db"

export async function logAudit(action: string, performedBy: string | null | undefined, metadata?: Record<string, any>): Promise<void> {
  try {
    await query(`INSERT INTO audit_logs (action, performed_by, metadata) VALUES ($1, $2, $3)`, [
      action,
      performedBy || "system",
      metadata ? JSON.stringify(metadata) : null,
    ])
  } catch (e: any) {
    console.error("logAudit error:", e.message)
  }
}
