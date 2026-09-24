import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { checkWhatsAppHealth, liveEnvWhatsAppCreds } from "@/lib/whatsapp"
import { withRoute } from "@/lib/api-route"

export const dynamic = "force-dynamic"

export const GET = withRoute("whatsapp/status", async (req: NextRequest) => {
  // FIX (2026-09-20): middleware-only protection → also verify the session
  // here (health message can carry config error details).
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // Live read (same creds the sender uses) — a boot-time process.env check
  // kept saying "not configured" after the token was added to .env until the
  // next restart, while sends already worked.
  const { token, phoneId } = liveEnvWhatsAppCreds()
  const configured = !!(token && phoneId)
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
})

let _healthCache: { at: number; ok: boolean; message?: string } | null = null
