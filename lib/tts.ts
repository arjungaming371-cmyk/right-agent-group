// Priya's voice — switchable TTS provider.
//
//   TTS_PROVIDER=edge    (default) FREE Microsoft Edge neural voices.
//                        Zero cost per call. Decent Indian-accent quality.
//   TTS_PROVIDER=sarvam  Sarvam AI bulbul:v3 — noticeably more natural
//                        Indic voices, but PAID (metered per character).
//                        Requires SARVAM_API_KEY.
//
//   TTS_PROVIDER=svara   Self-hosted Kenpath Svara-TTS — ONE model covering
//                        Hindi, Telugu, AND Indian English natively, so
//                        Priya keeps the same voice across all three
//                        languages. Zero per-call cost, but needs a GPU
//                        server running the svara-tts-inference API
//                        (github.com/Kenpath/svara-tts-inference).
//                        Requires SVARA_TTS_URL (defaults to localhost:8080,
//                        i.e. same-box deployment).

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts"
import type { Language } from "./ollama"

const PROVIDER = (process.env.TTS_PROVIDER || "edge").toLowerCase()

// ---------- Edge (free) ----------
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

// ---------- Sarvam (paid, optional) ----------
const SARVAM_URL = "https://api.sarvam.ai/text-to-speech"
const SARVAM_LANG: Record<Language, string> = {
  english: "en-IN",
  hindi: "hi-IN",
  telugu: "te-IN",
}

async function sarvamSpeech(text: string, language: Language): Promise<Buffer | null> {
  const apiKey = process.env.SARVAM_API_KEY
  if (!apiKey) {
    console.error("Sarvam TTS error: TTS_PROVIDER=sarvam but SARVAM_API_KEY not set")
    return null
  }
  try {
    const res = await fetch(SARVAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": apiKey },
      body: JSON.stringify({
        text,
        target_language_code: SARVAM_LANG[language] || SARVAM_LANG.english,
        model: "bulbul:v3",
        speaker: process.env.SARVAM_SPEAKER || "priya",
        output_audio_codec: "mp3",
      }),
    })
    if (!res.ok) {
      console.error(`Sarvam TTS error: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`)
      return null
    }
    const data = await res.json()
    const b64 = data?.audios?.[0]
    if (!b64) return null
    const buf = Buffer.from(b64, "base64")
    return buf.length > 0 ? buf : null
  } catch (e: any) {
    console.error("Sarvam TTS error:", e.message)
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

/** MP3 audio for the dashboard chat "speak" feature. Returns null on failure. */
export async function textToSpeech(text: string, language: Language = "english"): Promise<Buffer | null> {
  const clean = text?.trim().slice(0, 1000)
  if (!clean) return null
  if (PROVIDER === "sarvam") return sarvamSpeech(clean, language)
  if (PROVIDER === "svara") return svaraSpeech(clean, language)
  return edgeSpeech(clean, language)
}

export async function checkTtsHealth(): Promise<{ ok: boolean; message: string }> {
  const buf = await textToSpeech("test", "english")
  const name = PROVIDER === "sarvam" ? "Sarvam AI (paid)" : PROVIDER === "svara" ? "Svara-TTS (self-hosted)" : "Edge neural voices (free)"
  return buf
    ? { ok: true, message: `TTS working — ${name}` }
    : { ok: false, message: `TTS failed — provider: ${name}. Check server internet${PROVIDER === "sarvam" ? " and SARVAM_API_KEY" : PROVIDER === "svara" ? " and SVARA_TTS_URL" : ""}.` }
}
