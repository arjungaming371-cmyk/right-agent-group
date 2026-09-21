import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export async function GET(req: NextRequest) {
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
  const masked = (data || []).map((row: any) => ({
    ...row,
    pan_number: typeof row.pan_number === "string" && row.pan_number.length >= 10
      ? `${row.pan_number.slice(0, 2)}${"X".repeat(row.pan_number.length - 4)}${row.pan_number.slice(-2)}`
      : row.pan_number
      ? "XXXXX"
      : null,
  }))
  return NextResponse.json(masked)
}

export async function POST(req: NextRequest) {
  // The customer-facing form (app/api/form/[token]) inserts directly, not
  // through here — this is the staff/dashboard creation path.
  const session = await requireModuleOrRole(req, "loans", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  body.branch_id = sessionBranchId(session)
  const { data, error } = await db.from("loan_applications").insert(body).select().single()
  if (error) return apiError(error)
  logAudit("loan application created", session.email, { loanAppId: data?.id, customerName: body.customer_name })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const session = await requireModuleOrRole(req, "loans", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, ...raw } = await req.json()
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
  logAudit("loan application updated", session.email, { loanAppId: id, fields: Object.keys(updates) })
  return NextResponse.json(data)
}
