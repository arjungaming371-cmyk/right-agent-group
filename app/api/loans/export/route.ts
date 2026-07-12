import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/auth"
import { toCsv } from "@/lib/csv"

export const dynamic = "force-dynamic"

const COLUMNS = [
  "customer_name", "phone", "whatsapp_number", "email", "city", "address",
  "loan_type", "loan_amount", "employment_type", "monthly_income", "status", "submitted_at",
]

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const res = await query(`SELECT ${COLUMNS.join(", ")} FROM loan_applications ORDER BY submitted_at DESC`)
  const csv = toCsv(res.rows, COLUMNS)
  const filename = `loan-applications-${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
