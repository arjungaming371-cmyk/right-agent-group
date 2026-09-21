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

    // FIX (2026-09-20): unbounded result set + correlated unread subquery per
    // row — cap at the 100 most recent conversations (mirrors the WhatsApp view).
    sql = `
      SELECT * FROM (
        ${sql} ORDER BY m.ig_user_id, m.created_at DESC
      ) conv ORDER BY conv.last_time DESC`

    params.push(100)
    sql += ` LIMIT $${params.length}`

    const res = await query(sql, params)

    return NextResponse.json(res.rows)
  } catch (e: any) {
    console.error("Failed to fetch Instagram conversations:", e.message)
    return apiError(e)
  }
}
