// Priya's voice — dashboard chat "speak" feature.
//
//   TTS_PROVIDER=edge        (default) Microsoft Edge neural voices via the
//                             free `msedge-tts` package. No API key, no cost,
//                             no external account. Indian-accented voices for
//                             English/Hindi/Telugu.
//   TTS_PROVIDER=elevenlabs  Optional — routes through the ElevenLabs REST
//                             API instead. Requires ELEVENLABS_API_KEY. Use
//                             this only if you specifically want ElevenLabs'
//                             voice quality and are OK with the per-call cost.
//
// This file only serves the dashboard's "speak" button. The phone-call
// voicebot pipeline (server/voicebot-server.js) always uses the separate
// Edge TTS microservice at server/tts-service — see TTS_SERVICE_URL in .env.
// All other TTS providers (IndicF5, Svara, etc.) have been removed.

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts"
import type { Language } from "./llm"

const PROVIDER = (process.env.TTS_PROVIDER || "edge").toLowerCase()

// ---------- Edge TTS (default — free, no key) ----------
const EDGE_VOICES: Record<Language, string> = {
  english: "en-IN-NeerjaNeural",
  // Hinglish/Tenglish are written in Roman script, so the Indian-English
  // voice pronounces them naturally — and Priya keeps ONE consistent voice
  // across all three languages. (hi-IN/te-IN voices read Latin text with
  // English word rules, which sounds wrong for romanized Hindi/Telugu.)
  hindi: "en-IN-NeerjaNeural",
  telugu: "en-IN-NeerjaNeural",
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

// ---------- ElevenLabs (optional — set TTS_PROVIDER=elevenlabs) ----------
const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY || ""
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"

async function elevenLabsSpeech(text: string): Promise<Buffer | null> {
  if (!ELEVEN_API_KEY) {
    console.error("ElevenLabs error: ELEVENLABS_API_KEY is not set in .env")
    return null
  }
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVEN_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 1000 ? buf : null
  } catch (e: any) {
    console.error("ElevenLabs TTS error:", e.message)
    return null
  }
}

/** MP3 audio for the dashboard chat "speak" feature. Returns null on failure. */
export async function textToSpeech(text: string, language: Language = "english"): Promise<Buffer | null> {
  const clean = text?.trim().slice(0, 800)
  if (!clean) return null

  if (PROVIDER === "elevenlabs") return elevenLabsSpeech(clean)
  return edgeSpeech(clean, language)
}

/** Health check for the TTS service. */
export async function checkTtsHealth(): Promise<{ ok: boolean; message: string }> {
  if (PROVIDER === "elevenlabs") {
    if (!ELEVEN_API_KEY) {
      return { ok: false, message: "ElevenLabs setup failed: ELEVENLABS_API_KEY is missing in .env" }
    }
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/models", {
        headers: { "xi-api-key": ELEVEN_API_KEY },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return { ok: false, message: `ElevenLabs check failed: HTTP ${res.status}` }
      return { ok: true, message: `TTS working — ElevenLabs API (Model: eleven_turbo_v2_5, Voice ID: ${ELEVEN_VOICE_ID})` }
    } catch (e: any) {
      return { ok: false, message: `ElevenLabs service unreachable: ${e.message}` }
    }
  }

  const buf = await edgeSpeech("test", "english")
  return buf
    ? { ok: true, message: "TTS working — Edge neural voices (free, no key needed)" }
    : { ok: false, message: "Edge TTS failed — check server internet access" }
}