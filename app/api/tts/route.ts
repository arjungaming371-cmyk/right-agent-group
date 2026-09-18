import { NextRequest, NextResponse } from "next/server"
import { textToSpeech, ttsAudioMime } from "@/lib/tts"
import type { Language } from "@/lib/llm"
import { requireModuleOrRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { text, language } = await req.json()
  if (!text || typeof text !== "string") return NextResponse.json({ error: "text required" }, { status: 400 })

  const audio = await textToSpeech(text.slice(0, 500), (language as Language) || "english")
  if (!audio) return NextResponse.json({ error: "TTS unavailable" }, { status: 503 })

  // Content-Type follows the provider: Sarvam/Cartesia return WAV, the older
  // providers MP3 — labelling WAV as audio/mpeg makes some players refuse it.
  return new NextResponse(new Uint8Array(audio), {
    headers: { "Content-Type": ttsAudioMime(), "Content-Length": audio.length.toString() },
  })
}
