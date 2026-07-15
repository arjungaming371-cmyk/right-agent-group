// Priya's voice.
//
// Self-hosted IndicF5 ONLY (server/tts-service) — AI4Bharat's F5-TTS trained
// on 11 Indian languages. One cloned voice (ref/priya_ref.wav) speaks
// Telugu, Hindi, AND English, so Priya never changes person mid-call.
// No fallback provider by explicit decision: if the TTS service is down,
// this returns null and callers fail loudly instead of silently switching
// to a different voice.

import type { Language } from "./ollama"

const TTS_URL = process.env.TTS_SERVICE_URL || "http://127.0.0.1:3004"
const API_KEY = process.env.TTS_API_KEY || process.env.WHATSAPP_SERVICE_KEY || ""

async function f5Speech(text: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${TTS_URL}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ text }),
      // F5 on a T4 takes a few seconds per utterance; a hung service should
      // still fail fast enough for the UI to say so.
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`TTS service HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 1000 ? buf : null
  } catch (e: any) {
    console.error("IndicF5 TTS error:", e.message)
    return null
  }
}

/** WAV audio for the dashboard chat "speak" feature. Language is implicit —
 *  IndicF5 reads the script of the text itself. Returns null on failure. */
export async function textToSpeech(text: string, _language: Language = "english"): Promise<Buffer | null> {
  const clean = text?.trim().slice(0, 800)
  if (!clean) return null
  return f5Speech(clean)
}

export async function checkTtsHealth(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${TTS_URL}/health`, {
      headers: { "x-api-key": API_KEY },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { ok: false, message: `TTS service HTTP ${res.status} at ${TTS_URL}` }
    return { ok: true, message: "TTS working — IndicF5 (Priya's cloned voice, all languages)" }
  } catch (e: any) {
    return { ok: false, message: `TTS service unreachable at ${TTS_URL}: ${e.message}` }
  }
}
