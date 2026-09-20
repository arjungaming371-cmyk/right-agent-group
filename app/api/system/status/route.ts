import { NextResponse, NextRequest } from "next/server"
import { checkWhatsAppHealth } from "@/lib/whatsapp"
import { checkLLMHealth } from "@/lib/llm"
import { checkDbHealth } from "@/lib/db"
import { rateLimit, clientIp } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// 2026-09 fix (cost burn + abuse): this endpoint is PUBLIC (linked from the
// About page) yet every request fired TWO paid Groq probes and ONE WhatsApp
// Cloud API probe — an unauthenticated for-loop could burn the month's
// tokens. Now: 10 req/min per IP, plus a 60-second SHARED result cache, so
// at most one probe set runs per minute no matter how many visitors hit it.
let _cache: { at: number; body: any } | null = null
const CACHE_MS = 60_000

export async function GET(req: NextRequest) {
  if (!rateLimit(`sys-status:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  if (_cache && Date.now() - _cache.at < CACHE_MS) {
    return NextResponse.json(_cache.body)
  }

  const [waHealth, llmHealth, dbHealth] = await Promise.all([
    checkWhatsAppHealth(),
    checkLLMHealth(),
    checkDbHealth(),
  ])

  // PUBLIC endpoint (linked from the About page) — booleans only, never the
  // health-check message strings, which can contain config/error details.
  const body = {
    whatsapp: { running: waHealth.ok, connected: waHealth.ok },
    llm:      { running: llmHealth.ok },
    db:       { running: dbHealth.ok },
    website:  { running: true },
  }
  _cache = { at: Date.now(), body }
  return NextResponse.json(body)
}
