import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// Per-chat settings, real-WhatsApp style:
// PATCH { leadId, archived?, muted? } — archive/unarchive, mute/unmute.
// The conversations list filters on wa_archived; the UI shows a muted icon
// off wa_muted. Branch-scoped staff can only touch their own branch's leads.
export async function PATCH(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { leadId, archived, muted } = await req.json()
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 })
  if (archived === undefined && muted === undefined) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 })
  }

  const branchId = sessionBranchId(session)
  if (branchId) {
    const owner = await query(`SELECT branch_id FROM leads WHERE id = $1 LIMIT 1`, [leadId])
    if (!owner.rows[0] || owner.rows[0].branch_id !== branchId) {
      return NextResponse.json({ error: "Lead not found in your branch" }, { status: 404 })
    }
  }

  const sets: string[] = []
  const params: any[] = [leadId]
  if (archived !== undefined) { params.push(!!archived); sets.push(`wa_archived = $${params.length}`) }
  if (muted !== undefined)    { params.push(!!muted);    sets.push(`wa_muted = $${params.length}`) }

  try {
    await query(`UPDATE leads SET ${sets.join(", ")} WHERE id = $1`, params)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e?.code === "42703") {
      return NextResponse.json(
        { error: "Chat settings not available — run migrations/2026-09-22_whatsapp_rich_chat.sql (or scripts/run-migrations.js)" },
        { status: 501 }
      )
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
