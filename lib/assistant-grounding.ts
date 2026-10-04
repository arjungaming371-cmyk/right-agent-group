/**
 * ASSISTANT ACCURACY GUARDRAIL (2026-10-04)
 * ==========================================
 * Owner directive: the Operations Commander must give ONLY correct answers —
 * never assumed or invented figures. Three mechanisms live here:
 *
 *   1. ACCURACY_RULES        — a prompt block that forbids guessing, model
 *                              arithmetic and invented entities, and tells the
 *                              model every figure is mechanically checked.
 *   2. checkReplyGrounded()  — a deterministic post-generation validator.
 *                              Every number in the draft reply is traced back
 *                              to the VERIFIED corpus (live snapshot + search
 *                              results + code-computed financial math + the
 *                              user's own message/history). Any figure that
 *                              cannot be traced fails the whole reply, and the
 *                              route replaces it with UNVERIFIED_REPLY_FALLBACK
 *                              instead of delivering a possibly-wrong answer.
 *   3. VERIFIED_BADGE        — prepended by the route when a numeric reply
 *                              passes, so staff can see the answer was checked.
 *
 * This extends the guarantee lib/finance.ts already provides for financial
 * math (Priya and the console never quote model-guessed rupees) to every
 * number the Commander outputs.
 *
 * Matching rules (kept intentionally strict — false failures are safe because
 * the fallback explains how to rephrase, while false passes would be wrong
 * answers reaching staff):
 * - Numbers are compared after normalizing: commas/currency symbols/leading
 *   "+" removed, trailing decimal zeros trimmed, leading zeros optional.
 * - Indian magnitude words are expanded on BOTH sides ("5 lakh" ≡ 500000,
 *   "2.5 crore" ≡ 25000000, "10k"/"10 thousand" ≡ 10000).
 * - Digit groups separated by single spaces are also tried joined (pairs and
 *   triples), so a phone written "+91 98765 43210" or "98765 43210" matches
 *   the stored "+919876543210".
 * - Any number of ≥10 digits passes if it is contained in a ≥10-digit
 *   corpus number (country-code variants of the same phone).
 * - Small integers (0-31: days of month, short lists, times) and years
 *   (1900-2100) are tolerated ONLY when not prefixed by a currency marker
 *   (₹ $ Rs INR) — a currency-attached figure must always be traced.
 * - Replies containing an action:proposal block skip the numeric gate: that
 *   content is a CREATIVE DRAFT (script / KB article) whose numbers are
 *   examples, and it is gated by the admin Approve & Execute review.
 */

export const VERIFIED_BADGE = "✅ Figures verified against live dashboard data."

export const UNVERIFIED_REPLY_FALLBACK = `⚠️ **Accuracy guardrail — reply withheld.**

I drafted an answer, but at least one figure in it could not be verified against the live dashboard data, so I withheld the whole reply rather than risk giving you a wrong number.

I only state figures that come directly from:
- The live dashboard snapshot — leads, loan applications, voice calls, WhatsApp, escalations, security, team
- Record searches — ask about a specific customer by name or phone number
- Financial math computed by code — EMI, eligibility, prepayment and rate quotes
- Figures you provided in your own message or attachment

Please rephrase your question — for example, name the specific customer, or ask for the exact totals — and I will answer strictly from verified data.`

export const ACCURACY_RULES = `=====================================================
ACCURACY & GROUNDING RULES — HIGHEST PRIORITY, READ BEFORE ANSWERING:
=====================================================
Staff make real business decisions from your answers. A wrong figure is worse than no answer. Every figure you output is mechanically verified against the verified data below before your reply is delivered — if any figure cannot be traced to that data, the ENTIRE reply is discarded and replaced with an accuracy notice. There is no partial credit: correctness beats completeness.

1. VERIFIED FIGURES ONLY: Every number, amount, count, date, status, name, phone number and score you state MUST come from the LIVE DATA SNAPSHOT, the SEARCH RESULTS, the FINANCIAL MATH block, the attached document content, or this conversation. Copy figures EXACTLY as they appear — never round, convert, reformat or recall them from memory.
2. ZERO ARITHMETIC BY YOU: Never add, subtract, average, multiply or divide numbers yourself — this includes percentages, ratios, growth rates, conversion rates, differences and totals that are not already printed in the data. If the pre-computed figure is not in the context, say it is not available.
3. NO GUESSING, NO GAP-FILLING: If the verified data does not contain the answer, say so plainly: "I don't have verified data for that in the dashboard right now." Then, if possible, share the closest verified facts you DO have. An honest "I don't have it" is always the correct answer.
4. NO INVENTED ENTITIES: Never invent or infer lead names, customer names, phone numbers, loan applications, amounts, dates or statuses that are not in the verified data.
5. TOTALS vs SAMPLES: The snapshot shows exact TOTAL counts plus only the most recent individual records. Present totals as totals, and describe individual records as "most recent" — never as the complete list.
6. GENERAL KNOWLEDGE STAYS QUALITATIVE: For guidance and recommendations, do not attach specific market figures, rates or statistics that are not in the verified context — refer staff to the official rate card, lender guidelines or the Knowledge Base instead. Financial figures you quote come from the pre-computed FINANCIAL MATH block only.
7. DRAFTS & PROPOSALS: When drafting scripts or Knowledge Base articles, use only figures from the verified data; leave clearly marked placeholders for anything unverified.`

// ────────────────────────── internals ──────────────────────────

const TOKEN_RE = /\+?\d[\d,]*(?:\.\d+)?/g

/** Expand Indian magnitude words so "5 lakh" and 500000 compare equal. */
export function expandMagnitudes(text: string): string {
  return text
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*(?:lakhs?|lacs?)\b/gi,
      (_, n: string) => String(Math.round(Number(n.replace(/,/g, "")) * 100000)))
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*(?:crores?|cr)\b/gi,
      (_, n: string) => String(Math.round(Number(n.replace(/,/g, "")) * 10000000)))
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*(?:thousands?|k)\b/gi,
      (_, n: string) => String(Math.round(Number(n.replace(/,/g, "")) * 1000)))
}

function canonNum(raw: string): string {
  let s = raw.replace(/\+/g, "").replace(/,/g, "")
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "")
    if (!s) s = "0"
  }
  return s
}

function stripLeadingZeros(s: string): string {
  return s.replace(/^0+(?=\d)/, "")
}

function isCurrencyPrefixed(text: string, idx: number): boolean {
  if (idx === 0) return false
  const prev = text[idx - 1]
  if (prev === "₹" || prev === "$") return true
  if (text.slice(Math.max(0, idx - 3), idx) === "Rs ") return true
  if (text.slice(Math.max(0, idx - 3), idx) === "Rs.") return true
  if (text.slice(Math.max(0, idx - 4), idx) === "INR ") return true
  return false
}

type NumToken = { canon: string; start: number; end: number; currency: boolean }

function extractTokens(expanded: string): NumToken[] {
  const out: NumToken[] = []
  for (const m of expanded.matchAll(TOKEN_RE)) {
    const raw = m[0]
    const start = m.index ?? 0
    out.push({
      canon: canonNum(raw),
      start,
      end: start + raw.length,
      currency: isCurrencyPrefixed(expanded, start),
    })
  }
  return out
}

/** Two tokens are one logical number if separated by exactly one space. */
function adjacent(text: string, a: NumToken, b: NumToken): boolean {
  return a.end < b.start && text.slice(a.end, b.start) === " "
}

/** Small ints (day-of-month / short counts / clock parts) and years. */
function isBenign(canon: string): boolean {
  if (!/^\d+$/.test(canon)) return false
  const v = Number(canon)
  if (!Number.isFinite(v)) return false
  return (v >= 0 && v <= 31) || (v >= 1900 && v <= 2100)
}

// ────────────────────────── public API ──────────────────────────

export type GroundingCorpus = { allowed: Set<string>; longs: string[] }

/**
 * Build the set of verified numbers from the grounding sources. Everything a
 * reply may legitimately quote must be in here: live snapshot, search
 * results, code-computed financial math, the user's message (incl. attachment
 * content) and prior conversation turns.
 */
export function buildAllowedCorpus(parts: (string | null | undefined)[]): GroundingCorpus {
  const allowed = new Set<string>()
  const longs: string[] = []
  const add = (c: string) => {
    if (!c) return
    allowed.add(c)
    allowed.add(stripLeadingZeros(c))
    if (c.replace(/\D/g, "").length >= 10) longs.push(c)
  }
  for (const part of parts) {
    if (!part) continue
    const expanded = expandMagnitudes(part)
    const tokens = extractTokens(expanded)
    for (const tok of tokens) add(tok.canon)
    // Space-separated digit groups (phone formatting variants) also become
    // verifiable as joined values, on both corpus and reply sides.
    for (let i = 0; i + 1 < tokens.length; i++) {
      if (adjacent(expanded, tokens[i], tokens[i + 1])) {
        add(canonNum(tokens[i].canon + tokens[i + 1].canon))
        if (i + 2 < tokens.length && adjacent(expanded, tokens[i + 1], tokens[i + 2])) {
          add(canonNum(tokens[i].canon + tokens[i + 1].canon + tokens[i + 2].canon))
        }
      }
    }
  }
  return { allowed, longs }
}

export type GroundingVerdict = { grounded: boolean; unverified: string[] }

/**
 * Trace every number in the draft reply back to the verified corpus.
 * grounded=false means at least one figure could not be traced — the caller
 * must NOT deliver the reply.
 */
export function checkReplyGrounded(reply: string, corpus: GroundingCorpus): GroundingVerdict {
  const expanded = expandMagnitudes(reply)
  const tokens = extractTokens(expanded)
  const match = (c: string) => corpus.allowed.has(c) || corpus.allowed.has(stripLeadingZeros(c))
  // A joined value passes either literally or as a country-code variant of a
  // verified ≥10-digit number (phone written with/without the +91 prefix).
  const joinOk = (joined: string) =>
    match(joined) ||
    (joined.length >= 10 && corpus.longs.some((l) => l.includes(joined) || joined.includes(l)))
  const unverified: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    const c = tok.canon
    if (match(c)) continue
    const prevOk = i > 0 && adjacent(expanded, tokens[i - 1], tok)
    const nextOk = i + 1 < tokens.length && adjacent(expanded, tok, tokens[i + 1])
    const fwdTriple = nextOk && i + 2 < tokens.length && adjacent(expanded, tokens[i + 1], tokens[i + 2])
    const backTriple = prevOk && i > 1 && adjacent(expanded, tokens[i - 2], tokens[i - 1])
    // joined variants with space-adjacent neighbor(s): "98765 43210",
    // "+91 98765 43210"
    if (prevOk && joinOk(canonNum(tokens[i - 1].canon + c))) continue
    if (nextOk && joinOk(canonNum(c + tokens[i + 1].canon))) continue
    if (prevOk && nextOk && joinOk(canonNum(tokens[i - 1].canon + c + tokens[i + 1].canon))) continue
    if (fwdTriple && joinOk(canonNum(c + tokens[i + 1].canon + tokens[i + 2].canon))) continue
    if (backTriple && joinOk(canonNum(tokens[i - 2].canon + tokens[i - 1].canon + c))) continue
    // phone variants of the bare token itself
    if (c.length >= 10 && corpus.longs.some((l) => l.includes(c) || c.includes(l))) continue
    // small ints / years are tolerated unless they wear a currency marker
    if (!tok.currency && isBenign(c)) continue
    unverified.push(tok.canon)
  }
  return { grounded: unverified.length === 0, unverified: [...new Set(unverified)] }
}

/**
 * True when the reply carries at least one figure significant enough to be
 * worth the verification badge (a currency amount or a non-trivial count).
 */
export function hasSignificantFigures(reply: string): boolean {
  for (const tok of extractTokens(expandMagnitudes(reply))) {
    if (tok.currency) return true
    if (!isBenign(tok.canon)) return true
  }
  return false
}
