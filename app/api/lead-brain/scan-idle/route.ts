import { NextRequest, NextResponse } from "next/server"
import { scanIdleWhatsAppConversations } from "@/lib/lead-brain"
import { safeEqual } from "@/lib/security"

export const dynamic = "force-dynamic"

// Internal-only, hit by lib/scheduler.ts's cron tick every 5 minutes.
// Same shared-service-key pattern as app/api/calls/turn and app/api/digest —
// not for public use, never triggers anything user-facing itself.
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-api-key") || ""
  const expected = process.env.WHATSAPP_SERVICE_KEY || ""
  if (!expected || !safeEqual(key, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const result = await scanIdleWhatsAppConversations()
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    console.error("scan-idle error:", e.message)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
