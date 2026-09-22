import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { canManageBranches, invalidateBranchCache, getBranch, type BranchRow } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// GET    /api/branches/[id]  → one branch (admin/developer, or its own managers)
// PATCH  /api/branches/[id]  → update config/branding/quotas/numbers (admin/developer)
// DELETE /api/branches/[id]  → delete the branch (admin/developer)
//
// Secret fields are write-only: sending a non-empty value replaces it, an
// empty string clears it, and omitting the field keeps the stored one.

type Ctx = { params: Promise<{ id: string }> }

async function loadBranch(req: NextRequest, ctx: Ctx) {
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager", "developer"])
  if (!session) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const { id } = await ctx.params
  const branch = await getBranch(id)
  if (!branch) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) }
  // Branch-scoped roles may READ their own branch only; management stays admin-only.
  if (session.branchId && session.branchId !== id) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  }
  return { session, branch }
}

function safeBranch(b: BranchRow) {
  return {
    id: b.id, org_id: b.org_id, name: b.name, code: b.code, region: b.region, status: b.status,
    exotel_sid: b.exotel_sid || null, exotel_caller_id: b.exotel_caller_id || null,
    exotel_flow_app_id: b.exotel_flow_app_id || null,
    exotel_api_key_set: !!b.exotel_api_key, exotel_api_token_set: !!b.exotel_api_token,
    whatsapp_phone_number_id: b.whatsapp_phone_number_id || null,
    whatsapp_display_name: b.whatsapp_display_name || null,
    whatsapp_token_set: !!b.whatsapp_token,
    instagram_account_id: b.instagram_account_id || null,
    instagram_token_set: !!b.instagram_token,
    brand_name: b.brand_name, brand_logo_url: b.brand_logo_url,
    brand_primary_color: b.brand_primary_color, brand_tagline: b.brand_tagline,
    monthly_call_limit: b.monthly_call_limit,
    monthly_whatsapp_limit: b.monthly_whatsapp_limit,
    max_ai_employees: b.max_ai_employees,
    created_at: b.created_at, updated_at: b.updated_at,
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const loaded = await loadBranch(req, ctx)
  if (loaded.error) return loaded.error
  return NextResponse.json(safeBranch(loaded.branch!))
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const loaded = await loadBranch(req, ctx)
  if (loaded.error) return loaded.error
  const { session, branch } = loaded
  if (!canManageBranches(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  try {
    const body = await req.json()
    const sets: string[] = []
    const params: any[] = []
    const push = (col: string, value: any) => {
      params.push(value)
      sets.push(`${col} = $${params.length}`)
    }

    if (typeof body?.name === "string" && body.name.trim()) push("name", body.name.trim().slice(0, 80))
    if (typeof body?.region === "string") push("region", body.region.trim().slice(0, 80) || null)
    if (body?.status === "active" || body?.status === "suspended") push("status", body.status)

    // Telephony
    if ("exotel_sid" in (body || {})) push("exotel_sid", String(body.exotel_sid || "").trim() || null)
    if ("exotel_caller_id" in (body || {})) push("exotel_caller_id", String(body.exotel_caller_id || "").trim() || null)
    if ("exotel_flow_app_id" in (body || {})) push("exotel_flow_app_id", String(body.exotel_flow_app_id || "").trim() || null)
    if ("exotel_api_key" in (body || {})) push("exotel_api_key", String(body.exotel_api_key || "").trim() || null)
    if ("exotel_api_token" in (body || {})) push("exotel_api_token", String(body.exotel_api_token || "").trim() || null)

    // WhatsApp
    if ("whatsapp_phone_number_id" in (body || {})) push("whatsapp_phone_number_id", String(body.whatsapp_phone_number_id || "").trim() || null)
    if ("whatsapp_token" in (body || {})) push("whatsapp_token", String(body.whatsapp_token || "").trim() || null)
    if ("whatsapp_display_name" in (body || {})) push("whatsapp_display_name", String(body.whatsapp_display_name || "").trim().slice(0, 80) || null)

    // Instagram (branch's own IG business account — write-only token,
    // same contract as whatsapp_token above)
    if ("instagram_account_id" in (body || {})) push("instagram_account_id", String(body.instagram_account_id || "").trim() || null)
    if ("instagram_token" in (body || {})) push("instagram_token", String(body.instagram_token || "").trim() || null)

    // White-label
    if ("brand_name" in (body || {})) push("brand_name", String(body.brand_name || "").trim().slice(0, 80) || null)
    if ("brand_logo_url" in (body || {})) push("brand_logo_url", String(body.brand_logo_url || "").trim().slice(0, 500) || null)
    if ("brand_primary_color" in (body || {})) push("brand_primary_color", /^#[0-9a-fA-F]{3,8}$/.test(body.brand_primary_color) ? body.brand_primary_color : "#4f46e5")
    if ("brand_tagline" in (body || {})) push("brand_tagline", String(body.brand_tagline || "").trim().slice(0, 160) || null)

    // Quotas (0 or null = unlimited)
    for (const key of ["monthly_call_limit", "monthly_whatsapp_limit", "max_ai_employees"] as const) {
      if (key in (body || {})) {
        const n = parseInt(body[key], 10)
        push(key, Number.isFinite(n) && n > 0 ? n : null)
      }
    }

    if (!sets.length) return NextResponse.json({ error: "nothing to update" }, { status: 400 })
    params.push(branch!.id)
    const res = await query(`UPDATE branches SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params)
    invalidateBranchCache(branch!.id)
    logAudit("branch updated", session!.email, { branch: branch!.code, fields: sets.map((s) => s.split(" ")[0]) })
    return NextResponse.json(safeBranch(res.rows[0] as BranchRow))
  } catch (e: any) {
    return apiError(e)
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const loaded = await loadBranch(req, ctx)
  if (loaded.error) return loaded.error
  const { session, branch } = loaded
  if (!canManageBranches(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  try {
    await query(`DELETE FROM branches WHERE id = $1`, [branch!.id])
    invalidateBranchCache(branch!.id)
    logAudit("branch deleted", session!.email, { branch: branch!.code })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return apiError(e)
  }
}
