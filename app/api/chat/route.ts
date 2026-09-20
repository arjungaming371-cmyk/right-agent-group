import { NextRequest, NextResponse } from "next/server"
import { chatWithLLM, type Language } from "@/lib/llm"
import { requireRole } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ reply: "Unauthorized." }, { status: 401 })

  // FIX (2026-09-20): no rate limit + unbounded history items = any session
  // could send megabyte-sized history arrays and burn Groq tokens per request.
  if (!rateLimit(`chat:${session.email}`, 20, 60_000)) {
    return NextResponse.json({ reply: "Too many messages — wait a moment." }, { status: 429 })
  }

  try {
    const { message, language, history } = await req.json()
    if (typeof message !== "string" || !message.trim() || message.length > 4000) {
      return NextResponse.json({ reply: "Please send a valid message." }, { status: 400 })
    }
    // Only shape-valid, capped history reaches the LLM; roles are normalized
    // (a client can never inject a "system" role — extra defense).
    const safeHistory: { role: "user" | "model"; content: string }[] = (Array.isArray(history) ? history : [])
      .filter((m: any) => m && typeof m.content === "string")
      .slice(-10)
      .map((m: any) => ({ role: m.role === "model" ? "model" as const : "user" as const, content: String(m.content).slice(0, 4000) }))
    const messages: { role: "user" | "model"; content: string }[] = [...safeHistory, { role: "user", content: message }]
    const reply = await chatWithLLM(messages, (language as Language) || "english")
    return NextResponse.json({ reply })
  } catch (e: any) {
    console.error("chat error:", e.message)
    return NextResponse.json({ reply: "Sorry, something went wrong. Please try again." }, { status: 500 })
  }
}
