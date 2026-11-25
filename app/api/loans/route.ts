import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db, query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"
import { withRoute, readJson } from "@/lib/api-route"
import { invalidateLeadBriefCache } from "@/lib/lead-brain"

export const GET = withRoute("loans", async (req: NextRequest) => {
  const { searchParams } = new URL(req.url)
  const session = await requireModuleOrRole(req, "loans", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  if (searchParams.get("count")) {
    let q = db.from("loan_applications").select("*", { count: "exact", head: true })
    if (branchId) q = q.eq("branch_id", branchId)
    const { count } = await q
    return NextResponse.json({ count: count ?? 0 })
  }

  const id = searchParams.get("id")
  if (id) {
    let q = db.from("loan_applications").select("*")
    if (branchId) q = q.eq("branch_id", branchId)
    const { data, error } = await q.eq("id", id).single()
    if (error) return apiError(error, 404)
    return NextResponse.json(data)
  }

  // NOTE: loan_applications has submitted_at, NOT created_at — ordering by the
  // nonexistent column made this whole query 500 while the count query above
  // succeeded, so the sidebar badge said "1" while the list showed empty.
  // PERF (2026-09): bounded list — this endpoint is polled every 15s.
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "1000", 10) || 1000, 1), 5000)
  let listQuery = db.from("loan_applications").select("*")
  if (branchId) listQuery = listQuery.eq("branch_id", branchId)
  const { data, error } = await listQuery.order("submitted_at", { ascending: false }).limit(limit)
  if (error) return apiError(error)
  // FIX (2026-09-20): PAN is a regulated financial identifier — the list
  // response shipped it in full to every reader on every poll. Mask it here
  // (the single-application detail view still returns the real value).
  const masked = (data || []).map((row: Record<string, unknown>) => ({
    ...row,
    pan_number: typeof row.pan_number === "string" && row.pan_number.length >= 10
      ? `${row.pan_number.slice(0, 2)}${"X".repeat(row.pan_number.length - 4)}${row.pan_number.slice(-2)}`
      : row.pan_number
      ? "XXXXX"
      : null,
  }))
  return NextResponse.json(masked)
})

export const POST = withRoute("loans", async (req: NextRequest) => {
  // The customer-facing form (app/api/form/[token]) inserts directly, not
  // through here — this is the staff/dashboard creation path.
  const session = await requireModuleOrRole(req, "loans", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await readJson(req)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })
  // Only columns that actually exist on loan_applications. Older clients send
  // tenure_months / product — map them instead of writing a phantom column
  // (which Postgres rejects with 42703 and the caller sees a 500).
  const WRITABLE = new Set([
    "lead_id", "branch_id", "loan_type", "loan_amount", "loan_tenure",
    "monthly_income", "employment_type", "city", "pan_number", "form_data", "status",
  ])
  const ALIASES: Record<string, string> = { tenure_months: "loan_tenure", product: "loan_type" }
  const payload: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    const key = ALIASES[k] || k
    if (WRITABLE.has(key)) payload[key] = v
  }
  payload.branch_id = sessionBranchId(session)
  const { data, error } = await db.from("loan_applications").insert(payload).select().single()
  if (error) return apiError(error)
  logAudit("loan application created", session.email, { loanAppId: data?.id, customerName: body.customer_name })
  return NextResponse.json(data)
})

export const PATCH = withRoute("loans", async (req: NextRequest) => {
  const session = await requireModuleOrRole(req, "loans", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const parsed = await readJson(req)
  if (!parsed) return NextResponse.json({ error: "invalid body" }, { status: 400 })
  const { id, ...raw } = parsed
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id required" }, { status: 400 })
  // 2026-09 fix (mass assignment): server-managed columns are not writable
  // from the client — the old spread let a crafted PATCH set branch_id or
  // submitted_at (moving applications between branches / backdating them).
  const PROTECTED = new Set(["id", "branch_id", "submitted_at", "created_at"])
  const updates: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!PROTECTED.has(k)) updates[k] = v
  }
  const branchId = sessionBranchId(session)
  let upQuery = db.from("loan_applications").update(updates)
  if (branchId) upQuery = upQuery.eq("branch_id", branchId)
  const { data, error } = await upQuery.eq("id", id).select().single()
  if (error) return apiError(error)
  if (!data) return NextResponse.json({ error: "application not found in your branch" }, { status: 404 })

  // Log to audit
  logAudit("loan application updated", session.email, { loanAppId: id, fields: Object.keys(updates) })

  // Append entry to status_history if status, reason, or remarks were modified
  if (updates.status || updates.status_reason || updates.remarks) {
    const historyEntry = {
      status: updates.status || data.status,
      status_reason: updates.status_reason || data.status_reason || null,
      remarks: updates.remarks || data.remarks || null,
      updated_by: session.email || "staff",
      updated_at: new Date().toISOString(),
    }
    await query(
      `UPDATE loan_applications
       SET status_history = COALESCE(status_history, '[]'::jsonb) || $1::jsonb
       WHERE id = $2`,
      [JSON.stringify([historyEntry]), id]
    ).catch(() => {})

    // Invalidate lead brief cache and sync status/remarks to leads table
    const targetLeadId = data.lead_id
    const targetPhone = data.phone
    const newStatus = String(updates.status || data.status)
    const summaryText = `Status: ${newStatus}${updates.status_reason ? ` (${updates.status_reason})` : ""}${updates.remarks ? ` — Note: ${updates.remarks}` : ""}`

    if (targetLeadId || targetPhone) {
      if (targetLeadId) invalidateLeadBriefCache(targetLeadId)
      
      // Sync status & append remark to leads.notes
      await query(
        `UPDATE leads
         SET status = $1,
             notes = CASE 
               WHEN notes IS NULL OR notes = '' THEN $2 
               ELSE notes || E'\n' || $2 
             END,
             updated_at = now()
         WHERE (id = $3::uuid OR (phone = $4 AND $4 IS NOT NULL AND $4 <> ''))`,
        [newStatus, `[Loan Status Update] ${summaryText}`, targetLeadId || null, targetPhone || null]
      ).catch(() => {})

      if (targetLeadId) {
        await query(
          `INSERT INTO lead_interactions (lead_id, channel, direction, one_line_summary, occurred_at)
           VALUES ($1, 'manual', 'out', $2, now())
           ON CONFLICT DO NOTHING`,
          [targetLeadId, summaryText.slice(0, 500)]
        ).catch(() => {})
      }
    }
  }

  // Two-way sync: If customer details (name, phone, amount, type) were modified in loan_applications, sync back to leads
  if (data.lead_id || data.phone) {
    const rawAny = raw as Record<string, any>
    const nameToSync = rawAny.customer_name || rawAny.full_name
    const phoneToSync = rawAny.phone || rawAny.whatsapp_number
    const amountToSync = rawAny.loan_amount
    const typeToSync = rawAny.loan_type

    if (nameToSync || phoneToSync || amountToSync || typeToSync) {
      // Never overwrite an existing/uploaded lead name — lead name is final
      await query(
        `UPDATE leads
         SET name = CASE WHEN name IS NULL OR name = '' OR name = 'Customer' THEN COALESCE($1, name) ELSE name END,
             phone = COALESCE($2, phone),
             whatsapp_number = COALESCE($2, whatsapp_number),
             loan_amount = COALESCE($3, loan_amount),
             product_interest = COALESCE($4, product_interest),
             updated_at = now()
         WHERE (id = $5::uuid OR (phone = $6 AND $6 IS NOT NULL AND $6 <> ''))`,
        [nameToSync || null, phoneToSync || null, amountToSync || null, typeToSync || null, data.lead_id || null, data.phone || null]
      ).catch(() => {})
    }
  }

  return NextResponse.json(data)
})
