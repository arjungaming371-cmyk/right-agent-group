import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leadId = searchParams.get("leadId")
  const limit  = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "100") || 100))
  if (!leadId) return NextResponse.json([])

  const branchId = sessionBranchId(session)
  if (branchId) {
    const leadCheck = await query(`SELECT branch_id FROM leads WHERE id = $1 LIMIT 1`, [leadId])
    if (leadCheck.rows.length === 0 || leadCheck.rows[0].branch_id !== branchId) {
      return NextResponse.json({ error: "Lead not found in your branch" }, { status: 404 })
    }
  }

  try {
    const result = await query(
      `SELECT id, direction, content, status, created_at
       FROM whatsapp_messages
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [leadId, limit]
    )
    return NextResponse.json(result.rows.reverse())
  } catch (e: any) {
    return apiError(e)
  }
}
