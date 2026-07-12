import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/auth"
import { toCsv } from "@/lib/csv"

export const dynamic = "force-dynamic"

const COLUMNS = [
  "name", "phone", "whatsapp_number", "address", "product_interest", "loan_amount",
  "status", "interested", "score", "language", "source", "call_count", "created_at",
]

// Read-only export, available to every logged-in role — exporting data you
// can already see in the Leads table isn't a new privilege, just a format.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const res = await query(`SELECT ${COLUMNS.join(", ")} FROM leads ORDER BY created_at DESC`)
  const csv = toCsv(res.rows, COLUMNS)
  const filename = `leads-${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
