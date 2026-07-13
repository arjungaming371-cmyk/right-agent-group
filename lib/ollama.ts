// Local AI via Ollama — Priya, the Right Agent Group voice agent.
// Job on calls: build trust fast, handle objections, and collect
// name + address + WhatsApp number, then hand off to the WhatsApp form link.

export type Language = "english" | "hindi" | "telugu"

import { DEFAULT_SCRIPTS as SHARED_DEFAULT_SCRIPTS } from "./default-scripts"

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
const MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b"
const IS_GPU = process.env.OLLAMA_GPU === "true"

// ---- LLM backend switch ---------------------------------------------------
// "ollama" (default) talks to a local Ollama daemon — simplest path for dev
// on a laptop/CPU, but Ollama serves one request at a time by design here
// (see MAX_CONCURRENT below) — it was never meant to be a high-concurrency
// production server.
// "vllm" talks to a vLLM OpenAI-compatible server instead — the production
// path once real concurrency (10+ simultaneous live calls) matters. vLLM
// does continuous batching across in-flight requests, so one GPU serves
// many concurrent conversations far more efficiently than N separate Ollama
// calls queuing behind each other.
// Every AI function below is built on ONE shared pair of primitives
// (runCompletion / runCompletionStream), so this single env var is the only
// thing that needs to change to swap backends — no caller anywhere in this
// codebase (voice-conversation, the WhatsApp route, Lead Brain, Prompt
// Tuner, the Ops Assistant) needs to know or care which one is running.
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "ollama").toLowerCase()
const VLLM_URL = process.env.VLLM_URL || "http://localhost:8000"
const VLLM_MODEL = process.env.VLLM_MODEL || MODEL
const VLLM_API_KEY = process.env.VLLM_API_KEY || ""

// ---- Concurrency cap ----------------------------------------------------
// How many completions this app will have in flight AT ONCE, regardless of
// backend. For Ollama on a laptop, 1-2 is realistic — without a cap, three
// simultaneous calls each take 3x longer and ALL of them blow the per-turn
// timeout. For vLLM, raise this to match what your GPU can actually serve
// well (vLLM batches internally, but this cap still protects against
// firing more requests than your hardware has real throughput for).
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

// ---------------------------------------------------------------------------
// Shared completion primitives — the ONLY two places that actually issue an
// HTTP request to an LLM backend. Every function in this file (Priya's live
// replies, the Ops Assistant, Lead Brain extraction, Prompt Tuner) goes
// through one of these two. Adding a third backend later means adding one
// more branch here, not touching six call sites.
// ---------------------------------------------------------------------------

type CompletionOpts = {
  numCtx?: number
  numPredict?: number
  timeoutMs: number
  temperature?: number
  /** Ask the backend for strict JSON output (Ollama's format:"json" / vLLM's response_format). */
  json?: boolean
}

async function ollamaChatRequest(messages: OllamaMessage[], opts: CompletionOpts, signal: AbortSignal): Promise<string> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      // keep_alive keeps the model loaded in RAM between turns — without
      // it, every reply pays a multi-second model reload.
      keep_alive: "30m",
      ...(opts.json ? { format: "json" } : {}),
      options: IS_GPU
        ? { num_predict: opts.numPredict ?? 120, temperature: opts.temperature ?? 0.6, num_ctx: opts.numCtx ?? 2048, num_gpu: 99 }
        : { num_predict: opts.numPredict ?? 80, temperature: opts.temperature ?? 0.6, num_ctx: opts.numCtx ?? 1536, num_thread: 8 },
    }),
  })
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`)
  const data = await response.json()
  return data?.message?.content || ""
}

async function vllmChatRequest(messages: OllamaMessage[], opts: CompletionOpts, signal: AbortSignal): Promise<string> {
  const response = await fetch(`${VLLM_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(VLLM_API_KEY ? { Authorization: `Bearer ${VLLM_API_KEY}` } : {}) },
    signal,
    body: JSON.stringify({
      model: VLLM_MODEL,
      messages,
      stream: false,
      temperature: opts.temperature ?? 0.6,
      max_tokens: opts.numPredict ?? 120,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  })
  if (!response.ok) throw new Error(`vLLM HTTP ${response.status}`)
  const data = await response.json()
  return data?.choices?.[0]?.message?.content || ""
}

/** Non-streaming completion. Used by every function that just needs the final text (or JSON) back. */
async function runCompletion(messages: OllamaMessage[], opts: CompletionOpts): Promise<string> {
  const controller = new AbortController()
  await acquireSlot()
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    const text = LLM_PROVIDER === "vllm"
      ? await vllmChatRequest(messages, opts, controller.signal)
      : await ollamaChatRequest(messages, opts, controller.signal)
    if (!text || !text.trim()) throw new Error(`Empty ${LLM_PROVIDER} response`)
    return text.trim()
  } catch (e: any) {
    console.error(`${LLM_PROVIDER} error:`, e.message)
    throw e
  } finally {
    clearTimeout(timeoutId)
    releaseSlot()
  }
}

/**
 * Streaming completion — for UIs where a human is watching (the Ops
 * Assistant), so text appears as it's generated instead of after the full
 * reply. Ollama's stream is newline-delimited JSON; vLLM's OpenAI-compatible
 * stream is SSE ("data: {...}\n\n", terminated by "data: [DONE]") — the two
 * formats genuinely differ, so each gets its own parse loop below rather
 * than forcing a shared abstraction that would obscure both.
 */
async function runCompletionStream(messages: OllamaMessage[], opts: CompletionOpts, onChunk: (delta: string) => void): Promise<string> {
  const controller = new AbortController()
  await acquireSlot()
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs)
  let fullText = ""
  try {
    if (LLM_PROVIDER === "vllm") {
      const response = await fetch(`${VLLM_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(VLLM_API_KEY ? { Authorization: `Bearer ${VLLM_API_KEY}` } : {}) },
        signal: controller.signal,
        body: JSON.stringify({
          model: VLLM_MODEL,
          messages,
          stream: true,
          temperature: opts.temperature ?? 0.6,
          max_tokens: opts.numPredict ?? 120,
        }),
      })
      if (!response.ok || !response.body) throw new Error(`vLLM HTTP ${response.status}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue
          const payload = trimmed.slice(5).trim()
          if (!payload || payload === "[DONE]") continue
          try {
            const obj = JSON.parse(payload)
            const delta = obj?.choices?.[0]?.delta?.content
            if (delta) { fullText += delta; onChunk(delta) }
          } catch {
            // Malformed/partial SSE chunk — skip rather than abort the whole stream.
          }
        }
      }
    } else {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          messages,
          stream: true,
          keep_alive: "30m",
          options: IS_GPU
            ? { num_predict: opts.numPredict ?? 120, temperature: opts.temperature ?? 0.6, num_ctx: opts.numCtx ?? 2048, num_gpu: 99 }
            : { num_predict: opts.numPredict ?? 80, temperature: opts.temperature ?? 0.6, num_ctx: opts.numCtx ?? 1536, num_thread: 8 },
        }),
      })
      if (!response.ok || !response.body) throw new Error(`Ollama HTTP ${response.status}`)
      // Ollama's streaming format is newline-delimited JSON objects, each
      // { message: { content: "..." }, done: bool }, not SSE.
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || "" // last (possibly incomplete) line carries over
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line)
            const delta = obj?.message?.content
            if (delta) { fullText += delta; onChunk(delta) }
          } catch {
            // Malformed/partial line — skip rather than abort the whole stream.
          }
        }
      }
    }
    if (!fullText.trim()) throw new Error(`Empty ${LLM_PROVIDER} response`)
    return fullText.trim()
  } catch (e: any) {
    console.error(`${LLM_PROVIDER} stream error:`, e.message)
    throw e
  } finally {
    clearTimeout(timeoutId)
    releaseSlot()
  }
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
  systemPrompt: string,
  opts?: { numCtx?: number; numPredict?: number; timeoutMs?: number; historyTurns?: number }
): Promise<string> {
  if (!messages?.length) return "Hello! How can I help you today?"
  return runOllamaChat(messages, systemPrompt, opts)
}

/**
 * Same as chatWithSystemPrompt, but streams tokens to onChunk as they
 * arrive instead of waiting for the full reply — for UIs where a human is
 * watching (e.g. the Ops Assistant chat), so text starts appearing in
 * seconds instead of after the full 20-50s generation. Not used for Priya's
 * live-call turns, which speak the whole reply at once via TTS anyway.
 * Returns the full accumulated text once generation finishes.
 */
export async function chatWithSystemPromptStream(
  messages: { role: "user" | "model"; content: string }[],
  systemPrompt: string,
  onChunk: (delta: string) => void,
  opts?: { numCtx?: number; numPredict?: number; timeoutMs?: number; historyTurns?: number }
): Promise<string> {
  if (!messages?.length) return "Hello! How can I help you today?"
  const recentMessages = messages.slice(-(opts?.historyTurns ?? 6))
  const chatMessages = toOllamaMessages(recentMessages, systemPrompt)
  const timeoutMs = opts?.timeoutMs ?? (IS_GPU ? 35000 : 25000)
  return runCompletionStream(chatMessages, { numCtx: opts?.numCtx, numPredict: opts?.numPredict, timeoutMs }, onChunk)
}

async function runOllamaChat(
  messages: { role: "user" | "model"; content: string }[],
  systemPrompt: string,
  opts?: { numCtx?: number; numPredict?: number; timeoutMs?: number; historyTurns?: number }
): Promise<string> {
  const recentMessages = messages.slice(-(opts?.historyTurns ?? 6))
  const chatMessages = toOllamaMessages(recentMessages, systemPrompt)
  // GPU is normally much faster than CPU, but cold model loads (first
  // inference after a fresh pull/restart, or Kaggle's shared dual-GPU
  // scheduling) keep landing right at the wire — observed TWICE now:
  // 10.171s (old 10000ms cutoff) and 20.178s (old 20000ms cutoff). A tight
  // timeout that matches the "normal" case keeps getting blown by cold
  // starts, so give it real headroom instead of chasing the exact number.
  // Callers that aren't live phone calls (e.g. the staff dashboard
  // assistant) can pass a longer timeoutMs — a human reading a dashboard
  // reply tolerates a slower answer far better than someone on hold.
  const timeoutMs = opts?.timeoutMs ?? (IS_GPU ? 35000 : 25000)
  return runCompletion(chatMessages, { numCtx: opts?.numCtx, numPredict: opts?.numPredict, timeoutMs })
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
    const text = await runCompletion(
      [
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
      { timeoutMs: 15000, temperature: 0.1, numPredict: 150, json: true }
    )
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
    const text = await runCompletion(
      [
        { role: "system", content: "Return ONLY valid JSON, no other text." },
        { role: "user", content: `Summarize this call with keys: lead_name, address, whatsapp_number, next_action, sentiment.\n\n${transcript}` },
      ],
      { timeoutMs: IS_GPU ? 20000 : 30000, temperature: 0.2, numPredict: 150, json: true }
    )
    return text && text.trim() ? text.trim() : "{}"
  } catch (e) {
    console.error("Summary generation error:", e)
    return "{}"
  }
}

// ---------------------------------------------------------------------------
// Lead Brain — post-conversation analysis (never runs on the live-call path;
// always called in the background after a call ends or a WhatsApp thread
// goes idle). Same format:"json" + strict-parse pattern as extractLeadInfo /
// generateLeadSummary above, just a richer extraction shape.
// ---------------------------------------------------------------------------

export type LeadFacts = {
  loan_amount_needed?: number
  loan_type?: string
  employment_type?: string
  monthly_income?: number
  existing_loans?: string
  cibil_mentioned?: string
  property_details?: string
  urgency_level?: string
  preferred_language?: string
  best_time_to_call?: string
  family_references?: string
  objections_raised?: string[]
  competitors_mentioned?: string[]
}

export type LeadSentiment = "positive" | "neutral" | "frustrated" | "hostile"
export type LeadStage = "new" | "contacted" | "interested" | "docs_pending" | "negotiating" | "converted" | "lost" | "do_not_call"

export type LeadAnalysisResult = {
  new_facts: LeadFacts
  updated_summary: string
  sentiment: LeadSentiment
  stage_suggestion: LeadStage
  next_action: string
  objections: string[]
  one_line_summary: string
}

export const LEAD_ANALYSIS_PROMPT = `Return ONLY valid JSON, no other text, no markdown fences.

You are analyzing a conversation between Priya (an AI loan agent for Right Agent Group, Hyderabad) and a customer, across phone calls and WhatsApp messages. Extract structured facts and update the running relationship summary.

Return exactly this JSON shape:
{
  "new_facts": {
    "loan_amount_needed": number or null,
    "loan_type": string or null,
    "employment_type": string or null,
    "monthly_income": number or null,
    "existing_loans": string or null,
    "cibil_mentioned": string or null,
    "property_details": string or null,
    "urgency_level": "low" or "medium" or "high" or null,
    "preferred_language": "english" or "hindi" or "telugu" or null,
    "best_time_to_call": string or null,
    "family_references": string or null,
    "objections_raised": string[],
    "competitors_mentioned": string[]
  },
  "updated_summary": string (5-6 line rolling narrative of the WHOLE relationship so far, all channels combined — not just this conversation),
  "sentiment": "positive" or "neutral" or "frustrated" or "hostile",
  "stage_suggestion": "new" or "contacted" or "interested" or "docs_pending" or "negotiating" or "converted" or "lost" or "do_not_call",
  "next_action": string (one short actionable sentence for a human loan officer),
  "objections": string[] (objections raised in THIS conversation specifically),
  "one_line_summary": string (max ~100 chars, for a timeline entry)
}

Rules:
- Only include a fact in new_facts if it was ACTUALLY stated or clearly implied in the transcript. Use null for anything not mentioned — never guess or invent.
- "stage_suggestion" of "do_not_call" ONLY if the customer explicitly asked not to be contacted again, was hostile/abusive, or asked to be removed from the list. Do not suggest do_not_call for ordinary disinterest.
- updated_summary must build on the PREVIOUS summary given below, not replace it wholesale — merge in what's new, drop what's no longer relevant.
- Output raw JSON only. No explanations, no markdown code fences.`

const VALID_SENTIMENTS = new Set(["positive", "neutral", "frustrated", "hostile"])
const VALID_STAGES = new Set([
  "new", "contacted", "interested", "docs_pending", "negotiating", "converted", "lost", "do_not_call",
])
const FACT_STRING_KEYS = [
  "loan_type", "employment_type", "existing_loans", "cibil_mentioned", "property_details",
  "urgency_level", "preferred_language", "best_time_to_call", "family_references",
] as const
const FACT_NUMBER_KEYS = ["loan_amount_needed", "monthly_income"] as const
const FACT_ARRAY_KEYS = ["objections_raised", "competitors_mentioned"] as const

function normalizeAnalysisResult(parsed: any): LeadAnalysisResult {
  const rawFacts = parsed?.new_facts && typeof parsed.new_facts === "object" ? parsed.new_facts : {}
  const facts: LeadFacts = {}
  for (const k of FACT_STRING_KEYS) {
    if (typeof rawFacts[k] === "string" && rawFacts[k].trim()) (facts as any)[k] = rawFacts[k].trim().slice(0, 300)
  }
  for (const k of FACT_NUMBER_KEYS) {
    if (typeof rawFacts[k] === "number" && isFinite(rawFacts[k])) (facts as any)[k] = rawFacts[k]
  }
  for (const k of FACT_ARRAY_KEYS) {
    if (Array.isArray(rawFacts[k])) {
      (facts as any)[k] = rawFacts[k].filter((x: any) => typeof x === "string" && x.trim()).slice(0, 10).map((s: string) => s.trim().slice(0, 150))
    }
  }

  return {
    new_facts: facts,
    updated_summary: typeof parsed?.updated_summary === "string" ? parsed.updated_summary.trim().slice(0, 1200) : "",
    sentiment: VALID_SENTIMENTS.has(parsed?.sentiment) ? parsed.sentiment : "neutral",
    stage_suggestion: VALID_STAGES.has(parsed?.stage_suggestion) ? parsed.stage_suggestion : "contacted",
    next_action: typeof parsed?.next_action === "string" ? parsed.next_action.trim().slice(0, 300) : "",
    objections: Array.isArray(parsed?.objections)
      ? parsed.objections.filter((x: any) => typeof x === "string" && x.trim()).slice(0, 10).map((s: string) => s.trim().slice(0, 150))
      : [],
    one_line_summary: typeof parsed?.one_line_summary === "string" ? parsed.one_line_summary.trim().slice(0, 140) : "",
  }
}

/**
 * Background-only lead analysis. Retries once on invalid/unparseable JSON
 * (llama3.1:8b occasionally wraps output in prose despite format:"json").
 * Never throws — returns null on total failure so callers can log and skip
 * the merge rather than crashing whatever triggered them (a call ending, a
 * cron tick). Always runs off the live-call critical path — unlike Priya's
 * live conversational replies (25-35s timeout, ~80-120 tokens), this asks
 * for a much bigger structured JSON payload (up to 500 tokens), which on
 * CPU-only Ollama genuinely needs more wall-clock time. There is no live
 * caller waiting on this, so a generous timeout costs nothing.
 */
export async function analyzeLeadTranscript(transcriptText: string, existingSummary: string): Promise<LeadAnalysisResult | null> {
  const userContent =
    `PREVIOUS RELATIONSHIP SUMMARY:\n${existingSummary?.trim() || "(none yet — first contact)"}\n\n` +
    `NEW CONVERSATION TO ANALYZE:\n${transcriptText.slice(0, 8000)}`
  const timeoutMs = IS_GPU ? 45000 : 120000

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await runCompletion(
        [
          { role: "system", content: LEAD_ANALYSIS_PROMPT },
          { role: "user", content: userContent },
        ],
        { timeoutMs, temperature: 0.2, numPredict: 450, json: true }
      )
      const parsed = JSON.parse(text || "")
      return normalizeAnalysisResult(parsed)
    } catch (e: any) {
      console.error(`analyzeLeadTranscript attempt ${attempt} failed:`, e.message)
      if (attempt === 2) return null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Prompt Tuner \u2014 background-only, weekly. Reads a batch of recent
// conversations and proposes SMALL script-rule additions when the same
// friction shows up repeatedly. Never writes to ai_scripts itself \u2014 every
// suggestion lands in prompt_suggestions as "pending" and only an admin's
// explicit approve action (app/api/prompt-tuner) ever changes Priya's real
// script. See lib/prompt-tuner.ts for the batching + apply logic.
// ---------------------------------------------------------------------------

export type PromptSuggestionChannel = "voice" | "whatsapp" | "both"
export type PromptSuggestionRisk = "low" | "medium" | "high"

export type PromptSuggestion = {
  short_guideline: string
  channel: PromptSuggestionChannel
  situation: string
  risk: PromptSuggestionRisk
  source_summary: string
}

export const PROMPT_TUNER_PROMPT = `Return ONLY valid JSON, no other text, no markdown fences.

You are reviewing a batch of recent conversations between Priya (an AI loan-intake agent for Right Agent Group, Hyderabad) and customers, across phone calls and WhatsApp. Priya's job is to collect name, city, and WhatsApp number so a human loan officer can follow up \u2014 this is an information call, NOT a sales pitch, and Priya must never discuss interest rates, promise approval, or ask for OTP/payment. Her behavior is controlled by an editable plain-English script.

Look for REPEATED patterns across the conversations below \u2014 not a single unusual case \u2014 where a small, low-risk rule addition would clearly have helped. Propose at most 3 suggestions. If nothing repeats clearly, return an empty array \u2014 that is a valid and often correct answer.

Return exactly this JSON shape:
{
  "suggestions": [
    {
      "short_guideline": string (ONE imperative sentence, written in the same plain style as Priya's existing script rules, short enough to paste directly into the script as a single new line),
      "channel": "voice" or "whatsapp" or "both",
      "situation": string (short description of when this rule should apply),
      "risk": "low" or "medium" or "high",
      "source_summary": string (max ~150 chars \u2014 what pattern across the conversations prompted this)
    }
  ]
}

Rules:
- Only propose a change if the SAME kind of friction appears in at least two separate conversations below.
- "risk" is "high" if the suggestion touches consent, do-not-call handling, interest rates, guarantees, or anything that could sound like a compliance promise. "medium" if it changes how Priya handles frustration or objections. Everything else is "low".
- Never propose removing or weakening an existing safety rule (no OTP, no guaranteed approval, no interest-rate discussion, do-not-call handling) \u2014 only propose additions that help collection or reduce friction.
- Output raw JSON only. No explanations, no markdown code fences.`

const VALID_CHANNELS = new Set(["voice", "whatsapp", "both"])
const VALID_RISKS = new Set(["low", "medium", "high"])

function normalizePromptSuggestions(parsed: any): PromptSuggestion[] {
  const raw = Array.isArray(parsed?.suggestions) ? parsed.suggestions : []
  const out: PromptSuggestion[] = []
  for (const s of raw.slice(0, 3)) {
    const short_guideline = typeof s?.short_guideline === "string" ? s.short_guideline.trim().slice(0, 400) : ""
    if (!short_guideline) continue
    out.push({
      short_guideline,
      channel: VALID_CHANNELS.has(s?.channel) ? s.channel : "both",
      situation: typeof s?.situation === "string" ? s.situation.trim().slice(0, 300) : "",
      risk: VALID_RISKS.has(s?.risk) ? s.risk : "medium",
      source_summary: typeof s?.source_summary === "string" ? s.source_summary.trim().slice(0, 200) : "",
    })
  }
  return out
}

/**
 * Background-only, called at most weekly (lib/prompt-tuner.ts). Retries once
 * on invalid JSON. Never throws \u2014 returns null on total failure. A generous
 * timeout is fine: nothing is waiting on this synchronously, same reasoning
 * as analyzeLeadTranscript above.
 */
export async function generatePromptSuggestions(batchText: string): Promise<PromptSuggestion[] | null> {
  const timeoutMs = IS_GPU ? 60000 : 150000

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await runCompletion(
        [
          { role: "system", content: PROMPT_TUNER_PROMPT },
          { role: "user", content: batchText.slice(0, 10000) },
        ],
        { timeoutMs, temperature: 0.3, numPredict: 600, json: true }
      )
      const parsed = JSON.parse(text || "")
      return normalizePromptSuggestions(parsed)
    } catch (e: any) {
      console.error(`generatePromptSuggestions attempt ${attempt} failed:`, e.message)
      if (attempt === 2) return null
    }
  }
  return null
}

export function detectLanguage(text: string): Language {
  if (/[\u0C00-\u0C7F]/.test(text)) return "telugu"
  if (/[\u0900-\u097F]/.test(text)) return "hindi"
  return "english"
}

export async function checkOllamaHealth(): Promise<{ ok: boolean; message: string }> {
  try {
    if (LLM_PROVIDER === "vllm") {
      const res = await fetch(`${VLLM_URL}/v1/models`, {
        headers: VLLM_API_KEY ? { Authorization: `Bearer ${VLLM_API_KEY}` } : {},
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return { ok: false, message: `vLLM not responding: HTTP ${res.status}` }
      const data = await res.json()
      const hasModel = data?.data?.some((m: any) => m.id === VLLM_MODEL)
      if (!hasModel) return { ok: false, message: `Model ${VLLM_MODEL} not loaded on the vLLM server at ${VLLM_URL}` }
      return { ok: true, message: `vLLM ready with ${VLLM_MODEL}` }
    }
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { ok: false, message: `Ollama not responding: HTTP ${res.status}` }
    const data = await res.json()
    const hasModel = data?.models?.some((m: any) => m.name === MODEL || m.name === `${MODEL}:latest`)
    if (!hasModel) return { ok: false, message: `Model ${MODEL} not found. Run: ollama pull ${MODEL}` }
    return { ok: true, message: `Ollama ready with ${MODEL}` }
  } catch (e: any) {
    return { ok: false, message: `Cannot reach ${LLM_PROVIDER === "vllm" ? `vLLM at ${VLLM_URL}` : `Ollama at ${OLLAMA_URL}`}. Error: ${e.message}` }
  }
}
