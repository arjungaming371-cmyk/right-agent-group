import { NextRequest, NextResponse } from "next/server"
import { chatWithLLM, type Language } from "@/lib/llm"
import { requireRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ reply: "Unauthorized." }, { status: 401 })

  try {
    const { message, language, history } = await req.json()
    if (typeof message !== "string" || !message.trim() || message.length > 4000) {
      return NextResponse.json({ reply: "Please send a valid message." }, { status: 400 })
    }
    const messages = [...(Array.isArray(history) ? history.slice(-10) : []), { role: "user", content: message }]
    const reply = await chatWithLLM(messages, (language as Language) || "english")
    return NextResponse.json({ reply })
  } catch (e: any) {
    console.error("chat error:", e.message)
    return NextResponse.json({ reply: "Sorry, something went wrong. Please try again." }, { status: 500 })
  }
}
