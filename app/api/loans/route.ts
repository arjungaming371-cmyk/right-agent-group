import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager"])
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
  let listQuery = db.from("loan_applications").select("*")
  if (branchId) listQuery = listQuery.eq("branch_id", branchId)
  const { data, error } = await listQuery.order("submitted_at", { ascending: false })
  if (error) return apiError(error)
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  // The customer-facing form (app/api/form/[token]) inserts directly, not
  // through here — this is the staff/dashboard creation path.
  const session = await requireRole(req, ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  body.branch_id = sessionBranchId(session)
  const { data, error } = await db.from("loan_applications").insert(body).select().single()
  if (error) return apiError(error)
  logAudit("loan application created", session.email, { loanAppId: data?.id, customerName: body.customer_name })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, ...updates } = await req.json()
  const branchId = sessionBranchId(session)
  let upQuery = db.from("loan_applications").update(updates)
  if (branchId) upQuery = upQuery.eq("branch_id", branchId)
  const { data, error } = await upQuery.eq("id", id).select().single()
  if (error) return apiError(error)
  if (!data) return NextResponse.json({ error: "application not found in your branch" }, { status: 404 })
  logAudit("loan application updated", session.email, { loanAppId: id, fields: Object.keys(updates) })
  return NextResponse.json(data)
}
