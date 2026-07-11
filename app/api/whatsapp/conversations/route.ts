import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

// One fast query: every lead with a phone, with their latest WhatsApp
// message and unread count, sorted so active conversations are on top.
export async function GET() {
  try {
    const result = await query(`
      SELECT
        l.id, l.name, l.phone,
        lm.content    AS last_message,
        lm.created_at AS last_message_time,
        lm.direction  AS last_direction,
        COALESCE(u.unread, 0) AS unread
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
      WHERE l.phone IS NOT NULL AND l.phone != ''
      ORDER BY lm.created_at DESC NULLS LAST, l.created_at DESC
      LIMIT 100
    `)
    return NextResponse.json(result.rows)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
