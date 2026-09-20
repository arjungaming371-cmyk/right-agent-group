import { NextResponse } from "next/server"
import { checkWhatsAppHealth } from "@/lib/whatsapp"

export const dynamic = "force-dynamic"

// PERF (2026-09 fix): the WhatsApp status pill polls this every 8s, and each
// hit fired a live Graph-API probe. Cache the probe for 60s — at most one
// Meta call per minute no matter how many dashboard tabs are open.
let _cache: { at: number; body: any } | null = null
const CACHE_MS = 60_000

export async function GET() {
  const configured = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
  if (!configured) {
    return NextResponse.json({ configured: false, ready: false, message: "Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env" })
  }
  if (_cache && Date.now() - _cache.at < CACHE_MS) {
    return NextResponse.json(_cache.body)
  }
  const health = await checkWhatsAppHealth()
  const body = { configured: true, ready: health.ok, message: health.message }
  _cache = { at: Date.now(), body }
  return NextResponse.json(body)
}
