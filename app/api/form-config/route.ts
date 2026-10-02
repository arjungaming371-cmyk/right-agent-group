import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

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

// SECURITY: the WhatsApp loan form schema is ORG-GLOBAL (single
// form_configs row shared by every branch). Writing it changes the
// customer-facing form for ALL branches — dropping a required field here
// silently weakens lead capture everywhere. Only admin/developer may
// write it; branch managers keep read access via the same public GET.
export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
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

    logAudit("loan form config updated", session.email, {
      fields: Object.keys(merged?.enabled_fields || {}).length,
    })

    return NextResponse.json({ ok: true, config: merged })
  } catch (e: any) {
    return apiError(e)
  }
}
