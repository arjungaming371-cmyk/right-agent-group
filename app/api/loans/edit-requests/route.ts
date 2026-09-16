import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

// GET — list edit requests, newest first. Defaults to pending only (what the
// dashboard's approval queue needs); ?status=all|approved|rejected for the
// history view on a given application.
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") || "pending"
  const applicationId = searchParams.get("applicationId")

  const where: string[] = []
  const params: any[] = []
  let i = 1

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
}
