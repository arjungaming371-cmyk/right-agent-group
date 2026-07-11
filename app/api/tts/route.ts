import { NextRequest, NextResponse } from "next/server"
import { textToSpeech } from "@/lib/tts"
import type { Language } from "@/lib/ollama"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const { text, language } = await req.json()
  if (!text || typeof text !== "string") return NextResponse.json({ error: "text required" }, { status: 400 })

  const audio = await textToSpeech(text.slice(0, 500), (language as Language) || "english")
  if (!audio) return NextResponse.json({ error: "TTS unavailable" }, { status: 503 })

  return new NextResponse(new Uint8Array(audio), {
    headers: { "Content-Type": "audio/mpeg", "Content-Length": audio.length.toString() },
  })
}
