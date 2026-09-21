import { NextRequest, NextResponse } from "next/server"
import { rateLimit, clientIp } from "@/lib/rate-limit"
import { checkLLMHealth } from "@/lib/llm"

// Groq is a cloud API — there is no local model to pre-load. This endpoint
// stays (callers ping it before a call starts) but is now just a fast health
// check confirming the Groq brain is reachable.
// PUBLIC endpoint → rate-limited so it can't be spammed.
export async function POST(req: NextRequest) {
  if (!rateLimit(`warmup:${clientIp(req)}`, 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 })
  }
  const start = Date.now()
  const health = await checkLLMHealth()
  const ms = Date.now() - start
  // FIX (2026-09-20): public endpoint — return booleans only; the raw provider
  // health message (may include HTTP/config details) stays in server logs.
  if (!health.ok) {
    console.error("warmup: LLM health check failed:", health.message)
    return NextResponse.json({ ok: false })
  }
  return NextResponse.json({ ok: true, warmupMs: ms })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
