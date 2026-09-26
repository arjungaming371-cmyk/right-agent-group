import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { apiError } from "@/lib/api-error"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

// GET /api/instagram/leads — the Social Prospects lane (2026-09-26).
//
// Returns phone-less Instagram inquirers (is_social_prospect = true) with
// their IG metadata and the last interaction, newest interaction first. This
// is the contract from the Instagram Separation plan; the Leads view's
// "Instagram Prospects" tab consumes /api/leads?scope=social (same row shape
// as the CRM table) — this endpoint serves IG-specific consumers and future
// surfaces that want the enriched payload.
//
// status the client derives (no invented DB statuses):
//   - ig_phone_extracted set → "phone_detected" (Convert box can pre-fill)
//   - promoted_to_crm_at set → "promoted" (should not appear here; listed for safety)

const SOCIAL_SELECT = `
      SELECT l.id, l.lead_code, l.name, l.status, l.source, l.product_interest,
             l.notes, l.language, l.created_at, l.updated_at,
             l.instagram_handle, l.ig_user_id,
             l.is_social_prospect, l.promoted_to_crm_at, l.ig_phone_extracted, l.phone,
             lm.content  AS last_message,
             lm.direction AS last_direction,
             lm.type      AS last_type,
             lm.created_at AS last_interaction_at
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT content, direction, type, created_at
        FROM instagram_messages m
        WHERE m.lead_id = l.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) lm ON true
      WHERE l.is_social_prospect = true
`

// Pre-migration fallback: same lane, derived the old way from source + phone.
const LEGACY_SELECT = `
      SELECT l.id, l.lead_code, l.name, l.status, l.source, l.product_interest,
             l.notes, l.language, l.created_at, l.updated_at,
             l.instagram_handle, l.ig_user_id,
             false AS is_social_prospect, NULL::timestamptz AS promoted_to_crm_at,
             NULL::text AS ig_phone_extracted, l.phone,
             lm.content  AS last_message,
             lm.direction AS last_direction,
             lm.type      AS last_type,
             lm.created_at AS last_interaction_at
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT content, direction, type, created_at
        FROM instagram_messages m
        WHERE m.lead_id = l.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) lm ON true
      WHERE l.source IN ('Instagram DM', 'Instagram Comment')
        AND (l.phone IS NULL OR l.phone LIKE 'IG%')
`

async function listProspects(sqlBody: string, branchId: string | null) {
  const params: any[] = []
  let sql = sqlBody
  if (branchId) {
    sql += ` AND l.branch_id = $1`
    params.push(branchId)
  }
  sql += ` ORDER BY COALESCE(lm.created_at, l.created_at) DESC LIMIT 500`
  return query(sql, params)
}

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "instagram", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  try {
    const res = await listProspects(SOCIAL_SELECT, branchId)
    return NextResponse.json(res.rows)
  } catch (e: any) {
    if (e?.code !== "42703") return apiError(e) // migration not run → legacy lane
  }
  try {
    const res = await listProspects(LEGACY_SELECT, branchId)
    return NextResponse.json(res.rows)
  } catch (e: any) {
    return apiError(e)
  }
}
