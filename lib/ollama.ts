// Local AI via Ollama — Priya, the Right Agent Group voice agent.
// Job on calls: build trust fast, handle objections, and collect
// name + address + WhatsApp number, then hand off to the WhatsApp form link.

export type Language = "english" | "hindi" | "telugu"

import { DEFAULT_SCRIPTS as SHARED_DEFAULT_SCRIPTS } from "./default-scripts"

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
const MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b"
const IS_GPU = process.env.OLLAMA_GPU === "true"

// ---- Concurrency cap ----------------------------------------------------
// llama3.1:8b on a laptop can realistically serve 1-2 generations at once.
// Without a cap, three simultaneous calls each take 3x longer and ALL of
// them blow the per-turn timeout. With the cap, excess requests queue
// briefly and every caller still gets a fast reply.
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.OLLAMA_MAX_CONCURRENT || (IS_GPU ? "2" : "1")))
const MAX_QUEUE_WAIT_MS = 8000 // give up waiting rather than stall a live call

let active = 0
const waiters: { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }[] = []

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return
  }
  return new Promise((resolve, reject) => {
    const entry = {
      resolve: () => {
        active++
        resolve()
      },
      reject,
      timer: setTimeout(() => {
        const i = waiters.indexOf(entry)
        if (i >= 0) waiters.splice(i, 1)
        reject(new Error("Ollama busy — queue wait exceeded"))
      }, MAX_QUEUE_WAIT_MS),
    }
    waiters.push(entry)
  })
}

function releaseSlot(): void {
  active = Math.max(0, active - 1)
  const next = waiters.shift()
  if (next) {
    clearTimeout(next.timer)
    next.resolve()
  }
}
// -------------------------------------------------------------------------

// Compact conversation script. Kept tight on purpose — every extra token
// slows down llama3.1:8b replies during a live call.
// Default fallback scripts (used when DB is unavailable)
const DEFAULT_SCRIPTS = SHARED_DEFAULT_SCRIPTS

// Script cache — refreshed every 5 minutes so dashboard changes take
// effect quickly without hitting the DB on every single call turn.
let _scriptCache: Record<string, string> = {}
let _scriptCacheTime = 0
const SCRIPT_CACHE_TTL = 5 * 60 * 1000

async function getSystemPrompt(language: Language): Promise<string> {
  const now = Date.now()
  if (now - _scriptCacheTime < SCRIPT_CACHE_TTL && _scriptCache[language]) {
    return _scriptCache[language]
  }
  try {
    const { query } = await import("./db")
    const result = await query(
      `SELECT content FROM ai_scripts WHERE language = $1 LIMIT 1`,
      [language]
    )
    if (result.rows?.[0]?.content) {
      _scriptCache[language] = result.rows[0].content
      _scriptCacheTime = now
      return result.rows[0].content
    }
  } catch {
    // DB unavailable — fall through to default
  }
  return DEFAULT_SCRIPTS[language] || DEFAULT_SCRIPTS.english
}
interface OllamaMessage { role: "system" | "user" | "assistant"; content: string }

function toOllamaMessages(
  messages: { role: "user" | "model"; content: string }[],
  systemPrompt: string
): OllamaMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role === "model" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
  ]
}

export async function chatWithOllama(
  messages: { role: "user" | "model"; content: string }[],
  language: Language = "english",
  extraInstructions?: string
): Promise<string> {
  if (!messages?.length) return "Hello! How can I help you today?"

  let systemPrompt = await getSystemPrompt(language)
  if (extraInstructions?.trim()) {
    systemPrompt += `\n\nAdditional context for this specific call (from the operations team): ${extraInstructions.trim()}`
  }
  return runOllamaChat(messages, systemPrompt)
}

/**
 * Same Ollama call machinery (timeouts, concurrency slot, GPU options) as
 * chatWithOllama, but with a FULLY REPLACED system prompt instead of
 * Priya's customer-facing loan script + appended context. For callers that
 * are not Priya and must not inherit her persona — e.g. the internal staff
 * dashboard assistant (app/api/assistant/route.ts). Keeping this separate
 * from chatWithOllama is deliberate: each has its own job and its own
 * meaning, they should not be combined.
 */
export async function chatWithSystemPrompt(
  messages: { role: "user" | "model"; content: string }[],
  systemPrompt: string
): Promise<string> {
  if (!messages?.length) return "Hello! How can I help you today?"
  return runOllamaChat(messages, systemPrompt)
}

async function runOllamaChat(
  messages: { role: "user" | "model"; content: string }[],
  systemPrompt: string
): Promise<string> {
  const recentMessages = messages.slice(-6)
  const ollamaMessages = toOllamaMessages(recentMessages, systemPrompt)

  const controller = new AbortController()
  // GPU is normally much faster than CPU, but cold model loads (first
  // inference after a fresh pull/restart, or Kaggle's shared dual-GPU
  // scheduling) keep landing right at the wire — observed TWICE now:
  // 10.171s (old 10000ms cutoff) and 20.178s (old 20000ms cutoff). A tight
  // timeout that matches the "normal" case keeps getting blown by cold
  // starts, so give it real headroom instead of chasing the exact number.
  const timeoutMs = IS_GPU ? 35000 : 25000

  await acquireSlot()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: ollamaMessages,
        stream: false,
        // keep_alive keeps the model loaded in RAM between turns —
        // without it, every reply pays a multi-second model reload.
        keep_alive: "30m",
        options: IS_GPU
          ? { num_predict: 120, temperature: 0.6, num_ctx: 2048, num_gpu: 99 }
          : { num_predict: 80, temperature: 0.6, num_ctx: 1536, num_thread: 8 },
      }),
    })
    clearTimeout(timeoutId)
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`)
    const data = await response.json()
    const text = data?.message?.content
    if (!text || !text.trim()) throw new Error("Empty Ollama response")
    return text.trim()
  } catch (e: any) {
    clearTimeout(timeoutId)
    console.error("Ollama error:", e.message)
    throw e
  } finally {
    releaseSlot()
  }
}

export type ExtractedLead = {
  name: string | null
  address: string | null
  whatsapp_number: string | null
  complete: boolean
  interested: boolean | null
}

/**
 * Cheap pre-check before running lead extraction. Since a lead can only be
 * "complete" once a WhatsApp number exists, there is no point paying for an
 * extra Ollama round-trip until the transcript actually contains a
 * phone-number-looking string. This keeps most turns to ONE model call.
 */
export function mightBeComplete(transcriptText: string): boolean {
  return /\d[\d\s\-()]{8,}\d/.test(transcriptText)
}

/**
 * Reads the running transcript and decides: do we have name + address +
 * WhatsApp number yet? Used by the voice handler to know when to stop the
 * conversation, save the lead, and send the WhatsApp application link.
 */
export async function extractLeadInfo(transcriptText: string): Promise<ExtractedLead> {
  const empty: ExtractedLead = { name: null, address: null, whatsapp_number: null, complete: false, interested: null }
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "Return ONLY valid JSON, no other text. From the call transcript, extract: " +
              '"name" (string or null), "address" (string or null, city/area is enough), ' +
              '"whatsapp_number" (string or null, digits only, include country code if given), ' +
              '"complete" (true only if ALL THREE of name, address, whatsapp_number are known), ' +
              '"interested" (true if customer sounds interested/positive, false if clearly not interested, null if unclear).',
          },
          { role: "user", content: transcriptText },
        ],
        stream: false,
        format: "json",
        keep_alive: "30m",
        options: { temperature: 0.1, num_predict: 150 },
      }),
    })
    clearTimeout(timeoutId)
    const data = await response.json()
    const text = data?.message?.content
    const parsed = JSON.parse(text || "{}")
    return {
      name: typeof parsed.name === "string" ? parsed.name : null,
      address: typeof parsed.address === "string" ? parsed.address : null,
      whatsapp_number: typeof parsed.whatsapp_number === "string" ? parsed.whatsapp_number.replace(/[^\d+]/g, "") : null,
      complete: !!parsed.complete,
      interested: typeof parsed.interested === "boolean" ? parsed.interested : null,
    }
  } catch (e) {
    console.error("extractLeadInfo error:", e)
    return empty
  }
}

export async function generateLeadSummary(transcript: string): Promise<string> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "Return ONLY valid JSON, no other text." },
          { role: "user", content: `Summarize this call with keys: lead_name, address, whatsapp_number, next_action, sentiment.\n\n${transcript}` },
        ],
        stream: false,
        format: "json",
        keep_alive: "30m",
        options: { temperature: 0.2, num_predict: 150 },
      }),
    })
    const data = await response.json()
    const text = data?.message?.content
    return text && text.trim() ? text.trim() : "{}"
  } catch (e) {
    console.error("Summary generation error:", e)
    return "{}"
  }
}

export function detectLanguage(text: string): Language {
  if (/[\u0C00-\u0C7F]/.test(text)) return "telugu"
  if (/[\u0900-\u097F]/.test(text)) return "hindi"
  return "english"
}

export async function checkOllamaHealth(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`)
    if (!res.ok) return { ok: false, message: `Ollama not responding: HTTP ${res.status}` }
    const data = await res.json()
    const hasModel = data?.models?.some((m: any) => m.name === MODEL || m.name === `${MODEL}:latest`)
    if (!hasModel) return { ok: false, message: `Model ${MODEL} not found. Run: ollama pull ${MODEL}` }
    return { ok: true, message: `Ollama ready with ${MODEL}` }
  } catch (e: any) {
    return { ok: false, message: `Cannot reach Ollama at ${OLLAMA_URL}. Error: ${e.message}` }
  }
}
