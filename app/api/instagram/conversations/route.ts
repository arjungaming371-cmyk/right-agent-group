import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "instagram", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const branchId = sessionBranchId(session)

  try {
    let sql = `
      SELECT DISTINCT ON (m.ig_user_id)
        m.ig_user_id,
        m.ig_username,
        m.lead_id,
        m.content AS last_message,
        m.direction AS last_direction,
        m.type AS last_type,
        m.created_at AS last_time,
        l.name AS lead_name,
        l.phone AS lead_phone,
        l.status AS lead_status,
        (
          SELECT COUNT(*)::int
          FROM instagram_messages u
          WHERE u.ig_user_id = m.ig_user_id
            AND u.direction = 'inbound'
            AND u.status != 'read'
        ) AS unread_count
      FROM instagram_messages m
      LEFT JOIN leads l ON m.lead_id = l.id
    `

    const params: any[] = []
    if (branchId) {
      sql += ` WHERE m.branch_id = $1 `
      params.push(branchId)
    }

    sql += ` ORDER BY m.ig_user_id, m.created_at DESC `

    // PERF (2026-09): bounded list — polled every 5s by the dashboard; without
    // a LIMIT both the DISTINCT ON scan and the per-group COUNT grow forever.
    params.push(200)
    sql += ` LIMIT $${params.length}`

    const res = await query(sql, params)

    // Sort by last_time DESC for final response
    const conversations = res.rows.sort((a, b) => new Date(b.last_time).getTime() - new Date(a.last_time).getTime())

    return NextResponse.json(conversations)
  } catch (e: any) {
    console.error("Failed to fetch Instagram conversations:", e.message)
    return apiError(e)
  }
}
