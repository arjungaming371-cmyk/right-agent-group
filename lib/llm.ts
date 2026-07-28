// Priya's brain — Groq API (llama-3.3-70b, streaming). Job on calls: build
// trust fast, handle objections, and collect name + address + WhatsApp
// number, then hand off to the WhatsApp form link.

export type Language = "english" | "hindi" | "telugu"

import { DEFAULT_SCRIPTS as SHARED_DEFAULT_SCRIPTS } from "./default-scripts"

const GROQ_API_KEY = process.env.GROQ_API_KEY || ""
const GROQ_URL = (process.env.GROQ_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "")
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile"

/**
 * Whether it's safe to spend one extra small completion call mid-turn
 * (used by the knowledge-base agentic retrieval retry). Always true on
 * Groq — a fast external API with real concurrency headroom.
 */
export function canAffordExtraCompletion(): boolean {
  return true
}

// Default fallback scripts (used when DB is unavailable)
const DEFAULT_SCRIPTS = SHARED_DEFAULT_SCRIPTS

// ---- ONE SCRIPT, ALL LANGUAGES ----
// Priya has a SINGLE editable base script (ai_scripts row language='base').
// The per-language voice (Hinglish/Tenglish, Roman script) is appended here
// in code — so editing the script once updates every language, and the
// language rules can never drift out of sync the way three separate
// scripts did. Legacy per-language rows still work as a fallback when no
// base row exists.
export type Channel = "call" | "whatsapp"

// WhatsApp stays Roman-script always — it's read as text by the customer AND
// by the human team on the dashboard, so it needs to stay something everyone
// can read at a glance.
const LANGUAGE_STYLES: Record<Language, string> = {
  english: `

REPLY LANGUAGE — ENGLISH:
- The customer speaks English. Reply in simple, natural spoken English. If they mix in Hindi or Telugu words, you may mirror them.`,
  hindi: `

REPLY LANGUAGE — HINGLISH (MOST IMPORTANT RULE):
- The customer speaks Hindi. Reply ONLY in Hinglish: natural spoken Hindi written in English (Roman) letters, mixing everyday English words the way people actually talk. Example: "Namaste sir! Main Priya bol rahi hoon Right Agent Group, Hyderabad se. Aapka WhatsApp number mil sakta hai?"
- NEVER write in Devanagari (Hindi) script. Only English letters, always.
- The customer's words may appear in Hindi script from the call transcription — understand them normally, but still reply in Roman letters.`,
  telugu: `

REPLY LANGUAGE — TENGLISH (MOST IMPORTANT RULE):
- The customer speaks Telugu. Reply ONLY in Tenglish: natural spoken Telugu written in English (Roman) letters, mixing everyday English words the way people actually talk in Hyderabad. Example: "Namaskaram sir! Nenu Priya, Right Agent Group, Hyderabad nunchi matladutunnanu. Mee WhatsApp number cheppagalara?"
- NEVER write in Telugu script. Only English letters, always.
- The customer's words may appear in Telugu script from the call transcription — understand them normally, but still reply in Roman letters.`,
}

// Calls only: replies are spoken by TTS, never read as text, so there's no
// readability reason to force Roman letters — and forcing Roman letters was
// actively hurting call audio quality. The old pipeline had the LLM write
// Roman text, then a separate service reverse-transliterated it back to
// native Telugu/Devanagari script for the native-script TTS voices to read
// clearly, which mangled English loanwords in the process (e.g. "loan"
// guessed into Telugu script as "లోఅన్"). Having the LLM write native
// script directly — the way it already knows how to spell these words
// correctly — skips that lossy round-trip. English loanwords are kept in
// Latin letters intentionally, matching how people actually code-mix on
// WhatsApp/in speech, and matching the TTS service's own loanword handling
// (server/tts-service/app.py's _LOANWORDS list).
const CALL_LANGUAGE_STYLES: Record<Language, string> = {
  english: LANGUAGE_STYLES.english,
  hindi: `

CRITICAL OUTPUT FORMAT RULE — HINDI:
- The customer speaks Hindi. Your reply MUST be written in real Devanagari script (देवनागरी) — this is spoken aloud by a text-to-speech voice, not read as text, so write it the way you'd naturally spell Hindi.
- Do NOT write in Roman/English letters for Hindi words, even though the customer's own words arrive in Roman letters from the call transcription — always convert your OWN reply to real Devanagari script regardless of what script the customer used.
- Mix in everyday English words the way people actually talk, written in plain English letters right inside the Devanagari sentence (e.g. "loan", "WhatsApp", "sir"). Example: "नमस्ते sir! मैं प्रिया बोल रही हूं Right Agent Group, Hyderabad से। आपका WhatsApp number मिल सकता है?"`,
  telugu: `

CRITICAL OUTPUT FORMAT RULE — TELUGU:
- The customer speaks Telugu. Your reply MUST be written in real Telugu script (తెలుగు) — this is spoken aloud by a text-to-speech voice, not read as text, so write it the way you'd naturally spell Telugu.
- Do NOT write in Roman/English letters for Telugu words, even though the customer's own words arrive in Roman letters from the call transcription — always convert your OWN reply to real Telugu script regardless of what script the customer used.
- Mix in everyday English words the way people actually talk in Hyderabad, written in plain English letters right inside the Telugu sentence (e.g. "loan", "WhatsApp", "sir"). Example: "నమస్కారం sir! నేను ప్రియ, Right Agent Group, Hyderabad నుండి మాట్లాడుతున్నాను. మీ WhatsApp number చెప్పగలరా?"
- When reacting with warmth/sympathy (per the SOUND HUMAN instructions), use a genuine Telugu expression — NEVER transliterate an English filler word into Telugu script. "Arey" written as "అరేయ్" sounds like a blunt "hey you!", not sympathy, and clashes badly with calling them "sir" in the same breath. Use something like "అయ్యో sir", "ఔనండి", or "నిజమే sir" instead.`,
}

// Script cache — refreshed every 5 minutes so dashboard changes take
// effect quickly without hitting the DB on every single call turn.
let _scriptCache: Record<string, string> = {}
let _scriptCacheTime = 0
const SCRIPT_CACHE_TTL = 5 * 60 * 1000

async function getSystemPrompt(language: Language, channel: Channel = "whatsapp"): Promise<string> {
  const styles = channel === "call" ? CALL_LANGUAGE_STYLES : LANGUAGE_STYLES
  const cacheKey = `${channel}:${language}`
  const now = Date.now()
  if (now - _scriptCacheTime < SCRIPT_CACHE_TTL && _scriptCache[cacheKey]) {
    return _scriptCache[cacheKey]
  }
  try {
    const { query } = await import("./db")
    // Single base script first; legacy per-language row as fallback.
    const result = await query(
      `SELECT language, content FROM ai_scripts WHERE language IN ('base', $1)`,
      [language]
    )
    const base = result.rows?.find((r: any) => r.language === "base")?.content
    if (base) {
      const prompt = base + styles[language]
      _scriptCache[cacheKey] = prompt
      _scriptCacheTime = now
      return prompt
    }
    const legacy = result.rows?.find((r: any) => r.language === language)?.content
    if (legacy) {
      _scriptCache[cacheKey] = legacy
      _scriptCacheTime = now
      return legacy
    }
  } catch {
    // DB unavailable — fall through to default
  }
  // Rare DB-down fallback: always Roman-script (matches default-scripts.ts),
  // regardless of channel — not worth duplicating the native-script variant
  // into the fallback-only file for a path this infrequent.
  return DEFAULT_SCRIPTS[language] || DEFAULT_SCRIPTS.english
}

interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

function toChatMessages(
  messages: { role: "user" | "model"; content: string }[],
  systemPrompt: string
): ChatMessage[] {
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
// HTTP request to the LLM backend. Every function in this file (Priya's live
// replies, the Ops Assistant, Lead Brain extraction, Prompt Tuner) goes
// through one of these two.
// ---------------------------------------------------------------------------

type CompletionOpts = {
  numCtx?: number
  numPredict?: number
  timeoutMs: number
  temperature?: number
  /** Ask the backend for strict JSON output (response_format json_object). */
  json?: boolean
}

function groqBody(messages: ChatMessage[], opts: CompletionOpts, stream: boolean) {
  return JSON.stringify({
    model: GROQ_MODEL,
    messages,
    stream,
    temperature: opts.temperature ?? 0.6,
    max_tokens: opts.numPredict ?? 300,
    // Groq's JSON mode requires the word "JSON" in a message — all our JSON
    // prompts start with "Return ONLY valid JSON", so this is safe to map.
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
  })
}

const GROQ_HEADERS = { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` }

function assertGroqConfigured(): void {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set — the AI brain cannot run without it")
}

async function groqChatRequest(messages: ChatMessage[], opts: CompletionOpts, signal: AbortSignal): Promise<string> {
  const res = await fetch(`${GROQ_URL}/chat/completions`, {
    method: "POST",
    headers: GROQ_HEADERS,
    signal,
    body: groqBody(messages, opts, false),
  })
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data?.choices?.[0]?.message?.content || ""
}

/** Streaming Groq completion (SSE). Returns full text; deltas go to onChunk. */
async function groqChatStream(
  messages: ChatMessage[],
  opts: CompletionOpts,
  signal: AbortSignal,
  onChunk: (delta: string) => void
): Promise<string> {
  const res = await fetch(`${GROQ_URL}/chat/completions`, {
    method: "POST",
    headers: GROQ_HEADERS,
    signal,
    body: groqBody(messages, opts, true),
  })
  if (!res.ok || !res.body) throw new Error(`Groq HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let fullText = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) {
      const payload = line.startsWith("data: ") ? line.slice(6).trim() : ""
      if (!payload || payload === "[DONE]") continue
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          onChunk(delta)
        }
      } catch {
        // partial/keepalive line — skip
      }
    }
  }
  return fullText
}

/** Non-streaming completion. Used by every function that just needs the final text (or JSON) back. */
async function runCompletion(messages: ChatMessage[], opts: CompletionOpts): Promise<string> {
  assertGroqConfigured()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    const text = await groqChatRequest(messages, opts, controller.signal)
    if (!text.trim()) throw new Error("Empty Groq response")
    return text.trim()
  } catch (e: any) {
    console.error("Groq error:", e.message)
    throw e
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Streaming completion — for the live call path and UIs where a human is
 * watching (the Ops Assistant), so text appears as it's generated instead
 * of after the full reply.
 */
async function runCompletionStream(messages: ChatMessage[], opts: CompletionOpts, onChunk: (delta: string) => void): Promise<string> {
  assertGroqConfigured()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    const text = await groqChatStream(messages, opts, controller.signal, onChunk)
    if (!text.trim()) throw new Error("Empty Groq response")
    return text.trim()
  } catch (e: any) {
    console.error("Groq stream error:", e.message)
    throw e
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function chatWithLLM(
  messages: { role: "user" | "model"; content: string }[],
  language: Language = "english",
  extraInstructions?: string,
  opts?: { numPredict?: number; timeoutMs?: number; channel?: Channel }
): Promise<string> {
  if (!messages?.length) return "Hello! How can I help you today?"

  let systemPrompt = await getSystemPrompt(language, opts?.channel)
  if (extraInstructions?.trim()) {
    systemPrompt += `\n\n=== READ THIS BEFORE YOUR NEXT REPLY — overrides the generic GOAL step order above ===\n${extraInstructions.trim()}\n=== If IDENTITY or KNOWN FACTS above already answers a GOAL step, that step is DONE — do not ask for it, at most confirm it in passing. ===`
  }
  // numPredict 150: the script now answers real questions (rates, documents,
  // objections) in 2-3 sentences instead of always deflecting, so 90 tokens
  // was cutting her off mid-sentence. 150 covers that while still being far
  // short of a rambling paragraph. Text channels (WhatsApp) pass a higher
  // cap since nobody is waiting on hold there.
  return runChat(messages, systemPrompt, { numPredict: opts?.numPredict ?? 150, timeoutMs: opts?.timeoutMs })
}

/**
 * Streaming variant of chatWithLLM for the LIVE CALL path: same Priya
 * script + per-call context, but tokens flow to onChunk as they generate.
 * The voicebot cuts them into sentences and starts TTS on sentence 1 while
 * the model is still writing sentence 2 — this is what makes replies feel
 * immediate instead of "generate everything, then speak".
 * Returns the full reply text once generation completes.
 */
export async function chatWithLLMStream(
  messages: { role: "user" | "model"; content: string }[],
  language: Language = "english",
  extraInstructions: string | undefined,
  onChunk: (delta: string) => void,
  channel: Channel = "whatsapp"
): Promise<string> {
  if (!messages?.length) return "Hello! How can I help you today?"

  let systemPrompt = await getSystemPrompt(language, channel)
  if (extraInstructions?.trim()) {
    systemPrompt += `\n\n=== READ THIS BEFORE YOUR NEXT REPLY — overrides the generic GOAL step order above ===\n${extraInstructions.trim()}\n=== If IDENTITY or KNOWN FACTS above already answers a GOAL step, that step is DONE — do not ask for it, at most confirm it in passing. ===`
  }
  // 12 messages = 6 exchanges of live-call context — the extra prompt tokens
  // cost no noticeable time on Groq.
  const recentMessages = messages.slice(-12)
  const chatMessages = toChatMessages(recentMessages, systemPrompt)
  return runCompletionStream(chatMessages, { numPredict: 150, timeoutMs: 25000 }, onChunk)
}

/**
 * Same call machinery (timeouts) as chatWithLLM, but with a FULLY REPLACED
 * system prompt instead of Priya's customer-facing loan script + appended
 * context. For callers that are not Priya and must not inherit her persona
 * — e.g. the internal staff dashboard assistant (app/api/assistant/route.ts).
 */
export async function chatWithSystemPrompt(
  messages: { role: "user" | "model"; content: string }[],
  systemPrompt: string,
  opts?: { numCtx?: number; numPredict?: number; timeoutMs?: number; historyTurns?: number }
): Promise<string> {
  if (!messages?.length) return "Hello! How can I help you today?"
  return runChat(messages, systemPrompt, opts)
}

/**
 * Same as chatWithSystemPrompt, but streams tokens to onChunk as they
 * arrive instead of waiting for the full reply — for UIs where a human is
 * watching (e.g. the Ops Assistant chat).
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
  const chatMessages = toChatMessages(recentMessages, systemPrompt)
  const timeoutMs = opts?.timeoutMs ?? 25000
  return runCompletionStream(chatMessages, { numCtx: opts?.numCtx, numPredict: opts?.numPredict, timeoutMs }, onChunk)
}

async function runChat(
  messages: { role: "user" | "model"; content: string }[],
  systemPrompt: string,
  opts?: { numCtx?: number; numPredict?: number; timeoutMs?: number; historyTurns?: number }
): Promise<string> {
  // Default 12 (was 6): Priya's call + WhatsApp turns are short, and 3
  // exchanges of memory made her re-ask things said moments earlier.
  const recentMessages = messages.slice(-(opts?.historyTurns ?? 12))
  const chatMessages = toChatMessages(recentMessages, systemPrompt)
  const timeoutMs = opts?.timeoutMs ?? 25000
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
 * extra completion round-trip until the transcript actually contains a
 * phone-number-looking string. This keeps most turns to ONE model call.
 */
export function mightBeComplete(transcriptText: string): boolean {
  return /\d[\d\s\-()]{8,}\d/.test(transcriptText)
}

/**
 * True when a thrown error is Groq's 429 rate-limit response, so callers on
 * the live-call path can react DIFFERENTLY to "we're out of tokens right
 * now" than to any other failure — a generic retry keeps failing turn after
 * turn (the limit doesn't clear mid-call), so the right move is to end the
 * call gracefully and let a follow-up call continue once the window resets,
 * rather than stringing the customer along through repeated "technical
 * moment" replies.
 */
export function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("HTTP 429")
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
            '"whatsapp_number" (string or null, digits only, include country code if given). ' +
            "whatsapp_number must come from the CUSTOMER's own words — either they said the digits, or they explicitly answered YES to WhatsApp being on the number they are calling from. Priya merely ASKING about the number does NOT count; if the customer has not confirmed, whatsapp_number is null. " +
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

/**
 * Agentic RAG step: called ONLY when a first-pass knowledge-base search
 * came back empty or weak (see lib/knowledge-base.ts). Raw caller speech is
 * often indirect or STT-garbled ("emi kotha thakuva cheyocha" / "can it come
 * down some more") and never matches FAQ wording via full-text search. This
 * turns that into a short, clean, keyword-style query — or returns null if
 * the turn genuinely isn't a fact question (small talk, an answer to
 * Priya's own question, etc.), so the retry doesn't fire a second useless
 * search. Kept to one tiny, low-token call so the bounded retrieval loop
 * (search → grade → reformulate → search once) stays cheap enough for
 * call-turn latency.
 */
export async function rewriteKnowledgeQuery(rawQuery: string): Promise<string | null> {
  try {
    const text = await runCompletion(
      [
        {
          role: "system",
          content:
            "Return ONLY valid JSON, no other text. The user text is one turn from a phone/WhatsApp " +
            "conversation with a loan sales AI. Decide: is the customer asking a factual question " +
            "(eligibility, documents, interest rate, EMI, loan amount, process, timelines, etc.)? " +
            'If yes, return {"is_question": true, "query": "<3-6 keyword search query capturing what they want to know>"}. ' +
            'If it is small talk, a greeting, or personal info (name/address/number), return {"is_question": false, "query": null}.',
        },
        { role: "user", content: rawQuery.slice(0, 300) },
      ],
      { timeoutMs: 4000, temperature: 0.1, numPredict: 60, json: true }
    )
    const parsed = JSON.parse(text || "{}")
    if (parsed.is_question && typeof parsed.query === "string" && parsed.query.trim().length >= 3) {
      return parsed.query.trim().slice(0, 200)
    }
    return null
  } catch (e: any) {
    console.error("rewriteKnowledgeQuery error:", e.message)
    return null
  }
}

// Fields the AI is allowed to PROPOSE a change to. Deliberately excludes
// identity-sensitive fields (pan_number, phone, email, whatsapp_number) —
// those stay manual-only edits via the dashboard, never something a chat
// message alone can move even with staff approval as a gate.
export const AI_EDITABLE_LOAN_FIELDS = ["loan_type", "loan_amount", "city", "employment_type", "monthly_income"] as const
export type AiEditableLoanField = (typeof AI_EDITABLE_LOAN_FIELDS)[number]

export type LoanEditProposal = { field: AiEditableLoanField; new_value: string | number; reason: string } | null

/**
 * Called after a normal reply, on a turn that might be a correction request
 * ("I entered the wrong loan type", "actually it's 20 lakhs not 16") — NOT
 * on every turn, since this costs one extra completion. Never applies
 * anything itself: returns a proposal for lib/loan-edit-requests.ts to turn
 * into a pending row, which only takes effect once a human approves it.
 */
export async function detectLoanEditRequest(
  customerMessage: string,
  currentApplication: Record<string, any>
): Promise<LoanEditProposal> {
  try {
    const snapshot = AI_EDITABLE_LOAN_FIELDS.map((f) => `${f}: ${currentApplication[f] ?? "(not set)"}`).join(", ")
    const text = await runCompletion(
      [
        {
          role: "system",
          content:
            "Return ONLY valid JSON, no other text. The customer has an already-SUBMITTED loan application " +
            `with these current values: ${snapshot}. Decide: is the customer's message asking to CORRECT one ` +
            "of these fields on their existing application (not just chatting about it)? " +
            `Only these fields can be corrected: ${AI_EDITABLE_LOAN_FIELDS.join(", ")}. ` +
            'If yes, return {"is_correction": true, "field": "<one of the allowed fields>", "new_value": "<the corrected value>", "reason": "<one short sentence quoting/paraphrasing what the customer said>"}. ' +
            'If no (general question, small talk, or a field not in the allowed list), return {"is_correction": false}.',
        },
        { role: "user", content: customerMessage.slice(0, 500) },
      ],
      { timeoutMs: 6000, temperature: 0.1, numPredict: 120, json: true }
    )
    const parsed = JSON.parse(text || "{}")
    if (
      parsed.is_correction &&
      AI_EDITABLE_LOAN_FIELDS.includes(parsed.field) &&
      (typeof parsed.new_value === "string" || typeof parsed.new_value === "number") &&
      String(parsed.new_value).trim()
    ) {
      return { field: parsed.field, new_value: parsed.new_value, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "" }
    }
    return null
  } catch (e: any) {
    console.error("detectLoanEditRequest error:", e.message)
    return null
  }
}

export async function generateLeadSummary(transcript: string): Promise<string> {
  try {
    const text = await runCompletion(
      [
        { role: "system", content: "Return ONLY valid JSON, no other text." },
        { role: "user", content: `Summarize this call with keys: lead_name, address, whatsapp_number, next_action, sentiment.\n\n${transcript}` },
      ],
      { timeoutMs: 20000, temperature: 0.2, numPredict: 150, json: true }
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
// goes idle). Same json + strict-parse pattern as extractLeadInfo /
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
 * Background-only lead analysis. Retries once on invalid/unparseable JSON.
 * Never throws — returns null on total failure so callers can log and skip
 * the merge rather than crashing whatever triggered them (a call ending, a
 * cron tick). Always runs off the live-call critical path — there is no
 * live caller waiting on this, so a generous timeout costs nothing.
 */
export async function analyzeLeadTranscript(transcriptText: string, existingSummary: string): Promise<LeadAnalysisResult | null> {
  const userContent =
    `PREVIOUS RELATIONSHIP SUMMARY:\n${existingSummary?.trim() || "(none yet — first contact)"}\n\n` +
    `NEW CONVERSATION TO ANALYZE:\n${transcriptText.slice(0, 8000)}`
  const timeoutMs = 45000

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
// Prompt Tuner — background-only, weekly. Reads a batch of recent
// conversations and proposes SMALL script-rule additions when the same
// friction shows up repeatedly. Never writes to ai_scripts itself — every
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

You are reviewing a batch of recent conversations between Priya (an AI loan-intake agent for Right Agent Group, Hyderabad) and customers, across phone calls and WhatsApp. Priya's job is to collect name, city, and WhatsApp number so a human loan officer can follow up — this is an information call, NOT a sales pitch, and Priya must never discuss interest rates, promise approval, or ask for OTP/payment. Her behavior is controlled by an editable plain-English script.

Look for REPEATED patterns across the conversations below — not a single unusual case — where a small, low-risk rule addition would clearly have helped. Propose at most 3 suggestions. If nothing repeats clearly, return an empty array — that is a valid and often correct answer.

Return exactly this JSON shape:
{
  "suggestions": [
    {
      "short_guideline": string (ONE imperative sentence, written in the same plain style as Priya's existing script rules, short enough to paste directly into the script as a single new line),
      "channel": "voice" or "whatsapp" or "both",
      "situation": string (short description of when this rule should apply),
      "risk": "low" or "medium" or "high",
      "source_summary": string (max ~150 chars — what pattern across the conversations prompted this)
    }
  ]
}

Rules:
- Only propose a change if the SAME kind of friction appears in at least two separate conversations below.
- "risk" is "high" if the suggestion touches consent, do-not-call handling, interest rates, guarantees, or anything that could sound like a compliance promise. "medium" if it changes how Priya handles frustration or objections. Everything else is "low".
- Never propose removing or weakening an existing safety rule (no OTP, no guaranteed approval, no interest-rate discussion, do-not-call handling) — only propose additions that help collection or reduce friction.
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
 * on invalid JSON. Never throws — returns null on total failure. A generous
 * timeout is fine: nothing is waiting on this synchronously, same reasoning
 * as analyzeLeadTranscript above.
 */
export async function generatePromptSuggestions(batchText: string): Promise<PromptSuggestion[] | null> {
  const timeoutMs = 60000

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
  if (/[ఀ-౿]/.test(text)) return "telugu"
  if (/[ऀ-ॿ]/.test(text)) return "hindi"
  return "english"
}

export async function checkLLMHealth(): Promise<{ ok: boolean; message: string }> {
  if (!GROQ_API_KEY) return { ok: false, message: "GROQ_API_KEY is not set" }
  try {
    const res = await fetch(`${GROQ_URL}/models/${GROQ_MODEL}`, {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) return { ok: true, message: `Groq ready with ${GROQ_MODEL}` }
    return { ok: false, message: `Groq HTTP ${res.status} — check GROQ_API_KEY` }
  } catch (e: any) {
    return { ok: false, message: `Cannot reach Groq: ${e.message}` }
  }
}
