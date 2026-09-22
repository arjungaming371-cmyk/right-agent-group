import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// 2026-09-22 (real-WhatsApp parity): the chat window now renders media
// (image/video/audio/document/sticker), reply quotes, reactions and the
// branch the chat runs on — all stored per message by the rich-chat pass.
// On a pre-migration DB (42703) it degrades to the legacy plain-text shape.
export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leadId = searchParams.get("leadId")
  const limit  = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "100") || 100))
  if (!leadId) return NextResponse.json([])

  const branchId = sessionBranchId(session)
  if (branchId) {
    const leadCheck = await query(`SELECT branch_id FROM leads WHERE id = $1 LIMIT 1`, [leadId])
    if (leadCheck.rows.length === 0 || leadCheck.rows[0].branch_id !== branchId) {
      return NextResponse.json({ error: "Lead not found in your branch" }, { status: 404 })
    }
  }

  try {
    try {
      const result = await query(
        `SELECT id, direction, content, status, created_at,
                COALESCE(msg_type, 'text') AS msg_type,
                media_id, media_mime, media_name,
                quoted_wa_id, quoted_text, quoted_from, reaction,
                wa_message_id, branch_id
         FROM whatsapp_messages
         WHERE lead_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [leadId, limit]
      )
      return NextResponse.json(result.rows.reverse())
    } catch (e: any) {
      if (e?.code !== "42703") throw e
      const result = await query(
        `SELECT id, direction, content, status, created_at
         FROM whatsapp_messages
         WHERE lead_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [leadId, limit]
      )
      return NextResponse.json(result.rows.reverse())
    }
  } catch (e: any) {
    return apiError(e)
  }
}
