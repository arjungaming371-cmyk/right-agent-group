import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { checkWhatsAppHealth } from "@/lib/whatsapp"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  // FIX (2026-09-20): middleware-only protection → also verify the session
  // here (health message can carry config error details).
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const configured = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
  if (!configured) {
    return NextResponse.json({ configured: false, ready: false, message: "Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env" })
  }
  // FIX (2026-09-20): the dashboard polls this route every 8s and each hit
  // made a REAL Meta Graph API call — ~10k paid/API-heavy calls per user per
  // day just for a status dot. Health naturally has 30s staleness; return the
  // cached verdict between polls.
  const now = Date.now()
  if (!_healthCache || now - _healthCache.at > 30_000) {
    const health = await checkWhatsAppHealth()
    _healthCache = { at: now, ok: health.ok, message: health.message }
  }
  return NextResponse.json({ configured: true, ready: _healthCache.ok, message: _healthCache.message })
}

let _healthCache: { at: number; ok: boolean; message?: string } | null = null
