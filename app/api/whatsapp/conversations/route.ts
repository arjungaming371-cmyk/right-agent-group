import { NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

// One fast query: every lead with a phone, with their latest WhatsApp
// message and unread count, sorted so active conversations are on top.
export async function GET() {
  try {
    const result = await query(`
      SELECT
        l.id, l.name, l.phone,
        l.pinned, l.pinned_at,
        -- Everything the lead has actually told us / that Priya has
        -- gathered — shown in the chat's contact-info panel so an agent
        -- never has to switch tabs to see who they're talking to.
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
      WHERE l.phone IS NOT NULL AND l.phone != ''
      ORDER BY l.pinned DESC, l.pinned_at DESC NULLS LAST, lm.created_at DESC NULLS LAST, l.created_at DESC
      LIMIT 100
    `)
    return NextResponse.json(result.rows)
  } catch (e: any) {
    return apiError(e)
  }
}
