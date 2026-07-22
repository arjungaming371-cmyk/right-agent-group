// Client for the self-hosted Whisper STT service (server/stt-service/app.py).
// Used by the voicebot bridge for live calls, and by the WhatsApp inbound
// handler to transcribe voice notes so they can be treated as a normal text
// turn in the conversation.

const STT_URL = (process.env.STT_SERVICE_URL || "http://127.0.0.1:3003").replace(/\/$/, "")
const STT_KEY = process.env.STT_API_KEY || process.env.WHATSAPP_SERVICE_KEY || ""

/** Returns "" (never throws) on any failure — callers fall back to a placeholder. */
export async function transcribeAudio(buffer: Buffer, language?: string): Promise<string> {
  if (!STT_KEY) return ""
  try {
    const qs = language ? `?language=${encodeURIComponent(language)}` : ""
    const res = await fetch(`${STT_URL}/transcribe${qs}`, {
      method: "POST",
      headers: { "x-api-key": STT_KEY, "Content-Type": "application/octet-stream" },
      body: buffer,
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return ""
    const data: any = await res.json().catch(() => ({}))
    return typeof data.text === "string" ? data.text.trim() : ""
  } catch (e: any) {
    console.error("transcribeAudio error:", e.message)
    return ""
  }
}
