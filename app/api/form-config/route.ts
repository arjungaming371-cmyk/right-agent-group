import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

const DEFAULT_CONFIG = {
  title: "Loan Application",
  subtitle: "Complete your application in under 2 minutes",
  loan_types: [
    "Home Loan",
    "Business Loan",
    "Personal Loan",
    "Loan Against Property (LAP)",
    "Education Loan",
    "Vehicle Loan",
    "Gold Loan"
  ],
  enabled_fields: {
    city: true,
    loan_amount: true,
    loan_tenure: true,
    employment_type: true,
    monthly_income: true,
    pan_number: true,
    address: true,
    email: true,
  },
  required_fields: {
    customer_name: true,
    whatsapp_number: true,
    loan_amount: true,
    loan_tenure: true,
    employment_type: true,
    monthly_income: true,
  },
  custom_fields: [] as Array<{
    id: string
    label: string
    type: "text" | "number" | "select"
    options?: string[]
    required: boolean
  }>,
}

export async function GET() {
  try {
    const res = await query(`SELECT config FROM form_configs WHERE id = 'whatsapp_loan_form'`)
    if (res.rowCount && res.rows[0].config) {
      return NextResponse.json({ ...DEFAULT_CONFIG, ...res.rows[0].config })
    }
  } catch {}
  return NextResponse.json(DEFAULT_CONFIG)
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const merged = {
      ...DEFAULT_CONFIG,
      ...body,
    }

    await query(
      `INSERT INTO form_configs (id, config, updated_at)
       VALUES ('whatsapp_loan_form', $1, now())
       ON CONFLICT (id) DO UPDATE SET config = $1, updated_at = now()`,
      [JSON.stringify(merged)]
    )

    return NextResponse.json({ ok: true, config: merged })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to save configuration" }, { status: 500 })
  }
}
