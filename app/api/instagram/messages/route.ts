import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "instagram", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const igUserId = searchParams.get("ig_user_id")
  const leadId = searchParams.get("lead_id")

  if (!igUserId && !leadId) {
    return NextResponse.json({ error: "ig_user_id or lead_id required" }, { status: 400 })
  }

  const branchId = sessionBranchId(session)

  try {
    let sql = `
      SELECT m.*, l.name as lead_name, l.phone as lead_phone
      FROM instagram_messages m
      LEFT JOIN leads l ON m.lead_id = l.id
      WHERE 1=1
    `
    const params: any[] = []

    if (igUserId) {
      params.push(igUserId)
      sql += ` AND m.ig_user_id = $${params.length}`
    } else if (leadId) {
      params.push(leadId)
      sql += ` AND m.lead_id = $${params.length}`
    }

    if (branchId) {
      params.push(branchId)
      sql += ` AND m.branch_id = $${params.length}`
    }

    sql += ` ORDER BY m.created_at ASC`

    const res = await query(sql, params)
    return NextResponse.json(res.rows)
  } catch (e: any) {
    console.error("Failed to fetch Instagram messages:", e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
