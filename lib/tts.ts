// Priya's voice.
//
//   TTS_PROVIDER=svara   (default) Self-hosted Kenpath Svara-TTS — ONE model
//                        covering Hindi, Telugu, AND Indian English
//                        natively, so Priya keeps the same voice across all
//                        three languages. Zero per-call cost, but needs a
//                        GPU server running the svara-tts-inference API
//                        (github.com/Kenpath/svara-tts-inference).
//                        Requires SVARA_TTS_URL (defaults to localhost:8080,
//                        i.e. same-box deployment). If Svara is unreachable,
//                        automatically falls back to Edge below — TTS never
//                        hard-fails just because the GPU server is down.
//
//   TTS_PROVIDER=edge    Explicit free-only mode (Microsoft Edge neural
//                        voices) — skips Svara entirely. Useful for local
//                        dev on a machine with no GPU/Svara server.

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts"
import type { Language } from "./ollama"

const PROVIDER = (process.env.TTS_PROVIDER || "svara").toLowerCase()

// ---------- Edge (free — default fallback for Svara) ----------
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

/** MP3 audio for the dashboard chat "speak" feature. Returns null only if every available option fails. */
export async function textToSpeech(text: string, language: Language = "english"): Promise<Buffer | null> {
  const clean = text?.trim().slice(0, 1000)
  if (!clean) return null
  if (PROVIDER === "edge") return edgeSpeech(clean, language)
  // svara (default) — fall back to Edge automatically if the GPU server is unreachable
  const svara = await svaraSpeech(clean, language)
  if (svara) return svara
  console.error("Svara TTS unreachable — falling back to Edge")
  return edgeSpeech(clean, language)
}

export async function checkTtsHealth(): Promise<{ ok: boolean; message: string }> {
  if (PROVIDER === "edge") {
    const buf = await edgeSpeech("test", "english")
    return buf
      ? { ok: true, message: "TTS working — Edge neural voices (free)" }
      : { ok: false, message: "TTS failed — Edge neural voices. Check server internet." }
  }
  const svara = await svaraSpeech("test", "english")
  if (svara) return { ok: true, message: "TTS working — Svara-TTS (self-hosted)" }
  const edge = await edgeSpeech("test", "english")
  return edge
    ? { ok: true, message: "TTS working — Edge fallback (Svara-TTS unreachable, check SVARA_TTS_URL)" }
    : { ok: false, message: "TTS failed — both Svara-TTS and the Edge fallback failed. Check server internet and SVARA_TTS_URL." }
}
