import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { getBranch, currentMonth } from "@/lib/branches"

export const dynamic = "force-dynamic"

// GET /api/branches/[id]/usage  → per-branch usage history (centralized billing)
//
// Billing stays on the PARENT account: Sarvam/Exotel/Meta invoices are paid
// once for the whole organization, and this endpoint is what lets the admin
// allocate those costs per branch (calls, talk-time, WhatsApp sends, STT/TTS
// volumes — the unit dimensions each vendor actually bills by).
//
// ?month=YYYY-MM for one month; default = last 12 months.

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await requireRole(req, ["admin", "branch_manager", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  // Branch managers may read their own branch's usage only.
  if (session.branchId && session.branchId !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const branch = await getBranch(id)
  if (!branch) return NextResponse.json({ error: "not found" }, { status: 404 })

  const month = req.nextUrl.searchParams.get("month")
  try {
    const rows = month
      ? (await query(`SELECT * FROM branch_usage WHERE branch_id = $1 AND month = $2`, [id, month])).rows
      : (await query(
          `SELECT * FROM branch_usage WHERE branch_id = $1 ORDER BY month DESC LIMIT 12`,
          [id]
        )).rows

    const thisMonth = (rows as any[]).find((r) => r.month === currentMonth())
    return NextResponse.json({
      branch: { id: branch.id, name: branch.name, code: branch.code, status: branch.status },
      limits: {
        monthly_call_limit: branch.monthly_call_limit,
        monthly_whatsapp_limit: branch.monthly_whatsapp_limit,
        max_ai_employees: branch.max_ai_employees,
      },
      current_month: thisMonth || { month: currentMonth(), calls_made: 0, call_seconds: 0, whatsapp_messages: 0, stt_seconds: 0, tts_characters: 0, llm_tokens: 0 },
      history: rows,
    })
  } catch (e: any) {
    return apiError(e)
  }
}
