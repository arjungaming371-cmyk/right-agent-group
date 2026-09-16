// Loan application edit requests — the approval-gated path for Priya to
// propose a correction to an already-submitted loan application. Runs
// AFTER the customer already has their normal reply (fire-and-forget from
// the WhatsApp/voice turn handlers), so it never adds latency to a live
// conversation. Only ever INSERTs a pending row + a staff notification —
// loan_applications itself is untouched until a human approves via
// POST /api/loans/edit-requests/[id].

import { query } from "./db"
import { detectLoanEditRequest, AI_EDITABLE_LOAN_FIELDS } from "./llm"
import { createNotification } from "./notifications"
import { isValidUUID } from "./lead-brain"

const CORRECTION_HINT_RE = /\b(wrong|wrongly|incorrect|mistake|typo|actually|meant to|should be|change (it|that|my)|correct(ion)?|fix (it|that|my))\b/i

/**
 * Cheap pre-filter before touching the LLM at all — most turns aren't
 * correction requests, and this is meant to fire selectively, not on every
 * message like knowledge-base search does.
 */
function mightBeCorrection(text: string): boolean {
  return CORRECTION_HINT_RE.test(text || "")
}

/**
 * Fire-and-forget. Looks up the lead's most recent loan application, asks
 * the model whether this turn is a correction request, and if so writes a
 * PENDING edit_request row + notifies staff. Never throws into the caller —
 * a failure here must never affect the live conversation that already got
 * its reply.
 */
export function maybeProposeLoanEdit(leadId: string | null | undefined, channel: "priya_whatsapp" | "priya_voice", customerMessage: string): void {
  if (!leadId || !isValidUUID(leadId)) return
  if (!mightBeCorrection(customerMessage)) return

  ;(async () => {
    try {
      const appRes = await query(
        `SELECT id, loan_type, loan_amount, city, employment_type, monthly_income
         FROM loan_applications WHERE lead_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
        [leadId]
      )
      if (appRes.rows.length === 0) return // nothing submitted yet — no application to correct
      const app = appRes.rows[0]

      const proposal = await detectLoanEditRequest(customerMessage, app)
      if (!proposal) return

      // Skip if this exact field+value is already pending review — a
      // customer repeating themselves shouldn't spam duplicate rows.
      const dup = await query(
        `SELECT 1 FROM loan_application_edit_requests
         WHERE loan_application_id = $1 AND status = 'pending' AND proposed_values->>'field' = $2
         LIMIT 1`,
        [app.id, proposal.field]
      )
      if (dup.rows.length > 0) return

      const previousValues = { field: proposal.field, value: app[proposal.field] ?? null }
      const proposedValues = { field: proposal.field, value: proposal.new_value }

      const inserted = await query(
        `INSERT INTO loan_application_edit_requests
           (loan_application_id, lead_id, proposed_by, reason, previous_values, proposed_values)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
         RETURNING id`,
        [app.id, leadId, channel, proposal.reason, JSON.stringify(previousValues), JSON.stringify(proposedValues)]
      )

      const leadRes = await query(`SELECT name FROM leads WHERE id = $1`, [leadId])
      const leadName = leadRes.rows[0]?.name || "A customer"

      await createNotification({
        type: "loan_edit_request",
        title: "Priya flagged an application correction",
        body: `${leadName} wants to change ${proposal.field.replace(/_/g, " ")} to "${proposal.new_value}" — review in Loan Applications.`,
        linkView: "loans",
      })

      console.log(`[loan-edit-requests] pending edit ${inserted.rows[0]?.id} for application ${app.id} (${proposal.field} -> ${proposal.new_value})`)
    } catch (e: any) {
      console.error("maybeProposeLoanEdit error:", e.message)
    }
  })()
}

export { AI_EDITABLE_LOAN_FIELDS }
