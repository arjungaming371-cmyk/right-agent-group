// Voice Studio — unified voice catalog + provider adapters.
//
// One module that knows EVERY voice this deployment can speak with:
//
//   1. Sarvam Bulbul v3 presets   — static catalog (Sarvam has no list-voices
//      endpoint; the speaker names below are the documented Bulbul family).
//   2. Cartesia voices            — fetched LIVE from GET /voices with the
//      account key (includes factory + previously cloned voices), cached 1h.
//   3. Custom cloned voices       — rows in custom_voices (the route merges
//      them; this module only talks to the providers).
//
// Plus the clone + preview adapters used by /api/voices/*. Preview and clone
// requests resolve keys through lib/system-keys (DB-first, env fallback) so a
// key pasted into Security → System Keys works without a redeploy.
//
// SARVAM CLONING NOTE: the clone endpoints below follow the operator-provided
// Sarvam clone API spec (POST /voices/create multipart → { voice_id },
// synthesis via POST /voices/clone). Sarvam gates cloning per key tier — when
// the account has it, this works as-is; when it doesn't, the 404/403 is
// mapped to a clear "not enabled" error instead of a cryptic failure, and
// Cartesia cloning remains the always-available path.

import { query } from "./db"
import { getSystemKey } from "./system-keys"
import { normalizeForTts } from "./tts-normalize"

export type VoiceProvider = "sarvam" | "cartesia"
export type VoiceGender = "female" | "male" | "neutral"
export type VoiceLanguage = "english" | "hindi" | "telugu"

export type VoiceOption = {
  provider: VoiceProvider
  voiceId: string
  name: string
  gender: VoiceGender
  cloned: boolean
  description?: string
  origin: "preset" | "provider" | "custom"
}

// ---------- Keys (DB-first via system keys, env fallback) ----------

export async function getSarvamKey(): Promise<string> {
  return ((await getSystemKey("SARVAM_API_KEY")) || process.env.SARVAM_API_KEY || "").trim()
}

export async function getCartesiaKey(): Promise<string> {
  return ((await getSystemKey("CARTESIA_API_KEY")) || process.env.CARTESIA_API_KEY || "").trim()
}

const SARVAM_BASE = (process.env.SARVAM_URL || "https://api.sarvam.ai").replace(/\/$/, "")
const CARTESIA_BASE = (process.env.CARTESIA_URL || "https://api.cartesia.ai").replace(/\/$/, "")
const CARTESIA_VERSION = process.env.CARTESIA_VERSION || "2026-08-14"
const SARVAM_TTS_MODEL = process.env.SARVAM_TTS_MODEL || "bulbul:v3"
const CARTESIA_MODEL = process.env.CARTESIA_MODEL || "sonic-3.6"

// ---------- 1. Sarvam Bulbul v3 preset catalog ----------

// Documented Bulbul v3 speaker family. A speaker the account cannot use
// simply fails its live preview (the UI surfaces it as unavailable), so a
// name here costs nothing if Sarvam renames or gates it.
const SARVAM_VOICES: { id: string; gender: VoiceGender; note?: string }[] = [
  { id: "priya", gender: "female", note: "Default warm loan-advisor voice (the app's original Priya)" },
  { id: "ritu", gender: "female" },
  { id: "neha", gender: "female" },
  { id: "pooja", gender: "female" },
  { id: "simran", gender: "female" },
  { id: "kavya", gender: "female" },
  { id: "ishita", gender: "female" },
  { id: "shreya", gender: "female" },
  { id: "roopa", gender: "female" },
  { id: "tanya", gender: "female" },
  { id: "shruti", gender: "female" },
  { id: "suhani", gender: "female" },
  { id: "kavitha", gender: "female" },
  { id: "rupali", gender: "female" },
  { id: "amelia", gender: "female" },
  { id: "sophia", gender: "female" },
  { id: "shubh", gender: "male", note: "Authoritative male voice — loan-manager tone" },
  { id: "aditya", gender: "male" },
  { id: "rahul", gender: "male" },
  { id: "rohan", gender: "male" },
  { id: "amit", gender: "male" },
  { id: "dev", gender: "male" },
  { id: "varun", gender: "male" },
  { id: "manan", gender: "male" },
  { id: "kabir", gender: "male" },
  { id: "arjun", gender: "male" },
  { id: "mohan", gender: "male" },
  { id: "alok", gender: "male" },
  { id: "anand", gender: "male" },
]

export function sarvamPresets(): VoiceOption[] {
  return SARVAM_VOICES.map((v) => ({
    provider: "sarvam" as const,
    voiceId: v.id,
    name: v.id.charAt(0).toUpperCase() + v.id.slice(1),
    gender: v.gender,
    cloned: false,
    description: v.note,
    origin: "preset" as const,
  }))
}

// ---------- Preview sample lines (the audition script) ----------

export const SAMPLE_LINES: Record<VoiceLanguage, string> = {
  telugu: "Namaskaram! Nenu Priya, Right Agent Group nunni matladutunnanu. Mee loan gurinchi cheppandi.",
  hindi: "Namaste! Main Right Agent Group ki or se bol rahi hoon. Aapke loan ke baare mein bataiye.",
  english: "Namaskar! This is Priya from Right Agent Group. How may I help you with your loan today?",
}

const SARVAM_LOCALES: Record<VoiceLanguage, string> = { english: "en-IN", hindi: "hi-IN", telugu: "te-IN" }

// ---------- 2. Cartesia live voice list (cached 1h) ----------

type CartesiaVoiceRaw = {
  id: string
  name?: string
  description?: string
  language?: string
  gender?: string
  is_custom?: boolean
  // newer API shapes nest the locale
  language_iso639_3?: string
  locale?: string
}

let _cartesiaCache: { at: number; voices: VoiceOption[] } | null = null
const CARTESIA_CACHE_MS = 60 * 60 * 1000

export function clearCartesiaCache(): void {
  _cartesiaCache = null
}

function cartesiaGender(raw: CartesiaVoiceRaw): VoiceGender {
  const g = String(raw.gender || "").toLowerCase()
  if (g.startsWith("f")) return "female"
  if (g.startsWith("m")) return "male"
  return "neutral"
}

export async function listCartesiaVoices(): Promise<{ voices: VoiceOption[]; error?: string }> {
  const key = await getCartesiaKey()
  if (!key) return { voices: [], error: "CARTESIA_API_KEY is not set (Security → System Keys)" }
  if (_cartesiaCache && Date.now() - _cartesiaCache.at < CARTESIA_CACHE_MS) {
    return { voices: _cartesiaCache.voices }
  }
  try {
    const res = await fetch(`${CARTESIA_BASE}/voices`, {
      headers: { "X-API-Key": key, "Authorization": `Bearer ${key}`, "Cartesia-Version": CARTESIA_VERSION },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 160)
      return { voices: [], error: `Cartesia /voices failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}` }
    }
    const data = (await res.json()) as CartesiaVoiceRaw[] | { voices?: CartesiaVoiceRaw[] }
    const raws = Array.isArray(data) ? data : data?.voices || []
    const voices: VoiceOption[] = raws.map((v) => ({
      provider: "cartesia" as const,
      voiceId: v.id,
      name: v.name || v.id.slice(0, 8),
      gender: cartesiaGender(v),
      cloned: v.is_custom === true,
      description: v.description || undefined,
      origin: v.is_custom ? ("provider" as const) : ("provider" as const),
    }))
    _cartesiaCache = { at: Date.now(), voices }
    return { voices }
  } catch (e) {
    return { voices: [], error: `Cartesia /voices unreachable: ${e instanceof Error ? e.message : e}` }
  }
}

// ---------- 3. Preview synthesis (any preset or cloned voice) ----------

export class VoiceProviderError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

export async function synthesizePreview(
  provider: VoiceProvider,
  voiceId: string,
  language: VoiceLanguage,
  text?: string
): Promise<Buffer> {
  const clean = normalizeForTts((text || SAMPLE_LINES[language] || SAMPLE_LINES.english).trim().slice(0, 300))
  if (!clean) throw new VoiceProviderError("Preview text is empty after normalization", 400)
  if (provider === "sarvam") return sarvamPreview(clean, language, voiceId)
  return cartesiaPreview(clean, language, voiceId)
}

async function sarvamPreview(clean: string, language: VoiceLanguage, speaker: string): Promise<Buffer> {
  const key = await getSarvamKey()
  if (!key) throw new VoiceProviderError("SARVAM_API_KEY is not set (Security → System Keys)", 503)
  // Cloned Sarvam voices speak through the clone-synthesis endpoint.
  if (speaker.startsWith("svc-")) return sarvamCloneSynthesize(clean, language, speaker, key)
  const res = await fetch(`${SARVAM_BASE}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: clean,
      model: SARVAM_TTS_MODEL,
      language_code: SARVAM_LOCALES[language],
      speaker,
      output_audio_codec: "wav",
    }),
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 160)
    if (res.status === 400) {
      throw new VoiceProviderError(`Sarvam rejected speaker "${speaker}" — it may not exist in Bulbul ${SARVAM_TTS_MODEL} (HTTP 400)`, 400)
    }
    throw new VoiceProviderError(`Sarvam TTS failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`)
  }
  const data = (await res.json()) as { audios?: string[] }
  const wav = Buffer.from(Array.isArray(data?.audios) ? data.audios.join("") : "", "base64")
  if (wav.length < 100) throw new VoiceProviderError("Sarvam TTS returned empty audio")
  return wav
}

async function cartesiaPreview(clean: string, language: VoiceLanguage, voiceId: string): Promise<Buffer> {
  const key = await getCartesiaKey()
  if (!key) throw new VoiceProviderError("CARTESIA_API_KEY is not set (Security → System Keys)", 503)
  const res = await fetch(`${CARTESIA_BASE}/tts/bytes`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "X-API-Key": key,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: CARTESIA_MODEL,
      transcript: clean,
      voice: { id: voiceId },
      language: SARVAM_LOCALES[language],
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 },
    }),
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 160)
    throw new VoiceProviderError(`Cartesia TTS failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`)
  }
  const wav = Buffer.from(await res.arrayBuffer())
  if (wav.length < 100) throw new VoiceProviderError("Cartesia TTS returned empty audio")
  return wav
}

// ---------- 4. Cloning adapters ----------

export type CloneInput = {
  audio: Buffer
  audioMime: string
  name: string
  language: VoiceLanguage
  description?: string
}

/** Clone via Cartesia instant cloning (verified REST API). Returns the new voice id. */
export async function cartesiaCloneVoice(input: CloneInput): Promise<{ voiceId: string }> {
  const key = await getCartesiaKey()
  if (!key) throw new VoiceProviderError("CARTESIA_API_KEY is not set (Security → System Keys)", 503)
  const form = new FormData()
  const mime = (input.audioMime || "audio/wav").split(";")[0].trim().toLowerCase()
  const ext = mime.includes("webm") ? "sample.webm" : mime.includes("mp3") || mime.includes("mpeg") ? "sample.mp3" : "sample.wav"
  form.append("clip", new Blob([new Uint8Array(input.audio)], { type: mime }), ext)
  form.append("name", input.name)
  form.append("language", SARVAM_LOCALES[input.language] || "te-IN")
  if (input.description) form.append("description", input.description.slice(0, 300))
  const res = await fetch(`${CARTESIA_BASE}/voices/clone`, {
    method: "POST",
    headers: { "X-API-Key": key, "Authorization": `Bearer ${key}`, "Cartesia-Version": CARTESIA_VERSION },
    body: form,
    signal: AbortSignal.timeout(60000),
  })
  if (res.status === 402) {
    throw new VoiceProviderError(
      "Cartesia voice cloning requires a paid plan (HTTP 402: plan_upgrade_required). Please upgrade at https://play.cartesia.ai/subscription or use Sarvam voice cloning (ready on your account).",
      400
    )
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "")
    let msg = `Cartesia clone failed: HTTP ${res.status}`
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.message) msg = `Cartesia: ${parsed.message}`
    } catch {
      if (raw) msg += ` — ${raw.slice(0, 200)}`
    }
    throw new VoiceProviderError(msg, res.status >= 500 ? 502 : 400)
  }
  const data = (await res.json()) as { id?: string }
  if (!data?.id) throw new VoiceProviderError("Cartesia clone returned no voice id")
  clearCartesiaCache()
  return { voiceId: data.id }
}

/**
 * Clone via Sarvam (POST /voices/create, multipart form).
 * Fields: 'file' (audio clip 5-60s), 'name' (1-100 chars), 'language' (BCP-47 e.g. 'te-IN').
 */
export async function sarvamCloneVoice(input: CloneInput): Promise<{ voiceId: string }> {
  const key = await getSarvamKey()
  if (!key) throw new VoiceProviderError("SARVAM_API_KEY is not set (Security → System Keys)", 503)
  const form = new FormData()
  const mime = (input.audioMime || "audio/wav").split(";")[0].trim().toLowerCase()
  const ext = mime.includes("webm") ? "sample.webm" : mime.includes("mp3") || mime.includes("mpeg") ? "sample.mp3" : "sample.wav"
  form.append("file", new Blob([new Uint8Array(input.audio)], { type: mime }), ext)
  form.append("name", input.name.trim().slice(0, 80))
  form.append("language", SARVAM_LOCALES[input.language] || "te-IN")
  if (input.description) form.append("description", input.description.slice(0, 300))

  const res = await fetch(`${SARVAM_BASE}/voices/create`, {
    method: "POST",
    headers: { "api-subscription-key": key },
    body: form,
    signal: AbortSignal.timeout(60000),
  })

  if (res.status === 403 || res.status === 404) {
    throw new VoiceProviderError(
      "Sarvam voice cloning is not enabled for this API key (HTTP " + res.status + ") — please check your Sarvam plan permissions",
      400
    )
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "")
    let msg = `Sarvam clone failed: HTTP ${res.status}`
    try {
      const parsed = JSON.parse(raw)
      const err = parsed?.error || parsed
      if (err?.message) {
        msg = `Sarvam: ${err.message}`
        if (Array.isArray(err.failure_reasons) && err.failure_reasons.length) {
          msg += ` (${err.failure_reasons.join("; ")})`
        }
      }
    } catch {
      if (raw) msg += ` — ${raw.slice(0, 200)}`
    }
    throw new VoiceProviderError(msg, res.status >= 500 ? 502 : 400)
  }

  const data = (await res.json()) as { status?: string; data?: { voice_id?: string }; voice_id?: string; id?: string }
  const voiceId = data?.data?.voice_id || data?.voice_id || data?.id
  if (!voiceId) throw new VoiceProviderError("Sarvam clone succeeded but returned no voice id")
  return { voiceId }
}

/**
 * Synthesize through a Sarvam CLONED voice (voice ids look like "svc-...").
 * Endpoint: POST /voices/clone (multipart/form-data: voice_id, text, language_code).
 * Returns base64 audio in `audio_b64` envelope or raw audio bytes.
 */
async function sarvamCloneSynthesize(clean: string, language: VoiceLanguage, voiceId: string, key: string): Promise<Buffer> {
  const form = new FormData()
  form.append("voice_id", voiceId)
  form.append("text", clean)
  form.append("language_code", SARVAM_LOCALES[language] || "te-IN")

  const res = await fetch(`${SARVAM_BASE}/voices/clone`, {
    method: "POST",
    headers: { "api-subscription-key": key },
    body: form,
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 160)
    throw new VoiceProviderError(`Sarvam clone synthesis failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`)
  }
  const ctype = res.headers.get("content-type") || ""
  if (ctype.includes("audio/")) {
    const wav = Buffer.from(await res.arrayBuffer())
    if (wav.length >= 100) return wav
    throw new VoiceProviderError("Sarvam clone synthesis returned empty audio")
  }
  const data = (await res.json().catch(() => null)) as { audio_b64?: string; audios?: string[]; audio?: string } | null
  const b64 = data?.audio_b64 || data?.audio || (Array.isArray(data?.audios) ? data!.audios!.join("") : "")
  const wav = Buffer.from(b64, "base64")
  if (wav.length < 100) throw new VoiceProviderError("Sarvam clone synthesis returned empty audio")
  return wav
}

/** Delete a cloned voice at the provider (best-effort) + soft-delete locally. */
export async function deleteCustomVoice(rowId: string): Promise<{ providerDelete: "done" | "skipped" | "failed" }> {
  const res = await query(
    `UPDATE custom_voices SET is_active = false, updated_at = now() WHERE id = $1 RETURNING provider, voice_id`,
    [rowId]
  )
  const row = res.rows[0] as { provider: VoiceProvider; voice_id: string } | undefined
  if (!row) throw new VoiceProviderError("Voice not found", 404)

  if (row.provider === "cartesia") {
    try {
      const key = await getCartesiaKey()
      if (!key) return { providerDelete: "skipped" }
      const del = await fetch(`${CARTESIA_BASE}/voices/${encodeURIComponent(row.voice_id)}`, {
        method: "DELETE",
        headers: { "X-API-Key": key, "Authorization": `Bearer ${key}`, "Cartesia-Version": CARTESIA_VERSION },
        signal: AbortSignal.timeout(15000),
      })
      clearCartesiaCache()
      return { providerDelete: del.ok || del.status === 404 ? "done" : "failed" }
    } catch {
      return { providerDelete: "failed" }
    }
  }

  if (row.provider === "sarvam") {
    try {
      const key = await getSarvamKey()
      if (!key) return { providerDelete: "skipped" }
      const del = await fetch(`${SARVAM_BASE}/voices/delete/${encodeURIComponent(row.voice_id)}`, {
        method: "DELETE",
        headers: { "api-subscription-key": key },
        signal: AbortSignal.timeout(15000),
      })
      return { providerDelete: del.ok || del.status === 204 || del.status === 404 ? "done" : "failed" }
    } catch {
      return { providerDelete: "failed" }
    }
  }

  return { providerDelete: "skipped" }
}
