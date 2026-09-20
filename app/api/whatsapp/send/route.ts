import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { sendWhatsAppText, branchWhatsAppCtx } from "@/lib/whatsapp"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { to, message, leadId } = await req.json()
  if (!to || !message) return NextResponse.json({ error: "to and message required" }, { status: 400 })
  const branchId = sessionBranchId(session)

  // 2026-09 fix (cross-branch IDOR): when a leadId is attached, branch-bound
  // staff may only log against leads in THEIR branch — otherwise comm logs
  // and WA threads could be pinned onto another branch's lead.
  if (leadId && branchId) {
    const own = await query(`SELECT 1 FROM leads WHERE id = $1 AND branch_id = $2 LIMIT 1`, [leadId, branchId])
    if ((own.rowCount || 0) === 0) {
      return NextResponse.json({ error: "lead not found in your branch" }, { status: 404 })
    }
  }

  // Branch-bound staff reply from their BRANCH's WABA number (falls back to
  // the company number when the branch has none).
  const waBranch = await branchWhatsAppCtx(branchId)

  const result = await sendWhatsAppText(to, message, waBranch)
  if (!result.ok) {
    if (result.error && result.error.includes("not configured")) {
      return NextResponse.json(
        { error: "WHATSAPP_NOT_CONFIGURED", message: "WhatsApp Cloud API is not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env (see SETUP-GUIDE-CLOUD-API.md), or set the branch's own WhatsApp number in Branches." },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  await db.from("whatsapp_messages").insert({ lead_id: leadId ?? null, phone_number: to, direction: "outbound", content: message, status: "sent", branch_id: branchId }).catch(() => {})
  if (leadId) {
    await db.from("comm_logs").insert({ lead_id: leadId, type: "whatsapp", summary: message.slice(0, 140), outcome: "sent" }).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
