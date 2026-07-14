// Priya's voice.
//
// Microsoft Edge neural voices ONLY — free, no API key, no GPU server.
// Native Indian voices per language (Neerja/Swara/Shruti). Chosen over
// self-hosted Svara-TTS deliberately: Svara needs a vLLM GPU server that
// proved fragile to deploy, and a voice that always works beats a slightly
// better voice that keeps the whole pipeline fragile.

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts"
import type { Language } from "./ollama"

const EDGE_VOICES: Record<Language, string> = {
  english: "en-IN-NeerjaNeural",
  hindi: "hi-IN-SwaraNeural",
  telugu: "te-IN-ShrutiNeural",
}

async function edgeSpeech(text: string, language: Language): Promise<Buffer | null> {
  try {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(EDGE_VOICES[language] || EDGE_VOICES.english, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(text)
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (c: Buffer) => chunks.push(c))
      audioStream.on("end", () => resolve())
      audioStream.on("error", reject)
    })
    const buf = Buffer.concat(chunks)
    return buf.length > 0 ? buf : null
  } catch (e: any) {
    console.error("Edge TTS error:", e.message)
    return null
  }
}

/** MP3 audio for the dashboard chat "speak" feature. Returns null if Edge TTS fails. */
export async function textToSpeech(text: string, language: Language = "english"): Promise<Buffer | null> {
  const clean = text?.trim().slice(0, 1000)
  if (!clean) return null
  return edgeSpeech(clean, language)
}

export async function checkTtsHealth(): Promise<{ ok: boolean; message: string }> {
  const buf = await edgeSpeech("test", "english")
  return buf
    ? { ok: true, message: "TTS working — Edge neural voices (free)" }
    : { ok: false, message: "TTS failed — Edge neural voices. Check server internet." }
}
