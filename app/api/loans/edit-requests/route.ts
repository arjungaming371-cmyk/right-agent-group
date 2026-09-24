import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { withRoute } from "@/lib/api-route"

// GET — list edit requests, newest first. Defaults to pending only (what the
// dashboard's approval queue needs); ?status=all|approved|rejected for the
// history view on a given application.
export const GET = withRoute("loans/edit-requests", async (req: NextRequest) => {
  const session = await requireModuleOrRole(req, "loans", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const branchId = sessionBranchId(session)
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") || "pending"
  const applicationId = searchParams.get("applicationId")

  const where: string[] = []
  const params: unknown[] = []
  let i = 1

  if (branchId) {
    where.push(`la.branch_id = $${i}`)
    params.push(branchId)
    i++
  }
  if (status !== "all") {
    where.push(`er.status = $${i}`)
    params.push(status)
    i++
  }
  if (applicationId) {
    where.push(`er.loan_application_id = $${i}`)
    params.push(applicationId)
    i++
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : ""

  const res = await query(
    `SELECT er.*, la.customer_name, la.loan_type AS current_loan_type, l.name AS lead_name
     FROM loan_application_edit_requests er
     LEFT JOIN loan_applications la ON la.id = er.loan_application_id
     LEFT JOIN leads l ON l.id = er.lead_id
     ${whereClause}
     ORDER BY er.created_at DESC
     LIMIT 100`,
    params
  )
  return NextResponse.json(res.rows)
})
