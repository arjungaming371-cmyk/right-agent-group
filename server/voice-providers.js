// Right Agent Group — cloud voice providers for the Exotel voicebot.
//
// Lets Priya run on AWS (or any VM) WITHOUT the self-hosted Python STT/TTS
// services: no Whisper model to host, no GPU, no venv, no extra setup —
// the voice pipeline becomes three HTTPS calls per turn.
//
//   STT_PROVIDER=sarvam   → api.sarvam.ai/speech-to-text   (Saaras, batch per utterance)
//   TTS_CALL_PROVIDER=sarvam   → api.sarvam.ai/text-to-speech   (Bulbul v3)
//   TTS_CALL_PROVIDER=cartesia → api.cartesia.ai/tts/bytes      (Sonic 3.6)
//   (default for both: "edge"/"local" — the self-hosted services, unchanged)
//
// WHY mode="translit" ON STT: the app's entire conversation layer is written
// for Roman-script Tenglish/Hinglish (lib/llm.ts language rules, WhatsApp
// cross-channel memory, Lead Brain analysis). The local Whisper service
// transcribes in native script, then transliterates to Roman via
// indic-transliteration (server/stt-service/app.py). Sarvam's Saaras does
// that natively with mode="translit" — one call, same contract.
//
// WHY THE ffmpeg CHAIN STAYS: cloud TTS returns studio-quality WAV at 24kHz,
// which lands just as quiet on a phone line as Edge TTS did. voicebot-server's
// audioToPcm8k (band-pass → compressor → makeup gain → limiter → 8kHz) is
// applied to ALL providers identically — measured on real calls, it is what
// carries the voice, so it is deliberately not provider-conditional.
//
// Script guard, ported from server/tts-service/app.py's _voice_for(): a Hindi
// reply must never come out of the Telugu voice (or vice versa) because the
// call's declared language went stale after the caller switched. Native
// script in the text overrides the declared language for both cloud TTS
// providers, exactly like the Edge service does.
//
// No new npm dependencies: multipart bodies are assembled by hand, everything
// is plain Node 22 fetch.

// ---------- Configuration ----------

const STT_PROVIDER = (process.env.STT_PROVIDER || "local").toLowerCase()
const TTS_CALL_PROVIDER = (process.env.TTS_CALL_PROVIDER || process.env.TTS_PROVIDER || "edge").toLowerCase()

const SARVAM_API_KEY = (process.env.SARVAM_API_KEY || "").trim()
const SARVAM_BASE = (process.env.SARVAM_URL || "https://api.sarvam.ai").replace(/\/$/, "")
const SARVAM_STT_MODEL = process.env.SARVAM_STT_MODEL || "saaras:v4"
// translit = Romanized output (Tenglish/Hinglish). transcribe = native script.
// codemix = Indic words in native script with English words in Latin.
const SARVAM_STT_MODE = process.env.SARVAM_STT_MODE || "translit"
// Default: pass the call's known language as a recognition hint (same as the
// local Whisper path). SARVAM_STT_AUTO=1 always auto-detects instead — use it
// if callers switch languages mid-sentence so often the hint hurts more.
const SARVAM_STT_AUTO = (process.env.SARVAM_STT_AUTO || "0").trim() === "1"

const SARVAM_TTS_MODEL = process.env.SARVAM_TTS_MODEL || "bulbul:v3"
// bulbul:v3 female voices include "priya" — on the nose for this agent.
// Others: ritu, neha, pooja, simran, kavya, ishita, shreya, roopa, tanya,
// shruti, suhani, kavitha, rupali; males: shubh (default), aditya, rahul...
const SARVAM_TTS_SPEAKER = process.env.SARVAM_TTS_SPEAKER || "priya"
const SARVAM_TTS_SAMPLE_RATE = parseInt(process.env.SARVAM_TTS_SAMPLE_RATE || "24000")
const SARVAM_TTS_PACE = parseFloat(process.env.SARVAM_TTS_PACE || "1.0")

const CARTESIA_API_KEY = (process.env.CARTESIA_API_KEY || "").trim()
const CARTESIA_BASE = (process.env.CARTESIA_URL || "https://api.cartesia.ai").replace(/\/$/, "")
const CARTESIA_MODEL = process.env.CARTESIA_MODEL || "sonic-3.6"
// Pick a voice at https://play.cartesia.ai/voices and paste its ID here.
const CARTESIA_VOICE_ID = (process.env.CARTESIA_VOICE_ID || "").trim()
const CARTESIA_VERSION = process.env.CARTESIA_VERSION || "2026-08-14"
const CARTESIA_SAMPLE_RATE = parseInt(process.env.CARTESIA_SAMPLE_RATE || "24000")
const CARTESIA_SPEED = parseFloat(process.env.CARTESIA_SPEED || "1.0")

// ---------- Language mapping ----------
// The voicebot speaks three languages: "english" | "hindi" | "telugu".

const SARVAM_STT_LOCALES = { english: "en-IN", hindi: "hi-IN", telugu: "te-IN" }
const SARVAM_TTS_LOCALES = { english: "en-IN", hindi: "hi-IN", telugu: "te-IN" }
const CARTESIA_LOCALES = { english: "en-IN", hindi: "hi-IN", telugu: "te-IN" }

// Same script detection as server/tts-service/app.py.
const _TELUGU_RE = /[\u0C00-\u0C7F]/g // ఀ-౿
const _DEVANAGARI_RE = /[\u0900-\u097F]/g // ऀ-ॿ

/**
 * Resolve the TTS locale for a reply, letting native script overrule the
 * declared language (a Hindi sentence must never come out of the Telugu
 * voice). Latin-only text keeps the declared language — English replies and
 * the loanwords inside Indic-script replies are handled by the model itself.
 */
function resolveTtsLocale(text, language, locales) {
  const teluguChars = (text.match(_TELUGU_RE) || []).length
  const devanagariChars = (text.match(_DEVANAGARI_RE) || []).length
  if (teluguChars || devanagariChars) {
    // Mixed scripts shouldn't happen, but the dominant script wins.
    return teluguChars >= devanagariChars ? locales.telugu : locales.hindi
  }
  return locales[language] || locales.english
}

/** True when the text carries native Indic script (exported for tests). */
function hasIndicScript(text) {
  return _TELUGU_RE.test(text) || _DEVANAGARI_RE.test(text)
}

// ---------- Small fetch helpers ----------

async function fetchWithRetry(url, init, tries = 2) {
  let lastErr
  for (let attempt = 1; attempt <= tries; attempt++) {
    let res
    try {
      res = await fetch(url, init)
    } catch (e) {
      // Network-level failure (DNS, reset, timeout) — retryable.
      lastErr = e
      if (attempt < tries) {
        await new Promise((r) => setTimeout(r, 400))
        continue
      }
      throw lastErr
    }
    if (res.ok) return res
    // Retry transient server-side failures only — a 4xx is OUR mistake (bad
    // key, bad params) and retrying just burns the caller's airtime on dead
    // air. Throw here OUTSIDE the try block: a non-retryable status must
    // surface immediately, not be swallowed and retried as if it were a
    // network error.
    const detail = await res.text().catch(() => "")
    lastErr = new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`)
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable) throw lastErr
    if (attempt < tries) await new Promise((r) => setTimeout(r, 400))
  }
  throw lastErr
}

// ---------- Sarvam STT (batch, per utterance) ----------
//
// The sync REST endpoint accepts up to 30 seconds of audio — the voicebot
// caps utterances at 15s (MAX_UTTERANCE_MS), so every utterance fits.
// 8kHz telephony audio is supported natively; no upsampling needed.
//
// Returns { text, lowConfidence } — the SAME shape as the local Whisper
// service, so voicebot-server's endUtterance() logic is untouched.
// Sarvam's batch response carries no per-segment confidence figure, so
// lowConfidence is always false: the empty-transcript path still asks the
// caller to repeat, which is the failure mode that mattered live.

function buildMultipart(fields, fileField, fileBuffer, filename, contentType) {
  const boundary = "----rag-voice-" + Math.random().toString(16).slice(2)
  const parts = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      "utf8"
    ))
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    "utf8"
  ))
  parts.push(fileBuffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function sarvamStt(wavBuffer, language) {
  if (!SARVAM_API_KEY) throw new Error("SARVAM_API_KEY is not set — cannot use STT_PROVIDER=sarvam")
  const fields = { model: SARVAM_STT_MODEL, mode: SARVAM_STT_MODE }
  if (!SARVAM_STT_AUTO) {
    fields.language_code = SARVAM_STT_LOCALES[language] || "unknown"
  }
  const { body, contentType } = buildMultipart(fields, "file", wavBuffer, "audio.wav", "audio/wav")
  const t0 = Date.now()
  const res = await fetchWithRetry(`${SARVAM_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": SARVAM_API_KEY, "Content-Type": contentType },
    body,
    signal: AbortSignal.timeout(parseInt(process.env.VOICEBOT_STT_TIMEOUT_MS || "10000")),
  })
  const data = await res.json()
  console.log(`⏱ STT(sarvam ${SARVAM_STT_MODEL}/${SARVAM_STT_MODE}): ${Date.now() - t0}ms  lang=${data?.language_code || "?"}`)
  return { text: (data?.transcript || "").trim(), lowConfidence: false }
}

// ---------- Sarvam TTS (Bulbul v3) ----------

async function sarvamTts(text, language) {
  if (!SARVAM_API_KEY) throw new Error("SARVAM_API_KEY is not set — cannot use TTS_CALL_PROVIDER=sarvam")
  const locale = resolveTtsLocale(text, language, SARVAM_TTS_LOCALES)
  const body = {
    text,
    model: SARVAM_TTS_MODEL,
    language_code: locale,
    speaker: SARVAM_TTS_SPEAKER,
    speech_sample_rate: SARVAM_TTS_SAMPLE_RATE,
    output_audio_codec: "wav",
  }
  if (SARVAM_TTS_PACE !== 1.0) body.pace = SARVAM_TTS_PACE
  const t0 = Date.now()
  const res = await fetchWithRetry(`${SARVAM_BASE}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": SARVAM_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const data = await res.json()
  const audioB64 = Array.isArray(data?.audios) ? data.audios.join("") : ""
  const wav = Buffer.from(audioB64, "base64")
  if (wav.length < 100) throw new Error("Sarvam TTS returned empty audio")
  console.log(`⏱ TTS(sarvam ${SARVAM_TTS_MODEL}/${SARVAM_TTS_SPEAKER}@${locale}): ${Date.now() - t0}ms  ("${text.slice(0, 40)}${text.length > 40 ? "…" : ""}")`)
  return wav
}

// ---------- Cartesia TTS (Sonic 3.6) ----------
//
// Returns raw audio bytes (unlike Sarvam's base64 JSON envelope).
// WAV/pcm_s16le at CARTESIA_SAMPLE_RATE; ffmpeg in voicebot-server converts
// to 8kHz PCM for Exotel with the shared telephony filter chain.

async function cartesiaTts(text, language) {
  if (!CARTESIA_API_KEY) throw new Error("CARTESIA_API_KEY is not set — cannot use TTS_CALL_PROVIDER=cartesia")
  if (!CARTESIA_VOICE_ID) throw new Error("CARTESIA_VOICE_ID is not set — pick a voice at https://play.cartesia.ai/voices")
  const locale = resolveTtsLocale(text, language, CARTESIA_LOCALES)
  const body = {
    model_id: CARTESIA_MODEL,
    transcript: text,
    voice: { id: CARTESIA_VOICE_ID },
    language: locale,
    output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: CARTESIA_SAMPLE_RATE },
  }
  if (CARTESIA_SPEED !== 1.0) {
    body.generation_config = { speed: CARTESIA_SPEED }
  }
  const t0 = Date.now()
  const res = await fetchWithRetry(`${CARTESIA_BASE}/tts/bytes`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CARTESIA_API_KEY}`,
      "X-API-Key": CARTESIA_API_KEY,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const wav = Buffer.from(await res.arrayBuffer())
  if (wav.length < 100) throw new Error("Cartesia TTS returned empty audio")
  console.log(`⏱ TTS(cartesia ${CARTESIA_MODEL}@${locale}): ${Date.now() - t0}ms  ("${text.slice(0, 40)}${text.length > 40 ? "…" : ""}")`)
  return wav
}

// ---------- Unified dispatch (used by voicebot-server) ----------

function sttProviderName() {
  return STT_PROVIDER
}

function ttsCallProviderName() {
  return TTS_CALL_PROVIDER
}

async function transcribe(wavBuffer, language) {
  if (STT_PROVIDER === "sarvam") return sarvamStt(wavBuffer, language)
  return null // caller falls back to the local service path
}

async function synthesize(text, language) {
  if (TTS_CALL_PROVIDER === "sarvam") return sarvamTts(text, language)
  if (TTS_CALL_PROVIDER === "cartesia") return cartesiaTts(text, language)
  return null // caller falls back to the local Edge service path
}

/** Boot-time config validation — fail fast with a message that names the fix. */
function validateConfig() {
  const errors = []
  if (STT_PROVIDER === "sarvam" && !SARVAM_API_KEY) {
    errors.push("STT_PROVIDER=sarvam but SARVAM_API_KEY is not set (get one at dashboard.sarvam.ai)")
  }
  if (TTS_CALL_PROVIDER === "sarvam" && !SARVAM_API_KEY) {
    errors.push("TTS_CALL_PROVIDER=sarvam but SARVAM_API_KEY is not set")
  }
  if (TTS_CALL_PROVIDER === "cartesia") {
    if (!CARTESIA_API_KEY) errors.push("TTS_CALL_PROVIDER=cartesia but CARTESIA_API_KEY is not set")
    if (!CARTESIA_VOICE_ID) errors.push("TTS_CALL_PROVIDER=cartesia but CARTESIA_VOICE_ID is not set (pick one at play.cartesia.ai/voices)")
  }
  if (STT_PROVIDER !== "local" && STT_PROVIDER !== "sarvam") {
    errors.push(`STT_PROVIDER="${STT_PROVIDER}" is not a known provider (local | sarvam)`)
  }
  if (!["edge", "local", "sarvam", "cartesia"].includes(TTS_CALL_PROVIDER)) {
    errors.push(`TTS_CALL_PROVIDER="${TTS_CALL_PROVIDER}" is not a known provider (edge | sarvam | cartesia)`)
  }
  return errors
}

function describeCallPipeline() {
  const stt = STT_PROVIDER === "sarvam"
    ? `Sarvam ${SARVAM_STT_MODEL} mode=${SARVAM_STT_MODE} (cloud)`
    : "self-hosted Whisper (server/stt-service)"
  const tts = TTS_CALL_PROVIDER === "sarvam"
    ? `Sarvam ${SARVAM_TTS_MODEL} speaker=${SARVAM_TTS_SPEAKER} (cloud)`
    : TTS_CALL_PROVIDER === "cartesia"
      ? `Cartesia ${CARTESIA_MODEL} (cloud)`
      : "self-hosted Edge TTS (server/tts-service)"
  return `STT: ${stt} | TTS: ${tts}`
}

module.exports = {
  // config introspection
  sttProviderName, ttsCallProviderName, validateConfig, describeCallPipeline,
  // dispatchers (return null = "not mine, use the local path")
  transcribe, synthesize,
  // direct provider calls (exported for tests + reuse)
  sarvamStt, sarvamTts, cartesiaTts,
  // internals used by tests
  resolveTtsLocale, hasIndicScript, buildMultipart, fetchWithRetry,
}
