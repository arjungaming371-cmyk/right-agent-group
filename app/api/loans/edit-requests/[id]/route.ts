import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { isValidUUID } from "@/lib/lead-brain"
import { AI_EDITABLE_LOAN_FIELDS, type AiEditableLoanField } from "@/lib/llm"

// POST — approve or reject a pending edit request. Approving is the ONLY
// path that ever writes an AI-proposed change into loan_applications; the
// field name is re-validated against the same allowlist used at proposal
// time (defense in depth — never trust a stored value as a safe SQL
// identifier just because it passed validation once already).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(req, ["admin", "agent"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isValidUUID(id)) return NextResponse.json({ error: "invalid request id" }, { status: 400 })

  const body = await req.json().catch(() => ({}) as any)
  const action = body?.action
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 })
  }

  const reqRes = await query(`SELECT * FROM loan_application_edit_requests WHERE id = $1`, [id])
  if (reqRes.rows.length === 0) return NextResponse.json({ error: "edit request not found" }, { status: 404 })
  const editRequest = reqRes.rows[0]

  if (editRequest.status !== "pending") {
    return NextResponse.json({ error: `already ${editRequest.status} — cannot review again` }, { status: 409 })
  }

  if (action === "reject") {
    const updated = await query(
      `UPDATE loan_application_edit_requests SET status = 'rejected', reviewed_by = $1, reviewed_at = now() WHERE id = $2 RETURNING *`,
      [session.email, id]
    )
    logAudit("loan edit request rejected", session.email, { editRequestId: id, loanApplicationId: editRequest.loan_application_id })
    return NextResponse.json(updated.rows[0])
  }

  // action === "approve"
  const field: AiEditableLoanField = editRequest.proposed_values?.field
  const value = editRequest.proposed_values?.value
  if (!AI_EDITABLE_LOAN_FIELDS.includes(field)) {
    return NextResponse.json({ error: `field "${field}" is not an approvable field — refusing to apply` }, { status: 400 })
  }

  await query(
    `UPDATE loan_applications SET ${field} = $1, last_edited_at = now() WHERE id = $2`,
    [value, editRequest.loan_application_id]
  )

  // Keep the lead row in sync so the Leads table (VALUE / LOAN TYPE /
  // ADDRESS columns) reflects the approved correction immediately.
  if (editRequest.lead_id) {
    if (field === "loan_amount") {
      await query(`UPDATE leads SET loan_amount = $1, updated_at = now() WHERE id = $2`, [value, editRequest.lead_id]).catch(() => {})
    } else if (field === "loan_type") {
      await query(`UPDATE leads SET product_interest = $1, updated_at = now() WHERE id = $2`, [value, editRequest.lead_id]).catch(() => {})
    } else if (field === "city") {
      await query(`UPDATE leads SET address = $1, updated_at = now() WHERE id = $2 AND (address IS NULL OR address = '')`, [value, editRequest.lead_id]).catch(() => {})
    }
  }
  const updated = await query(
    `UPDATE loan_application_edit_requests SET status = 'approved', reviewed_by = $1, reviewed_at = now() WHERE id = $2 RETURNING *`,
    [session.email, id]
  )

  logAudit("loan edit request approved", session.email, {
    editRequestId: id,
    loanApplicationId: editRequest.loan_application_id,
    field,
    previousValue: editRequest.previous_values?.value,
    newValue: value,
  })

  return NextResponse.json(updated.rows[0])
}
