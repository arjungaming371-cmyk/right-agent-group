// Priya's voice — dashboard chat "speak" feature.
//
//   TTS_PROVIDER=edge       (default) Microsoft Edge neural voices via the
//                            free `msedge-tts` package. No API key, no cost,
//                            no external account. Indian-accented voices for
//                            English/Hindi/Telugu.
//   TTS_PROVIDER=sarvam     Sarvam Bulbul v3 cloud TTS (Indian languages,
//                            code-mixed text native). Requires SARVAM_API_KEY.
//                            Returns WAV — same voice family the phone calls
//                            use when TTS_CALL_PROVIDER=sarvam.
//   TTS_PROVIDER=cartesia   Cartesia Sonic cloud TTS. Requires CARTESIA_API_KEY
//                            + CARTESIA_VOICE_ID. Returns WAV — same voice as
//                            phone calls when TTS_CALL_PROVIDER=cartesia.
//   TTS_PROVIDER=elevenlabs Optional — ElevenLabs REST API. Requires
//                            ELEVENLABS_API_KEY.
//
// This file only serves the dashboard's "speak" button. The phone-call
// voicebot pipeline (server/voicebot-server.js) selects its own provider with
// TTS_CALL_PROVIDER and shares SARVAM_API_KEY / CARTESIA_* config through
// server/voice-providers.js.

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

// ---------- Sarvam TTS (Bulbul v3 — Indian languages, code-mixed native) ----------
const SARVAM_API_KEY = (process.env.SARVAM_API_KEY || "").trim()
const SARVAM_BASE = (process.env.SARVAM_URL || "https://api.sarvam.ai").replace(/\/$/, "")
const SARVAM_TTS_MODEL = process.env.SARVAM_TTS_MODEL || "bulbul:v3"
// bulbul:v3 female voices: priya, ritu, neha, pooja, simran, kavya, ishita,
// shreya, roopa, tanya, shruti, suhani, kavitha, rupali. Males: shubh,
// aditya, rahul, rohan, amit, dev, ... (full list in Sarvam's TTS docs).
const SARVAM_TTS_SPEAKER = process.env.SARVAM_TTS_SPEAKER || "priya"
const SARVAM_TTS_PACE = parseFloat(process.env.SARVAM_TTS_PACE || "1.0")

const SARVAM_LOCALES: Record<Language, string> = {
  english: "en-IN",
  hindi: "hi-IN",
  telugu: "te-IN",
}

async function sarvamSpeech(text: string, language: Language): Promise<Buffer | null> {
  if (!SARVAM_API_KEY) {
    console.error("Sarvam TTS error: SARVAM_API_KEY is not set in .env")
    return null
  }
  try {
    const body: Record<string, unknown> = {
      text,
      model: SARVAM_TTS_MODEL,
      language_code: SARVAM_LOCALES[language] || SARVAM_LOCALES.english,
      speaker: SARVAM_TTS_SPEAKER,
      output_audio_codec: "wav",
    }
    if (SARVAM_TTS_PACE !== 1.0) body.pace = SARVAM_TTS_PACE
    const res = await fetch(`${SARVAM_BASE}/text-to-speech`, {
      method: "POST",
      headers: { "api-subscription-key": SARVAM_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
    const data: any = await res.json()
    const wav = Buffer.from(Array.isArray(data?.audios) ? data.audios.join("") : "", "base64")
    return wav.length > 100 ? wav : null
  } catch (e: any) {
    console.error("Sarvam TTS error:", e.message)
    return null
  }
}

// ---------- Cartesia TTS (Sonic — 40+ languages incl. en-IN/hi-IN/te-IN) ----------
const CARTESIA_API_KEY = (process.env.CARTESIA_API_KEY || "").trim()
const CARTESIA_BASE = (process.env.CARTESIA_URL || "https://api.cartesia.ai").replace(/\/$/, "")
const CARTESIA_MODEL = process.env.CARTESIA_MODEL || "sonic-3.6"
const CARTESIA_VOICE_ID = (process.env.CARTESIA_VOICE_ID || "").trim()
const CARTESIA_VERSION = process.env.CARTESIA_VERSION || "2026-08-14"
const CARTESIA_SPEED = parseFloat(process.env.CARTESIA_SPEED || "1.0")

const CARTESIA_LOCALES: Record<Language, string> = {
  english: "en-IN",
  hindi: "hi-IN",
  telugu: "te-IN",
}

async function cartesiaSpeech(text: string, language: Language): Promise<Buffer | null> {
  if (!CARTESIA_API_KEY) {
    console.error("Cartesia TTS error: CARTESIA_API_KEY is not set in .env")
    return null
  }
  if (!CARTESIA_VOICE_ID) {
    console.error("Cartesia TTS error: CARTESIA_VOICE_ID is not set — pick a voice at https://play.cartesia.ai/voices")
    return null
  }
  try {
    const body: Record<string, unknown> = {
      model_id: CARTESIA_MODEL,
      transcript: text,
      voice: { id: CARTESIA_VOICE_ID },
      language: CARTESIA_LOCALES[language] || CARTESIA_LOCALES.english,
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 },
    }
    if (CARTESIA_SPEED !== 1.0) body.generation_config = { speed: CARTESIA_SPEED }
    const res = await fetch(`${CARTESIA_BASE}/tts/bytes`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CARTESIA_API_KEY}`,
        "X-API-Key": CARTESIA_API_KEY,
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
    const wav = Buffer.from(await res.arrayBuffer())
    return wav.length > 100 ? wav : null
  } catch (e: any) {
    console.error("Cartesia TTS error:", e.message)
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
  if (PROVIDER === "sarvam") return sarvamSpeech(clean, language)
  if (PROVIDER === "cartesia") return cartesiaSpeech(clean, language)
  return edgeSpeech(clean, language)
}

/**
 * The MIME type textToSpeech() returns for the CURRENT provider — the /api/tts
 * route sets its Content-Type from this. Sarvam/Cartesia return WAV, the
 * older providers MP3; browsers play both, but labelling WAV as audio/mpeg
 * makes some players refuse it.
 */
export function ttsAudioMime(): string {
  if (PROVIDER === "sarvam" || PROVIDER === "cartesia") return "audio/wav"
  return "audio/mpeg"
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

  if (PROVIDER === "sarvam") {
    if (!SARVAM_API_KEY) return { ok: false, message: "Sarvam TTS setup failed: SARVAM_API_KEY is missing in .env" }
    const buf = await sarvamSpeech("test", "english")
    return buf
      ? { ok: true, message: `TTS working — Sarvam ${SARVAM_TTS_MODEL} (speaker: ${SARVAM_TTS_SPEAKER})` }
      : { ok: false, message: "Sarvam TTS failed — check SARVAM_API_KEY and server internet access" }
  }

  if (PROVIDER === "cartesia") {
    if (!CARTESIA_API_KEY) return { ok: false, message: "Cartesia TTS setup failed: CARTESIA_API_KEY is missing in .env" }
    if (!CARTESIA_VOICE_ID) return { ok: false, message: "Cartesia TTS setup failed: CARTESIA_VOICE_ID is missing in .env (pick one at play.cartesia.ai/voices)" }
    const buf = await cartesiaSpeech("test", "english")
    return buf
      ? { ok: true, message: `TTS working — Cartesia ${CARTESIA_MODEL}` }
      : { ok: false, message: "Cartesia TTS failed — check CARTESIA_API_KEY / CARTESIA_VOICE_ID / server internet access" }
  }

  const buf = await edgeSpeech("test", "english")
  return buf
    ? { ok: true, message: "TTS working — Edge neural voices (free, no key needed)" }
    : { ok: false, message: "Edge TTS failed — check server internet access" }
}
