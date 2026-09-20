import { NextRequest, NextResponse } from "next/server"
import { runPromptTuner } from "@/lib/prompt-tuner"
import { safeEqual } from "@/lib/security"

export const dynamic = "force-dynamic"

// Internal-only, hit by lib/scheduler.ts's weekly cron tick. Same shared
// service-key pattern as /api/digest and /api/lead-brain/scan-idle.
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-api-key") || ""
  const expected = process.env.WHATSAPP_SERVICE_KEY || ""
  if (!expected || !safeEqual(key, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const result = await runPromptTuner()
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    console.error("prompt-tuner scan error:", e.message)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
