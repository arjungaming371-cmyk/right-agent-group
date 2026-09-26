import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

// Conversation list for the Instagram view. Since 2026-09-26 it also carries
// the social-prospect lane fields (is_social_prospect / promoted_to_crm_at /
// ig_phone_extracted) so the right panel can show the "not in CRM yet" pill
// and pre-fill the Convert-to-Lead phone box. On a database where the
// Instagram Separation migration has not run yet, the enhanced SELECT names
// columns that don't exist — Postgres rejects the WHOLE statement — so we
// fall back to the legacy shape (no lane fields) instead of breaking the view.

const SOCIAL_COLS = `l.is_social_prospect, l.promoted_to_crm_at, l.ig_phone_extracted,`

function baseSql(socialCols: string) {
  return `
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
        ${socialCols}
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
}

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "instagram", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const branchId = sessionBranchId(session)

  try {
    let sql = baseSql(SOCIAL_COLS)

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
    // Pre-migration DB (42703 = column does not exist) → legacy shape without
    // the lane fields. Any other error is a real failure.
    if (e?.code !== "42703") {
      console.error("Failed to fetch Instagram conversations:", e.message)
      return apiError(e)
    }
  }

  try {
    let sql = baseSql("")
    const params: any[] = []
    if (branchId) {
      sql += ` WHERE m.branch_id = $1 `
      params.push(branchId)
    }
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
