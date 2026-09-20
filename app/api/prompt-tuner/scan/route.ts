import { NextRequest, NextResponse } from "next/server"
import { runPromptTuner } from "@/lib/prompt-tuner"
import { verifyServiceKey } from "@/lib/service-key"

export const dynamic = "force-dynamic"

// Internal-only, hit by lib/scheduler.ts's weekly cron tick. Same shared
// service-key pattern as /api/digest and /api/lead-brain/scan-idle.
export async function POST(req: NextRequest) {
  // FIX (2026-09-20): constant-time compare via the shared helper (was !==).
  if (!verifyServiceKey(req)) {
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
