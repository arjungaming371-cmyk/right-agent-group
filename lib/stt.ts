// STT client for the WhatsApp inbound handler — voice notes become a normal
// text turn in the conversation.
//
// Cloud-only pipeline: Sarvam Saaras (saaras:v4) — no Python/GPU needed,
// OGG/MP3/WAV accepted natively, mode=translit returns Roman-script text
// that matches the app's Tenglish/Hinglish conversation layer (see
// lib/llm.ts).

const SARVAM_API_KEY = (process.env.SARVAM_API_KEY || "").trim()
const SARVAM_BASE = (process.env.SARVAM_URL || "https://api.sarvam.ai").replace(/\/$/, "")
const SARVAM_STT_MODEL = process.env.SARVAM_STT_MODEL || "saaras:v4"
const SARVAM_STT_MODE = process.env.SARVAM_STT_MODE || "translit"

// WhatsApp voice notes arrive as OGG/Opus; uploads and recordings may be
// WAV or MP3. Sarvam accepts all of them directly — no format help needed.
function sniffAudioMeta(buffer: Buffer): { filename: string; contentType: string } {
  if (buffer.length > 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") {
    return { filename: "audio.ogg", contentType: "audio/ogg" }
  }
  if (buffer.length > 3 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return { filename: "audio.mp3", contentType: "audio/mpeg" }
  }
  if (buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF") {
    return { filename: "audio.wav", contentType: "audio/wav" }
  }
  return { filename: "audio.ogg", contentType: "audio/ogg" } // WhatsApp default
}

async function sarvamTranscribe(buffer: Buffer, language?: string): Promise<string> {
  if (!SARVAM_API_KEY) {
    console.error("sarvamTranscribe error: SARVAM_API_KEY is not set (STT_PROVIDER=sarvam)")
    return ""
  }
  const { filename, contentType } = sniffAudioMeta(buffer)
  const boundary = "----rag-wa-stt-" + Math.random().toString(16).slice(2)
  const fields: Record<string, string> = { model: SARVAM_STT_MODEL, mode: SARVAM_STT_MODE }
  // The WhatsApp conversation is multilingual and the lead's language may not
  // be known yet when a voice note arrives — auto-detect is the right default
  // here (the voicebot path passes the call's known language instead).
  if (language) fields.language_code = language
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"))
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`, "utf8"))
  parts.push(buffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"))

  try {
    const res = await fetch(`${SARVAM_BASE}/speech-to-text`, {
      method: "POST",
      headers: {
        "api-subscription-key": SARVAM_API_KEY,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: Buffer.concat(parts),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      console.error(`sarvamTranscribe error: HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
      return ""
    }
    const data = (await res.json().catch(() => null)) as { transcript?: unknown } | null
    return typeof data?.transcript === "string" ? data.transcript.trim() : ""
  } catch (e) {
    console.error("sarvamTranscribe error:", e instanceof Error ? e.message : e)
    return ""
  }
}

/** Returns "" (never throws) on any failure — callers fall back to a placeholder. */
export async function transcribeAudio(buffer: Buffer, language?: string): Promise<string> {
  if (!buffer || buffer.length < 1000) return ""
  return sarvamTranscribe(buffer, language)
}
