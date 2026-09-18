import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// Mark all inbound messages for a lead as read (clears unread badge)
export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const { leadId } = await req.json()
    if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 })

    const branchId = sessionBranchId(session)
    if (branchId) {
      const leadCheck = await query(`SELECT branch_id FROM leads WHERE id = $1 LIMIT 1`, [leadId])
      if (leadCheck.rows.length === 0 || leadCheck.rows[0].branch_id !== branchId) {
        return NextResponse.json({ error: "Lead not found in your branch" }, { status: 404 })
      }
    }

    await query(
      `UPDATE whatsapp_messages SET status = 'read' WHERE lead_id = $1 AND direction = 'inbound' AND status = 'received'`,
      [leadId]
    )
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return apiError(e)
  }
}
