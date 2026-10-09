// Script Studio (lib/script-studio.ts) — Outpero-style per-lead script
// personalization, adapted to Right Agent Group's Priya.
//
// Outpero's headline flow: the operator uploads a lead sheet ("Lead Source /
// Sheet → Input: first_name, purchase, plan"), writes ONE script with
// placeholders — "Hi {{first_name}}! I see you recently purchased the
// {{purchase}} on our {{plan}} plan…" — and every call is personalized from
// that row's data. This module is that engine, converted to RAG's reality:
//
//   • Templates are TALKING POINTS (the campaign agenda stamped on
//     outbound_queue.talking_points / lead notes), not a replacement of
//     Priya's base persona script — lib/llm.ts merges instructions with the
//     base script on every turn, so a campaign brief rides ALONGSIDE the
//     persona, the language rules and the hard safety rules.
//   • Placeholders are {single_brace} (same convention the channel scripts
//     already use for {name} / {brand} / {link} in lib/channel-scripts.ts).
//   • Values come from canonical lead columns (name, product_interest,
//     loan_amount…) + the CSV's own extra columns captured into
//     leads/outbound_queue.custom_fields JSONB (migration
//     2026-10-09_lead_custom_fields).
//
// PURE FILE, ZERO IMPORTS — on purpose (same convention as
// lib/dialer-logic.ts / lib/csv-parse.ts): scripts/test-script-studio.js
// compiles THIS exact file with the repo's tsc and exercises it without a DB.

// ---------- Field vocabulary ----------

/** Canonical {fields} rendered from the lead row itself. */
export const CANONICAL_FIELDS = [
  "name", "phone", "language", "product_interest", "loan_amount",
  "address", "notes", "status", "source", "callback_note",
] as const

export type FieldVars = Record<string, string>

/** lead row subset the renderer understands (keys mirror the DB columns). */
export type Leadish = {
  name?: string | null
  phone?: string | null
  language?: string | null
  product_interest?: string | null
  loan_amount?: number | string | null
  address?: string | null
  notes?: string | null
  status?: string | null
  source?: string | null
  callback_note?: string | null
}

const FIELD_CAP = 15
const VALUE_CAP = 200

/** Human label for a field — the studio UI's chip list. */
export function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    name: "Lead name", phone: "Phone", language: "Language",
    product_interest: "Product interest", loan_amount: "Loan amount",
    address: "Address", notes: "Notes", status: "Status",
    source: "Source", callback_note: "Callback note",
  }
  return labels[key] || key.replace(/_/g, " ")
}

// ---------- Extraction / rendering ----------

const TOKEN_RE = /\{([a-zA-Z0-9_]+)\}/g

/** Unique {tokens} in a template, in first-appearance order. */
export function extractMergeFields(template: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of String(template || "").matchAll(TOKEN_RE)) {
    const key = m[1]
    if (!seen.has(key)) { seen.add(key); out.push(key) }
  }
  return out
}

export type RenderResult = {
  text: string
  /** Known fields with no value on this lead (rendered as empty). */
  missing: string[]
  /** Tokens that are neither known fields nor in custom_fields (left as-is in preview). */
  unknown: string[]
}

/**
 * Studio/preview render: known-but-empty fields become "", unknown tokens
 * stay visible so the operator can spot typos BEFORE the campaign runs.
 * `known` is the universe of fields that CAN exist (defaults to the keys
 * present in `vars`) — pass the full canonical+custom list when `vars` only
 * holds a sample lead so a canonical-but-empty field is reported as
 * "missing", not mislabeled as a typo.
 */
export function renderMergeFields(template: string, vars: FieldVars, known?: readonly string[]): RenderResult {
  const knownSet = new Set(known ?? Object.keys(vars))
  const missing = new Set<string>()
  const unknown = new Set<string>()
  const text = String(template || "").replace(TOKEN_RE, (match, key: string) => {
    if (knownSet.has(key)) {
      const v = vars[key] ?? ""
      if (v === "") missing.add(key)
      return v
    }
    unknown.add(key)
    return match
  })
  return { text, missing: [...missing], unknown: [...unknown] }
}

/**
 * Dial-time render + cleanup: everything resolves against the row's data,
 * and any token that somehow survived (template edited after queueing, a
 * custom column dropped) is stripped — Priya must never READ "brace name
 * brace" aloud. Also tidies the whitespace a stripped token leaves behind.
 */
export function renderForDial(template: string, vars: FieldVars): string {
  const { text } = renderMergeFields(template, vars)
  return sanitizeRenderedScript(text)
}

/** Strip leftover {tokens} and tidy punctuation/spacing for TTS. */
export function sanitizeRenderedScript(text: string): string {
  return String(text || "")
    .replace(TOKEN_RE, " ")
    .replace(/\s+([,.;:!?])/g, "$1")   // "word , " → "word,"
    .replace(/([,.;:!?])(?=[^\s\d])/g, "$1 ") // "word,word" → "word, word"
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Build the full token map for one lead: canonical columns + custom fields. */
export function buildFieldVars(
  lead: Leadish | null | undefined,
  custom: Record<string, unknown> | null | undefined
): FieldVars {
  const vars: FieldVars = {}
  const s = (v: unknown): string =>
    v === null || v === undefined ? "" : String(v).trim().slice(0, VALUE_CAP)
  vars.name = s(lead?.name)
  vars.phone = s(lead?.phone)
  vars.language = s(lead?.language)
  vars.product_interest = s(lead?.product_interest)
  vars.loan_amount =
    lead?.loan_amount === null || lead?.loan_amount === undefined || lead?.loan_amount === ""
      ? ""
      : `₹${Number(lead.loan_amount).toLocaleString("en-IN")}`
  vars.address = s(lead?.address)
  vars.notes = s(lead?.notes)
  vars.status = s(lead?.status)
  vars.source = s(lead?.source)
  vars.callback_note = s(lead?.callback_note)
  if (custom && typeof custom === "object" && !Array.isArray(custom)) {
    for (const [k, v] of Object.entries(custom).slice(0, FIELD_CAP)) {
      const key = k.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
      if (!key) continue
      vars[key] = s(v)
    }
  }
  return vars
}

/**
 * "Data in. Data out." — the compact per-lead fact sheet appended to the
 * talking points so Priya OPENS with what the sheet already knows instead
 * of interrogating ("perfect notes every time", Outpero's promise).
 */
export function buildLeadBrief(custom: Record<string, unknown> | null | undefined): string {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return ""
  const parts: string[] = []
  for (const [k, v] of Object.entries(custom).slice(0, FIELD_CAP)) {
    const val = String(v ?? "").trim()
    if (!val) continue
    parts.push(`${fieldLabel(k)}: ${val.slice(0, VALUE_CAP)}`)
  }
  return parts.join(" · ")
}

/** True when a template uses at least one {field}. */
export function hasMergeFields(template: string): boolean {
  return TOKEN_RE.test(String(template || ""))
}

/**
 * Validate an untrusted custom_fields payload (CSV upload column, contact
 * JSON, assistant payload) into a safe {string: string} map: max 15 keys,
 * keys slugified to [a-z0-9_], values capped at 200 chars, empties dropped.
 * Returns null when nothing usable survives.
 */
export function sanitizeCustomFields(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= FIELD_CAP) break
    const key = String(k).trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
    if (!key) continue
    let val = ""
    if (typeof v === "string") val = v.trim()
    else if (typeof v === "number" || typeof v === "boolean") val = String(v)
    if (!val) continue
    out[key] = val.slice(0, VALUE_CAP)
  }
  return Object.keys(out).length ? out : null
}

/**
 * DIAL-TIME instruction builder — the one place a queue row / speed-to-lead
 * call becomes Priya's per-lead brief:
 *   1. {merge_fields} in the agenda are rendered from the lead row + the
 *      sheet's custom columns (leftover tokens stripped — never spoken).
 *   2. When the lead HAS custom sheet data, a compact "LEAD DATA ON FILE"
 *      fact sheet is appended even to a plain agenda, so Priya opens with
 *      what the CSV already knows (Outpero's "perfect notes every time").
 * Returns null when there is genuinely nothing to say.
 */
export function renderInstructionsForLead(
  template: string | null | undefined,
  lead: Leadish | null,
  custom: unknown
): string | null {
  const tp = String(template || "").trim()
  const safeCustom = sanitizeCustomFields(custom)
  let text = tp
  if (tp && hasMergeFields(tp)) {
    text = renderForDial(tp, buildFieldVars(lead, safeCustom))
  }
  const brief = buildLeadBrief(safeCustom)
  if (brief) text = `${text ? `${text}\n\n` : ""}LEAD DATA ON FILE (use it, never re-ask): ${brief}`
  return text.trim() || null
}

// ---------- Outpero-style campaign script builder ----------
//
// "Swara HR briefs your employee — sets the script, voice and what to
// capture — in minutes." This builder is that HR brief for Priya: given the
// campaign's product / offer / tone / capture list it produces a complete,
// structured agenda in the operator's chosen language style — in Priya's
// voice, under RAG's hard rules (no OTP, no guarantees, graceful after 2
// NOs, WhatsApp form close). Used as the default content of the Studio
// editor and as the no-LLM fallback of /api/script-studio.

export type StudioLanguage = "english" | "hindi" | "telugu"
export type CampaignBriefInput = {
  product: string
  offer: string
  audience?: string
  tone?: "friendly" | "professional" | "energetic"
  capture?: string[]
  language: StudioLanguage
}

function toneLine(tone: CampaignBriefInput["tone"]): string {
  switch (tone) {
    case "professional": return "TONE: Calm and professional — confident advisor, zero hard-sell."
    case "energetic": return "TONE: Bright and energetic — match the customer's excitement, stay genuine."
    default: return "TONE: Warm and friendly — talk like a helpful neighbour, not a call-center script."
  }
}

const CAPTURE_DEFAULTS = ["Full name", "Area / city", "Loan amount needed", "Monthly income", "WhatsApp number"]

/**
 * The Outpero-style structured campaign brief. Every line is an instruction
 * Priya follows ON TOP of her base script (which already owns persona,
 * language-mirroring and safety) — this is the per-campaign delta.
 */
export function buildCampaignScript(input: CampaignBriefInput): string {
  const product = (input.product || "Home Loan").trim()
  const offer = (input.offer || "").trim() || `our current ${product} offer`
  const audience = (input.audience || "").trim()
  const capture = (input.capture?.length ? input.capture : CAPTURE_DEFAULTS).slice(0, 8)
  const lang = input.language

  if (lang === "telugu") {
    return `CAMPAIGN BRIEF — ${product} outreach (Right Agent Group, Hyderabad)
${audience ? `AUDIENCE: ${audience}. ` : ""}${toneLine(input.tone)}

OPENING (use the customer's data — never interrogate):
"Namaskaram {name} garu! Nenu Priya, Right Agent Group, Hyderabad nunchi matladutunnanu."
Reference WHY you are calling right now: ${offer}.
CUSTOMER DATA ON FILE: {product_interest}${buildLeadBriefHintTelugu()} — use it naturally, NEVER re-ask what you already know.

DISCOVERY (ONE question, then listen):
Ask about their current ${product} situation — bank chesara? EMI heavy ga undha? Ippudu need em undhi?

PITCH (pain-relief, not features):
Explain ${offer} in ONE breath: "Meme 20+ banks tho pan cheyyam — meeru bank to bank run avvakunda, best offer mem istham."
Connect it to what they told you — their words, their problem.

DETAILS TO CAPTURE (one at a time, each as its own clear question):
${capture.map((c, i) => `${i + 1}) ${c}`).join("\n")}

READBACK (MANDATORY before closing):
Once details are done, confirm everything in ONE short sentence and wait for "yes" — Outpero-style perfect notes.

CLOSE:
"Thank you sir — nenu ippude meeku simple loan application WhatsApp pampistunnanu, fill cheyandi. Maa loan officer meeku personally call chesi final rate cheptharu."
Then send the form and end the call warmly.

HARD RULES (never break):
- No OTP, PIN, card number or payment questions. Ever.
- Never guarantee approval — "very good chances" at most.
- Never invent rates or figures — only what the knowledge context gives.
- 2 clear NOs → respect it, offer the WhatsApp details, leave a good impression.`
  }

  if (lang === "hindi") {
    return `CAMPAIGN BRIEF — ${product} outreach (Right Agent Group, Hyderabad)
${audience ? `AUDIENCE: ${audience}. ` : ""}${toneLine(input.tone)}

OPENING (use the customer's data — never interrogate):
"Namaste {name} ji! Main Priya bol rahi hoon Right Agent Group, Hyderabad se."
Reference WHY you are calling right now: ${offer}.
CUSTOMER DATA ON FILE: {product_interest}${buildLeadBriefHintHindi()} — use it naturally, NEVER re-ask what you already know.

DISCOVERY (ONE question, then listen):
Ask about their current ${product} situation — "Abhi loan kisi bank se chal raha hai, ya naya plan kar rahe hain?"

PITCH (pain-relief, not features):
Explain ${offer} in ONE breath: "Hum 20+ banks ke saath kaam karte hain — aapko bank-bank bhaagne nahi padega, best offer hum laake dete hain."
Connect it to what they told you — their words, their problem.

DETAILS TO CAPTURE (one at a time, each as its own clear question):
${capture.map((c, i) => `${i + 1}) ${c}`).join("\n")}

READBACK (MANDATORY before closing):
Once details are done, confirm everything in ONE short sentence and wait for "yes" — perfect notes, every time.

CLOSE:
"Thank you sir — main abhi aapke WhatsApp pe simple loan application bhej rahi hoon, fill kar dijiyega. Hamare loan officer personally call karke final rate batayenge."
Then send the form and end the call warmly.

HARD RULES (never break):
- No OTP, PIN, card number or payment questions. Ever.
- Never guarantee approval — "very good chances" at most.
- Never invent rates or figures — only what the knowledge context gives.
- 2 clear NOs → respect it, offer the WhatsApp details, leave a good impression.`
  }

  return `CAMPAIGN BRIEF — ${product} outreach (Right Agent Group, Hyderabad)
${audience ? `AUDIENCE: ${audience}. ` : ""}${toneLine(input.tone)}

OPENING (use the customer's data — never interrogate):
"Hello {name}! This is Priya from Right Agent Group, Hyderabad."
Reference WHY you are calling right now: ${offer}.
CUSTOMER DATA ON FILE: {product_interest}${buildLeadBriefHintEnglish()} — use it naturally, NEVER re-ask what you already know.

DISCOVERY (ONE question, then listen):
Ask about their current ${product} situation — "Are you running a loan with any bank right now, or planning something new?"

PITCH (pain-relief, not features):
Explain ${offer} in ONE breath: "We work with 20+ banks — you don't run bank to bank, we bring the best offer to you."
Connect it to what they told you — their words, their problem.

DETAILS TO CAPTURE (one at a time, each as its own clear question):
${capture.map((c, i) => `${i + 1}) ${c}`).join("\n")}

READBACK (MANDATORY before closing):
Once details are done, confirm everything in ONE short sentence and wait for "yes" — perfect notes, every time.

CLOSE:
"Thank you! I'm sending a simple loan application on your WhatsApp right now — our loan officer will personally confirm the final details with you."
Then send the form and end the call warmly.

HARD RULES (never break):
- No OTP, PIN, card number or payment questions. Ever.
- Never guarantee approval — "very good chances" at most.
- Never invent rates or figures — only what the knowledge context gives.
- 2 clear NOs → respect it, offer the WhatsApp details, leave a good impression.`
}

function buildLeadBriefHintTelugu(): string {
  return " + CSV extra columns (kind: 'City: Hyderabad · Budget: 40 lakhs' laantivi) "
}
function buildLeadBriefHintHindi(): string {
  return " + CSV ke extra columns (jaise 'City: Hyderabad · Budget: 40 lakhs') "
}
function buildLeadBriefHintEnglish(): string {
  return " + the CSV's extra columns (like 'City: Hyderabad · Budget: 40 lakhs') "
}

// ---------- Studio preview sample ----------

/** A realistic Hyderabad sample lead so the Studio preview feels real. */
export const SAMPLE_CUSTOM: Record<string, string> = {
  city: "Kukatpally, Hyderabad",
  budget: "40 lakhs",
  campaign: "Sankranti Offer",
}

export function sampleVars(custom: Record<string, string> = SAMPLE_CUSTOM): FieldVars {
  return buildFieldVars(
    {
      name: "Suresh",
      phone: "+919876543210",
      language: "telugu",
      product_interest: "Home Loan",
      loan_amount: 4000000,
      status: "new",
      source: "CSV Upload",
      notes: "Asked about balance transfer last month",
    },
    custom
  )
}
