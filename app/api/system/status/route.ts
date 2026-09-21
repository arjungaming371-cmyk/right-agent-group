import { NextRequest, NextResponse } from "next/server"
import { checkWhatsAppHealth } from "@/lib/whatsapp"
import { checkLLMHealth } from "@/lib/llm"
import { checkDbHealth } from "@/lib/db"
import { rateLimit, clientIp } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// PUBLIC endpoint (linked from the About page). FIX (2026-09-20): every hit
// used to fire a REAL Groq completion + a REAL Meta Graph call — unthrottled,
// an automated crawler could burn provider credits around the clock. The
// result is now cached for 60s and per-IP rate-limited on top.
let _cache: { body: object; at: number } | null = null
const STATUS_TTL_MS = 60_000

export async function GET(req: NextRequest) {
  if (!rateLimit(`sysstatus:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  if (_cache && Date.now() - _cache.at < STATUS_TTL_MS) {
    return NextResponse.json(_cache.body)
  }

  const [waHealth, llmHealth, dbHealth] = await Promise.all([
    checkWhatsAppHealth(),
    checkLLMHealth(),
    checkDbHealth(),
  ])

  // Booleans only, never the health-check message strings, which can contain
  // config/error details.
  const body = {
    whatsapp: { running: waHealth.ok, connected: waHealth.ok },
    llm:      { running: llmHealth.ok },
    db:       { running: dbHealth.ok },
    website:  { running: true },
  }
  _cache = { body, at: Date.now() }
  return NextResponse.json(body)
}
