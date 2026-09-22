import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// One fast query: every lead with a phone, with their latest WhatsApp
// message and unread count, sorted so active conversations are on top.
//
// 2026-09-22 (real-WhatsApp parity): also returns the per-chat settings the
// UI now manages (wa_archived / wa_muted) and the last message's type +
// status so the preview line can show 📷 Photo / 🎤 Voice message and the
// correct tick state, exactly like the real chat list.
// ?view=archived returns ONLY archived chats (the Archived screen).
export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // Branch-scoped users see only conversations on leads of their branch.
  const branchId = sessionBranchId(session)
  const viewArchived = new URL(req.url).searchParams.get("view") === "archived"

  const RICH_SELECT = `
      SELECT
        l.id, l.name, l.phone,
        l.pinned, l.pinned_at,
        l.wa_archived, l.wa_muted,
        -- Everything the lead has actually told us / that Priya has
        -- gathered — shown in the chat's contact-info panel so an agent
        -- never has to switch tabs to see who they're talking to.
        l.address, l.email, l.whatsapp_number, l.product_interest,
        l.loan_amount, l.notes, l.status, l.interested, l.language, l.source,
        lm.content    AS last_message,
        lm.created_at AS last_message_time,
        lm.direction  AS last_direction,
        lm.status     AS last_status,
        COALESCE(lm.msg_type, 'text') AS last_type,
        lm.media_name AS last_media_name,
        COALESCE(u.unread, 0) AS unread,
        mem.summary AS ai_summary, mem.sentiment, mem.stage, mem.facts
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT content, created_at, direction, status, msg_type, media_name
        FROM whatsapp_messages
        WHERE lead_id = l.id
        ORDER BY created_at DESC
        LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS unread
        FROM whatsapp_messages
        WHERE lead_id = l.id AND direction = 'inbound' AND status = 'received'
      ) u ON true
      LEFT JOIN lead_memory mem ON mem.lead_id = l.id
      WHERE l.phone IS NOT NULL AND l.phone != ''
        AND COALESCE(l.wa_archived, false) = $${branchId ? 2 : 1}
        ${branchId ? "AND l.branch_id = $1" : ""}
      ORDER BY l.pinned DESC, l.pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST, l.created_at DESC
      LIMIT 100`

  const LEGACY_SELECT = `
      SELECT
        l.id, l.name, l.phone,
        l.pinned, l.pinned_at,
        l.address, l.email, l.whatsapp_number, l.product_interest,
        l.loan_amount, l.notes, l.status, l.interested, l.language, l.source,
        lm.content    AS last_message,
        lm.created_at AS last_message_time,
        lm.direction  AS last_direction,
        COALESCE(u.unread, 0) AS unread,
        mem.summary AS ai_summary, mem.sentiment, mem.stage, mem.facts
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT content, created_at, direction
        FROM whatsapp_messages
        WHERE lead_id = l.id
        ORDER BY created_at DESC
        LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS unread
        FROM whatsapp_messages
        WHERE lead_id = l.id AND direction = 'inbound' AND status = 'received'
      ) u ON true
      LEFT JOIN lead_memory mem ON mem.lead_id = l.id
      WHERE l.phone IS NOT NULL AND l.phone != '' ${branchId ? "AND l.branch_id = $1" : ""}
      ORDER BY l.pinned DESC, l.pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST, l.created_at DESC
      LIMIT 100`

  try {
    // Rich path needs the 2026-09-22_whatsapp_rich_chat columns; on a
    // pre-migration DB (42703 undefined column) fall back to the legacy
    // query so the chat list never breaks during rollout.
    try {
      const params = branchId ? [branchId, viewArchived] : [viewArchived]
      const result = await query(RICH_SELECT, params)
      return NextResponse.json(result.rows)
    } catch (e: any) {
      if (e?.code !== "42703") throw e
      if (viewArchived) return NextResponse.json([]) // no archived support → empty screen, not an error
      const result = await query(LEGACY_SELECT, branchId ? [branchId] : [])
      return NextResponse.json(result.rows)
    }
  } catch (e: any) {
    return apiError(e)
  }
}
