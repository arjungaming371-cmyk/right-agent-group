import { NextRequest, NextResponse } from "next/server"
import { rateLimit, clientIp } from "@/lib/rate-limit"

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
const MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b"

// Call this before triggering a call to pre-load the model into memory.
// Ollama unloads models after 5 min idle - first call after idle is SLOW.
// PUBLIC endpoint → rate-limited so it can't be spammed to burn CPU.
export async function POST(req: NextRequest) {
  if (!rateLimit(`warmup:${clientIp(req)}`, 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 })
  }
  try {
    const start = Date.now()
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
        options: { num_predict: 5, keep_alive: "30m" },
      }),
    })
    const ms = Date.now() - start
    if (!res.ok) return NextResponse.json({ ok: false, error: `HTTP ${res.status}` })
    return NextResponse.json({ ok: true, warmupMs: ms })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
