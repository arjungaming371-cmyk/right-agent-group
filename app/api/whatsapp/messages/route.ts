import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const leadId = searchParams.get("leadId")
  const limit  = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "100") || 100))
  if (!leadId) return NextResponse.json([])
  try {
    // Fetch the MOST RECENT `limit` messages (DESC + LIMIT), then flip back
    // to chronological order for display — the old ASC+LIMIT version kept
    // the OLDEST messages once a conversation passed the limit, silently
    // hiding every new message after that (observed live: a 123-message
    // conversation was stuck showing only its first 100, missing today's
    // replies entirely).
    const result = await query(
      `SELECT id, direction, content, status, created_at
       FROM whatsapp_messages
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [leadId, limit]
    )
    return NextResponse.json(result.rows.reverse())
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
