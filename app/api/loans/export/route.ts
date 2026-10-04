import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { toCsv } from "@/lib/csv"
import { withRoute } from "@/lib/api-route"
import { rateLimit } from "@/lib/rate-limit"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

const COLUMNS = [
  "customer_name", "phone", "whatsapp_number", "email", "city", "address",
  "loan_type", "loan_amount", "employment_type", "monthly_income", "status", "submitted_at",
]

export const GET = withRoute("loans/export", async (req: NextRequest) => {
  const session = await requireModuleOrRole(req, "loans", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // Throttle + audit: an export moves the whole dataset out of the platform.
  if (!rateLimit(`export:${session.email}`, 6, 60_000)) {
    return NextResponse.json({ error: "Too many exports in a minute — please wait and retry." }, { status: 429 })
  }

  const branchId = sessionBranchId(session)
  const res = branchId
    ? await query(`SELECT ${COLUMNS.join(", ")} FROM loan_applications WHERE branch_id = $1 ORDER BY submitted_at DESC LIMIT 50000`, [branchId])
    : await query(`SELECT ${COLUMNS.join(", ")} FROM loan_applications ORDER BY submitted_at DESC LIMIT 50000`)

  const csv = toCsv(res.rows, COLUMNS)
  const filename = `loan-applications-${new Date().toISOString().slice(0, 10)}.csv`

  logAudit("loan applications exported", session.email, { rows: res.rows.length, branch: branchId ?? "all" })

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
})
