import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "instagram", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const branchId = sessionBranchId(session)

  try {
    let sql = `SELECT COUNT(*)::int as count FROM instagram_messages WHERE direction = 'inbound' AND status != 'read'`
    const params: any[] = []

    if (branchId) {
      sql += ` AND branch_id = $1`
      params.push(branchId)
    }

    const res = await query(sql, params)
    return NextResponse.json({ count: res.rows[0]?.count || 0 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
