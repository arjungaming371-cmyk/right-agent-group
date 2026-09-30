// In-call determinism layer for the LIVE VOICE path — pure functions, zero
// imports (same convention as lib/dialer-logic.ts: shared by the turn API,
// lib/voice-conversation.ts and the test suite without pulling runtime
// dependencies).
//
// Three problems this module solves, all observed on live calls:
//
// 1. RE-ASKING ANSWERED QUESTIONS. lead_memory is only written AFTER the call
//    (post-call analysis), and the model's live window holds the last 12
//    messages — so on a longer call, facts given early (name at turn 2) fell
//    out of the window and Priya re-asked them like a goldfish. This module
//    deterministically scans the FULL retained transcript every turn and
//    re-surfaces what the customer already answered — zero LLM cost, zero
//    added latency.
//
// 2. MID-CALL LANGUAGE FLIPS. The old switch rule flipped the whole call (and
//    the TTS voice) to English on any 3+ word Roman-letter utterance — a
//    Tenglish answer like "naa peru Suresh" has no keyword hit, so a single
//    short reply switched Priya to a different voice mid-sentence, and the
//    wrong language was PERMANENTLY saved to the lead (poisoning the next
//    call's greeting too). resolveSpokenLanguage now only switches on strong
//    evidence, and reports whether the switch was EXPLICIT (customer asked
//    for a language) so only explicit switches persist to the lead.
//
// 3. Detection of already-collected facts is Q→A AWARE: when Priya asked for
//    the name/area/WhatsApp and the next customer turn is a short answer,
//    that pairing is captured even though no self-intro phrase ("my name
//    is...") was spoken — which is how real people answer on the phone.

export type CallLanguage = "english" | "hindi" | "telugu"

/** Unknown / garbage language input falls back to the deployment default (telugu — the home market). */
export function normalizeCallLanguage(input: unknown): CallLanguage {
  return input === "hindi" || input === "telugu" || input === "english" ? input : "telugu"
}

// Explicit language REQUESTS — the customer is asking to switch, so switch
// immediately. These were already in the turn route; kept verbatim.
const TELUGU_ASK_RE = /\b(telugu|telgu|tenglish|telegu)\b|తెలుగు|telugulo|telugula/i
const HINDI_ASK_RE = /\b(hindi|hinglish|hind)\b|हिंदी|हिन्दी|hindimein|hindime/i
const ENGLISH_ASK_RE = /\b(english|eng|inglish)\b|englishlo|englishmein/i

// Roman-letter English function words — a REAL English sentence leans on
// these; Tenglish answers and STT noise mostly don't.
const ENGLISH_FUNCTION_WORD_RE =
  /\b(i|you|we|my|your|the|is|are|was|were|do|does|did|can|could|would|should|please|what|where|when|why|how|and|but|about|for|with|have|has|need|want|know|think|actually|basically|sorry|because|right now|tomorrow|today|later|evening|morning|afternoon|available|busy|free|call|calling|talk|speak)\b/gi

export type ResolvedSpokenLanguage = { language: CallLanguage; explicit: boolean }

/**
 * Mid-call language switch, tightened against false flips.
 *
 *  - Explicit request ("telugu lo matladu") → switch, explicit: true.
 *  - Native-script evidence or a romanized Telugu/Hindi keyword hit (the
 *    keyword lists inside `detect` are strong evidence) → switch, explicit: false.
 *  - English candidate → only when the utterance is ≥6 words AND leans on
 *    ≥3 distinct English function words. A 3-word Tenglish reply ("naa peru
 *    Suresh") or STT garble can no longer flip the call's voice mid-sentence.
 *  - Everything else → stay on the current language.
 */
export function resolveSpokenLanguage(
  speech: string,
  current: CallLanguage,
  detect: (text: string) => CallLanguage
): ResolvedSpokenLanguage {
  const text = speech.toLowerCase()

  if (TELUGU_ASK_RE.test(text)) return { language: "telugu", explicit: true }
  if (HINDI_ASK_RE.test(text)) return { language: "hindi", explicit: true }
  if (ENGLISH_ASK_RE.test(text)) return { language: "english", explicit: true }

  const detected = detect(speech)
  if (detected === current) return { language: current, explicit: false }
  // Native script (Telugu/Devanagari characters) or a romanized keyword hit —
  // strong evidence of the customer's actual language.
  if (detected !== "english") return { language: detected, explicit: false }

  // English candidate: require strong sentence-level evidence.
  const wordCount = speech.trim().split(/\s+/).length
  if (wordCount < 6) return { language: current, explicit: false }
  const functionWords = new Set(text.match(ENGLISH_FUNCTION_WORD_RE) || [])
  if (functionWords.size < 3) return { language: current, explicit: false }
  return { language: "english", explicit: false }
}

// ---------------------------------------------------------------------------
// In-call fact extraction
// ---------------------------------------------------------------------------

export type InCallFacts = {
  name?: string
  area?: string
  loanAmount?: string
  loanType?: string
  whatsappSame?: boolean
}

type Turn = { role: "user" | "model"; content: string }

// Priya's collection questions — a SHORT customer turn right after one of
// these is the ANSWER, even though it contains no self-intro phrase.
const NAME_QUESTION_RE = /(your (full |good )?name|may i know your name|mee peru|mi peru|me peru|aapka naam|aapka shubh naam)/i
const AREA_QUESTION_RE = /(which area|your area|which city|your city|where (do|are) you (live|living|from)|ekkada|e ooru|mi ooru|meeru ekkada|kondeyaru|where are you located)/i
const WHATSAPP_QUESTION_RE = /whatsapp/i

// Self-intro name patterns (customer volunteering it unprompted).
const SELF_NAME_RE =
  /\b(?:my (?:full )?name is|this is|i am|i'm|naa peru|na peru|mera naam|mera name|maa peru)\s+([a-z][a-z .`'-]{1,34}?)(?=\s*(?:[,.;!?]|$|\b(?:sir|madam|andi|garu|bro|actually|but|and|from|here|speaking)\b))/i
const SELF_AREA_RE =
  /\b(?:i (?:live|am staying|am|stay) in|i am from|i'm from|im from|we live in|my area is|my city is|my location is|naadi|nadi)\s+([a-z][a-z .`'-]{1,34}?)(?=\s*(?:[,.;!?]|$|\b(?:sir|madam|andi|garu|near|but|and|so|please|area)\b))/i

// Words that make a captured "name" obviously NOT a name ("i am busy",
// "this is fraud?").
const NOT_A_NAME_RE =
  /^(busy|interested|not|ok|okay|fine|good|ready|calling|asking|looking|working|from|fraud|scam|wrong|the|a|an|my|your|what|why|how|when|where|urgent|important|first|last|correct|sure|sir|madam|unknown|government|prabhutvam)\b/i

const AREA_ANSWER_FILLER_RE = /\b(sir|madam|andi|garu|bro|na|naa|mera|my|is|am|in|the|i am|its|it's|lo|owa|ey)\b/gi
const NAME_ANSWER_FILLER_RE = /\b(sir|madam|andi|garu|bro|naa|na|madi|my|name|is|the|its|it's|ey|jii|ji)\b/gi

// Loan amounts — only counted inside a sentence that also carries loan intent,
// so "salary 40 thousand" is never mistaken for the loan need.
const LOAN_INTENT_RE = /\b(loan|loans|finance|amount|kavali|kaavali|kavala|chahiye|cahiye|sell|selling|illu|house|home|flat|plot|business|education|study|gold|bike|car|vehicle|property|construct|construction|renovat)/i
const LOAN_AMOUNT_RE = /\b(\d{1,3}(?:\.\d{1,2})?)\s*(lakh|lakhs|lakulu|crore|crores|cr|k|thousand|veelu|velu)\b/i
const LOAN_TYPE_RE = /\b(home|house|personal|business|education|study|gold|car|bike|vehicle|two ?wheeler|mortgage|lap|plot|construction)\s+loan\b|illu loan|intiki loan/i

const YES_SAME_RE = /^(yes\s+)?(same|ide|idiye|idhe|ide ye|ide number|idhe number|same number|same sir|same madam|same a|same only|this number|same as this|same)\b/i

function cleanCapture(raw: string, fillerRe: RegExp, maxWords: number): string {
  let out = raw
    .replace(/\s+/g, " ")
    .replace(/[`'"]+$/, "")
    .trim()
  // Drop the tail filler explicitly ("ravi kumar sir" -> "ravi kumar") — the
  // lookahead handles most cases but a trailing name+title pair slips through.
  out = out.replace(/\s+(sir|madam|andi|garu|bro)$/i, "").trim()
  out = out.replace(fillerRe, " ").replace(/\s+/g, " ").trim()
  if (!out) return ""
  const words = out.split(" ")
  if (words.length > maxWords) out = words.slice(0, maxWords).join(" ")
  return out
}

/**
 * Scan the FULL retained call transcript (getHistory keeps the last 40
 * messages — the whole call for any realistic duration) plus the current
 * utterance, and collect what the customer has ALREADY answered. Customer
 * turns only — Priya's own words (scripts, examples, city mentions in the
 * pitch) must never become "facts".
 */
export function extractCallFacts(history: Turn[], speech: string): InCallFacts {
  const facts: InCallFacts = {}
  const customerTurns: string[] = history.filter((h) => h.role === "user").map((h) => String(h.content || ""))
  if (speech && speech.trim()) customerTurns.push(speech)

  // Ordered turn list for Q→A pairing.
  const turns: Turn[] = [...history, ...(speech ? [{ role: "user" as const, content: speech }] : [])]

  for (const text of customerTurns) {
    const t = (text || "").trim()
    if (!t) continue
    const sentenceHasQ = t.includes("?")

    // NAME — self-intro phrases (skip interrogative "this is fraud?" forms).
    if (!facts.name) {
      const m = t.match(SELF_NAME_RE)
      if (m && !sentenceHasQ) {
        const candidate = cleanCapture(m[1], NAME_ANSWER_FILLER_RE, 3)
        if (candidate && !NOT_A_NAME_RE.test(candidate) && candidate.length >= 2) facts.name = candidate
      }
    }

    // AREA — self-intro phrases.
    if (!facts.area) {
      const m = t.match(SELF_AREA_RE)
      if (m && !sentenceHasQ) {
        const candidate = cleanCapture(m[1], AREA_ANSWER_FILLER_RE, 3)
        if (candidate && !NOT_A_NAME_RE.test(candidate) && candidate.length >= 2) facts.area = candidate
      }
    }

    // LOAN TYPE.
    if (!facts.loanType) {
      const m = t.match(LOAN_TYPE_RE)
      if (m) {
        const raw = m[0].toLowerCase()
        facts.loanType =
          /illu loan|intiki loan/.test(raw) ? "home loan"
          : /two ?wheeler/.test(raw) ? "bike loan"
          : /lap\b/.test(raw) ? "loan against property"
          : raw.replace(/\s+/g, " ").trim()
      }
    }

    // LOAN AMOUNT — only from a sentence carrying loan intent.
    if (!facts.loanAmount) {
      for (const sentence of t.split(/[.!?;\n]+/)) {
        if (!LOAN_INTENT_RE.test(sentence)) continue
        const m = sentence.match(LOAN_AMOUNT_RE)
        if (m) {
          const num = m[1]
          const unitRaw = m[2].toLowerCase()
          const unit =
            unitRaw === "veelu" || unitRaw === "velu" ? "thousand"
            : unitRaw === "cr" || unitRaw === "crore" || unitRaw === "crores" ? "crore"
            : unitRaw === "lakulu" ? "lakhs"
            : unitRaw
          facts.loanAmount = `${num} ${unit}`
          break
        }
      }
    }
  }

  // Q→A pairing: a short customer turn immediately after Priya asked the
  // matching question IS the answer — the most common answer shape on a real
  // phone call, and invisible to phrase-based regexes.
  const isShortAnswer = (s: string) => {
    const words = s.trim().split(/\s+/)
    return words.length >= 1 && words.length <= 5
  }
  for (let i = 0; i < turns.length - 1; i++) {
    const q = turns[i]
    const a = turns[i + 1]
    if (q.role !== "model" || a.role !== "user") continue
    const answer = (a.content || "").trim()
    if (!answer || !isShortAnswer(answer)) continue

    if (!facts.name && NAME_QUESTION_RE.test(q.content || "")) {
      const candidate = cleanCapture(answer, NAME_ANSWER_FILLER_RE, 3)
      if (candidate && candidate.length >= 2 && !NOT_A_NAME_RE.test(candidate) && !/^\d+$/.test(candidate)) {
        facts.name = candidate
      }
    }
    if (!facts.area && AREA_QUESTION_RE.test(q.content || "")) {
      const candidate = cleanCapture(answer, AREA_ANSWER_FILLER_RE, 4)
      if (candidate && candidate.length >= 2 && !NOT_A_NAME_RE.test(candidate) && !/^(ledu|ledu|no|dont know|don't know|teleedu|teliyadu)$/i.test(candidate)) {
        facts.area = candidate
      }
    }
    if (!facts.whatsappSame && WHATSAPP_QUESTION_RE.test(q.content || "") && YES_SAME_RE.test(answer)) {
      facts.whatsappSame = true
    }
  }

  return facts
}

/**
 * The per-turn injected block for the facts above. Empty string when nothing
 * was collected yet — the block must not dilute the prompt when there is
 * nothing to enforce.
 */
export function formatInCallFactsBlock(facts: InCallFacts): string {
  const lines: string[] = []
  if (facts.name) lines.push(`- name: ${facts.name}`)
  if (facts.area) lines.push(`- city/area: ${facts.area}`)
  if (facts.loanAmount || facts.loanType) {
    lines.push(`- loan: ${[facts.loanAmount, facts.loanType].filter(Boolean).join(", ")}`)
  }
  if (facts.whatsappSame) lines.push("- whatsapp number: customer confirmed it is the SAME as this call")
  if (lines.length === 0) return ""
  return [
    "=== ANSWERED ALREADY IN THIS CALL (customer's own words — every item here is DONE) ===",
    "NEVER ask for any item below again — not even as a confirmation question. Use them naturally and move to the NEXT unknown GOAL step.",
    ...lines,
  ].join("\n")
}
