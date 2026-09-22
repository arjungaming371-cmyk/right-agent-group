import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { sendWhatsAppReaction, branchWhatsAppCtx } from "@/lib/whatsapp"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// React to (or un-react from) a WhatsApp message, exactly like the real app:
// POST { leadId, to, waMessageId, emoji }  — emoji "" removes the reaction.
// Meta gets a type:"reaction" message; locally the target row's reaction
// column is updated so the chip shows for every console user instantly.
export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { leadId, to, waMessageId, emoji } = await req.json()
  if (!to || !waMessageId) return NextResponse.json({ error: "to and waMessageId required" }, { status: 400 })
  const emojiClean = String(emoji || "").slice(0, 8)
  const branchId = sessionBranchId(session)

  if (leadId && branchId) {
    const owner = await query(`SELECT branch_id FROM leads WHERE id = $1 LIMIT 1`, [leadId])
    if (!owner.rows[0] || owner.rows[0].branch_id !== branchId) {
      return NextResponse.json({ error: "Lead not found in your branch" }, { status: 404 })
    }
  }

  const waBranch = await branchWhatsAppCtx(branchId)
  const result = await sendWhatsAppReaction(to, String(waMessageId), emojiClean, waBranch)
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Reaction failed" }, { status: 500 })
  }

  // Mirror locally. NULLIF('') turns "remove" into a NULL (no chip).
  await query(
    `UPDATE whatsapp_messages SET reaction = NULLIF($1, '') WHERE wa_message_id = $2`,
    [emojiClean, String(waMessageId)]
  ).catch(() => {}) // pre-migration DB: Meta still got the reaction, chip just won't persist

  if (leadId) {
    await query(
      `INSERT INTO comm_logs (lead_id, type, summary, outcome) VALUES ($1, 'whatsapp', $2, 'reacted')`,
      [leadId, `Reacted ${emojiClean || "(removed)"} to a message`]
    ).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
