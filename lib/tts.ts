// Priya's voice.
//
// Svara-TTS ONLY — self-hosted Kenpath Svara-TTS, ONE model covering Hindi,
// Telugu, AND Indian English natively, so Priya keeps the same voice across
// all three languages. Zero per-call cost. Needs a GPU server running the
// svara-tts-inference API (github.com/Kenpath/svara-tts-inference).
// Requires SVARA_TTS_URL (defaults to localhost:8080, i.e. same-box
// deployment). There is no fallback provider — if Svara is unreachable, TTS
// fails loudly rather than silently switching voices.

import type { Language } from "./ollama"

// ---------- Svara-TTS (self-hosted, free, one voice for all 3 languages) ----------
const SVARA_URL = process.env.SVARA_TTS_URL || "http://127.0.0.1:8080"
// "Language (Gender)" / lang_gender codes per Kenpath's docs — override via env
// if the actual served voice list uses different codes than these first guesses.
const SVARA_VOICES: Record<Language, string> = {
  english: process.env.SVARA_VOICE_ENGLISH || "en_female",
  hindi: process.env.SVARA_VOICE_HINDI || "hi_female",
  telugu: process.env.SVARA_VOICE_TELUGU || "te_female",
}

async function svaraSpeech(text: string, language: Language): Promise<Buffer | null> {
  try {
    const res = await fetch(`${SVARA_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "svara-tts-v1",
        voice: SVARA_VOICES[language] || SVARA_VOICES.english,
        input: text,
        response_format: "mp3",
      }),
    })
    if (!res.ok) {
      console.error(`Svara TTS error: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 ? buf : null
  } catch (e: any) {
    console.error("Svara TTS error:", e.message)
    return null
  }
}

/** MP3 audio for the dashboard chat "speak" feature. Returns null if Svara is unreachable. */
export async function textToSpeech(text: string, language: Language = "english"): Promise<Buffer | null> {
  const clean = text?.trim().slice(0, 1000)
  if (!clean) return null
  return svaraSpeech(clean, language)
}

export async function checkTtsHealth(): Promise<{ ok: boolean; message: string }> {
  const svara = await svaraSpeech("test", "english")
  return svara
    ? { ok: true, message: "TTS working — Svara-TTS (self-hosted)" }
    : { ok: false, message: "TTS failed — Svara-TTS unreachable. Check SVARA_TTS_URL and that the GPU server is running." }
}
