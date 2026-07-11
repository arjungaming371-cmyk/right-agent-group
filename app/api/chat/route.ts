import { NextRequest, NextResponse } from "next/server"
import { chatWithOllama, type Language } from "@/lib/ollama"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const { message, language, history } = await req.json()
    if (typeof message !== "string" || !message.trim() || message.length > 4000) {
      return NextResponse.json({ reply: "Please send a valid message." }, { status: 400 })
    }
    const messages = [...(Array.isArray(history) ? history.slice(-10) : []), { role: "user", content: message }]
    const reply = await chatWithOllama(messages, (language as Language) || "english")
    return NextResponse.json({ reply })
  } catch (e: any) {
    console.error("chat error:", e.message)
    return NextResponse.json({ reply: "Sorry, something went wrong. Please try again." }, { status: 500 })
  }
}
