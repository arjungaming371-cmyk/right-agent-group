import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sendWhatsAppText } from "@/lib/whatsapp"

export async function POST(req: NextRequest) {
  const { to, message, leadId } = await req.json()
  if (!to || !message) return NextResponse.json({ error: "to and message required" }, { status: 400 })

  const result = await sendWhatsAppText(to, message)
  if (!result.ok) {
    if (result.error && result.error.includes("not configured")) {
      return NextResponse.json(
        { error: "WHATSAPP_NOT_CONFIGURED", message: "WhatsApp Cloud API is not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env (see SETUP-GUIDE-CLOUD-API.md)." },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  await db.from("whatsapp_messages").insert({ lead_id: leadId ?? null, phone_number: to, direction: "outbound", content: message, status: "sent" }).catch(() => {})
  if (leadId) {
    await db.from("comm_logs").insert({ lead_id: leadId, type: "whatsapp", summary: message.slice(0, 140), outcome: "sent" }).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
