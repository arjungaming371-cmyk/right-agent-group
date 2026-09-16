import { NextResponse } from "next/server"
import { checkWhatsAppHealth } from "@/lib/whatsapp"

export const dynamic = "force-dynamic"

export async function GET() {
  const configured = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
  if (!configured) {
    return NextResponse.json({ configured: false, ready: false, message: "Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env" })
  }
  const health = await checkWhatsAppHealth()
  return NextResponse.json({ configured: true, ready: health.ok, message: health.message })
}
