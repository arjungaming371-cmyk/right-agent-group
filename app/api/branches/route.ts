import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { canManageBranches, invalidateBranchCache, type BranchRow } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// Multi-branch admin surface — the parent account manages every branch here.
//
// GET  /api/branches   → all branches (admin/developer) or the session's branch
// POST /api/branches   → create a branch sub-account (admin/developer)
//
// Secrets (Exotel API keys, WhatsApp tokens) are NEVER returned — each
// response carries `<field>_set: true|false` so the UI can show what's
// configured without leaking credentials.

function safeBranch(b: BranchRow) {
  return {
    id: b.id,
    org_id: b.org_id,
    name: b.name,
    code: b.code,
    region: b.region,
    status: b.status,
    // telephony — caller id is not secret; credentials are
    exotel_sid: b.exotel_sid || null,
    exotel_caller_id: b.exotel_caller_id || null,
    exotel_flow_app_id: b.exotel_flow_app_id || null,
    exotel_api_key_set: !!b.exotel_api_key,
    exotel_api_token_set: !!b.exotel_api_token,
    // whatsapp
    whatsapp_phone_number_id: b.whatsapp_phone_number_id || null,
    whatsapp_display_name: b.whatsapp_display_name || null,
    whatsapp_token_set: !!b.whatsapp_token,
    // instagram — token is write-only, exactly like the WhatsApp token
    instagram_account_id: b.instagram_account_id || null,
    instagram_token_set: !!b.instagram_token,
    // white-label
    brand_name: b.brand_name,
    brand_logo_url: b.brand_logo_url,
    brand_primary_color: b.brand_primary_color,
    brand_tagline: b.brand_tagline,
    // quotas
    monthly_call_limit: b.monthly_call_limit,
    monthly_whatsapp_limit: b.monthly_whatsapp_limit,
    max_ai_employees: b.max_ai_employees,
    created_at: b.created_at,
    updated_at: b.updated_at,
  }
}

export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    // Branch-scoped roles see exactly their branch; admins see everything.
    const res = session.branchId
      ? await query(`SELECT * FROM branches WHERE id = $1 ORDER BY name`, [session.branchId])
      : await query(`SELECT * FROM branches ORDER BY name`)
    return NextResponse.json((res.rows as BranchRow[]).map(safeBranch))
  } catch (e: any) {
    return apiError(e)
  }
}

const CODE_RE = /^[A-Za-z0-9_-]{2,16}$/

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (!canManageBranches(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  try {
    const body = await req.json()
    const name = String(body?.name || "").trim()
    const code = String(body?.code || "").trim().toUpperCase()
    if (!name || name.length > 80) return NextResponse.json({ error: "name required (max 80 chars)" }, { status: 400 })
    if (!CODE_RE.test(code)) return NextResponse.json({ error: "code must be 2-16 letters/digits (e.g. HYD)" }, { status: 400 })

    const org = await query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`)
    const orgId = org.rows[0]?.id
    if (!orgId) return NextResponse.json({ error: "No organization exists — run npm run db:setup" }, { status: 500 })

    const res = await query(
      `INSERT INTO branches (org_id, name, code, region, status,
         exotel_caller_id, whatsapp_phone_number_id, whatsapp_display_name,
         instagram_account_id, instagram_token,
         brand_name, brand_logo_url, brand_primary_color, brand_tagline,
         monthly_call_limit, monthly_whatsapp_limit, max_ai_employees)
       VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        orgId, name, code,
        body?.region ? String(body.region).slice(0, 80) : null,
        body?.exotel_caller_id ? String(body.exotel_caller_id).trim() : null,
        body?.whatsapp_phone_number_id ? String(body.whatsapp_phone_number_id).trim() : null,
        body?.whatsapp_display_name ? String(body.whatsapp_display_name).slice(0, 80) : null,
        body?.instagram_account_id ? String(body.instagram_account_id).trim() : null,
        body?.instagram_token ? String(body.instagram_token).trim() : null,
        body?.brand_name ? String(body.brand_name).slice(0, 80) : null,
        body?.brand_logo_url ? String(body.brand_logo_url).slice(0, 500) : null,
        body?.brand_primary_color ? String(body.brand_primary_color).slice(0, 20) : "#4f46e5",
        body?.brand_tagline ? String(body.brand_tagline).slice(0, 160) : null,
        body?.monthly_call_limit == null ? null : parseInt(body.monthly_call_limit, 10) || null,
        body?.monthly_whatsapp_limit == null ? null : parseInt(body.monthly_whatsapp_limit, 10) || null,
        body?.max_ai_employees == null ? null : parseInt(body.max_ai_employees, 10) || null,
      ]
    )
    invalidateBranchCache(res.rows[0]?.id)
    logAudit("branch created", session.email, { branch: code, name })
    return NextResponse.json(safeBranch(res.rows[0] as BranchRow), { status: 201 })
  } catch (e: any) {
    if (e.message?.includes("branches_code_key") || e.message?.includes("duplicate key")) {
      return NextResponse.json({ error: "A branch with that code already exists" }, { status: 409 })
    }
    return apiError(e)
  }
}
