// Knowledge-base compliance rules — the SCRIPT's strict rules, made
// machine-checkable so every KB entry Priya can be grounded with is
// guaranteed to follow them (lib/default-scripts.ts HARD RULES + the
// "ANSWER QUESTIONS YOURSELF" contract).
//
// Why this exists: the script anchors Priya's factual answers to the
// knowledge context ("NEVER invent rates or figures not given in your
// knowledge context", "Never invent a separate complaint email or phone
// number", "NEVER guarantee approval"). The KB is therefore the SOURCE OF
// TRUTH for everything she says — which means a single bad KB entry (a
// guaranteed-approval claim, a made-up phone number, a wrong office
// address) silently becomes a compliance violation on a live call. These
// checks run at EVERY ingest point (manual entry, CSV, PDF, URL) so the
// KB can never teach Priya to break the script.
//
// Pure module — NO imports (same convention as lib/dialer-logic.ts) so
// test suites and the seed script can tsc-compile this exact file and
// exercise it directly with no DB, no mocks, no runtime deps.

// ── Canonical company facts ────────────────────────────────────────────
// Single source of truth for "who we are" inside KB content. Values from
// the operator's curated KB (kb-right-agent-group.csv "Office address and
// contact details") — identical to the script's fraud/complaint lines.
export const KB_CANON = {
  company: "LS Right Agent Services (OPC) Private Limited",
  city: "Hyderabad",
  pincode: "500043",
  phoneLast10: ["8333997227", "8333993223"] as string[], // call + WhatsApp
  email: "info@rightagentgroup.com",
  website: "rightagentgroup.com",
  // Any address/office mention should contain at least one of these tokens
  addressTokens: ["gandimaisamma", "mallikarjuna", "500043", "hyderabad"],
}

// Retrieval clip length — lib/knowledge-base.ts MAX_SNIPPET. An entry
// longer than this is cut mid-fact at call time, and a cut-off rate table
// is exactly how the model ends up inventing the missing half. Keep every
// entry at or under this length (warning, not a block — the operator may
// accept a long policy text).
export const KB_MAX_SNIPPET = 800

export type KbEntryLike = { title?: unknown; content?: unknown; category?: unknown }

export type KbViolation = {
  index: number
  title: string
  rule: string
  message: string
}

export type KbValidation = {
  violations: KbViolation[] // hard blocks — the entry must NOT enter the KB
  warnings: KbViolation[] // soft — shown to the operator, entry is accepted
  ok: boolean
}

// Sentence-level negation guard: the KB's own fraud-safety entries say
// "we NEVER ask for OTP" / "we never guarantee approval" — those MUST stay
// allowed. Only an un-negated guarantee/solicitation is a violation.
const NEGATION_RE = /\b(?:never|do\s+not|don'?t|don[’']t|no\s+(?:one|agent|staff|employee)|won'?t|cannot|can'?t|refuse\s+to)\b/i

function isNegatedAt(text: string, index: number): boolean {
  const start = Math.max(
    0,
    text.lastIndexOf(".", index - 1) + 1,
    text.lastIndexOf("!", index - 1) + 1,
    text.lastIndexOf("?", index - 1) + 1
  )
  const ends = [text.indexOf(".", index), text.indexOf("!", index), text.indexOf("?", index)].filter((n) => n !== -1)
  const end = ends.length > 0 ? Math.min(...ends) : text.length
  return NEGATION_RE.test(text.slice(start, end))
}

// ── Rule 1 — approval guarantees (script: "NEVER guarantee approval") ──
// Loan-approval guarantees in ANY of the languages Priya speaks.
// Deliberately narrow: "Money Back" insurance product names and "returns
// up to X%" phrasing (both present in the operator's legit KB) must NOT trip it.
const GUARANTEE_PATTERNS: RegExp[] = [
  /\bguarant/i, // guarantee / guaranteed / guaranteeing — in a loan KB this is only ever an approval promise
  /\b(?:assured|sure[- ]?shot|definitely|hundred(?:\s*%)?|100\s*%?)(?:[^.]{0,80}?)(?:approv|sanction|disburs|eligib|loan\s+will\s+be\s+given)/i,
  /\b(?:approv|sanction|loan)(?:[^.]{0,80}?)(?:assured|sure[- ]?shot|100\s*%|is\s+certain|for\s+sure|pakka)/i,
  /\bpakka\s+(?:approval|sanction|loan|eligible)/i, // Tenglish
  /\bapproval\s+pakka/i, // Tenglish reversed
  /\b(?:no\s+rejection|everyone\s+(?:gets|will\s+get)|all\s+loans\s+are\s+approved)/i,
]

// ── Rule 2 — sensitive-data solicitation & payment demands
// (script: "NEVER ask for OTP, PIN, card number, or any payment. NEVER.")
// Targets SOLICITATION ("share your OTP", "pay ₹5000 now"), NOT safety
// warnings — the canonical fraud-safety entry says "we never ask for OTP",
// which must stay allowed.
const SOLICIT_PATTERNS: RegExp[] = [
  /(?:ask|asks|asking|share|shares|sharing|send|send\s+us|collect|collects|enter|provide|give|tell\s+us|confirm)\s+(?:us\s+|me\s+|your\s+|for\s+(?:your\s+|the\s+))?[^.]{0,30}\b(?:otp|pin|cvv|card\s*(?:number|no|details)|password|upi\s*pin|net\s*banking\s*(?:password|id))/i,
  /(?:otp|pin|cvv|password)[^.]{0,40}\b(?:ask|share|send|enter|confirm)\b/i,
  // Payment demands: "pay/transfer/deposit … right now / on call / to this number / to a personal account"
  // ("send" alone is legitimate — "send details on WhatsApp" — so only
  // "send money/payment/cash/amount" counts as a payment demand)
  /\b(?:pay|transfer|deposit|send\s+(?:money|payment|cash|amount))\s+(?:[^.]{0,60}?)(?:right\s+now|\bnow\b|immediately|on\s+the\s+spot|on\s+(?:this\s+)?call|to\s+(?:this|the\s+following|my|our|a\s+personal)\s+(?:number|account|upi)|to\s+a\s+personal\s+account)/i,
  /\b(?:pay|transfer|deposit|send)\s+(?:rs\.?|₹|inr)\s*\d/i,
  // A UPI handle in KB content is never legitimate (vpamrupees@ybl etc.)
  /\b[a-z0-9._-]+@(?:ok[a-z]+|paytm|ybl|upi|apl|ibl|axl)\b/i,
]

// ── Rule 3 — contact coordinates (script: "Never invent a separate
// complaint email or phone number") — every phone/email in KB content must
// be one of the canonical ones.

/** Extract every phone-number candidate, normalized to last-10 digits. */
export function extractPhones(text: string): string[] {
  const out: string[] = []
  // \+91 83339 97227 / +91-8333997227 / 08333997227 / +91 8333997227
  const re = /(?:\+?91[\s-]?)?(?:0)?\d{4}[\s-]?\d{3}[\s-]?\d{3}\b/g
  for (const m of text.matchAll(re)) {
    const digits = m[0].replace(/\D/g, "")
    if (digits.length >= 10) out.push(digits.slice(-10))
  }
  return out
}

/** Extract every email address (lowercased). */
export function extractEmails(text: string): string[] {
  return (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase())
}

// ── Rule 4 — address drift — a 6-digit pincode other than the office
// pincode means a different address is being taught as ours.
const PINCODE_RE = /\b\d{6}\b/g

/** Title normalizer used for dedupe/upsert matching (seed + tests). */
export function normalizeKbTitle(title: string): string {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export type ExistingKbRow = { id?: string | number; title: string; content: string; category?: string | null }
export type IncomingKbRow = { title: string; content: string; category?: string | null }

export type KbDiffPlan = {
  inserts: IncomingKbRow[]
  updates: { id: string | number; title: string; content: string; category?: string | null }[]
  unchanged: number
}

/**
 * Pure upsert plan: match incoming rows to existing rows by normalized
 * title; update when content or category actually changed; insert when
 * missing; never propose deletes (the KB may contain operator entries the
 * seed knows nothing about — those are left untouched).
 */
export function diffKbPlan(existing: ExistingKbRow[], incoming: IncomingKbRow[]): KbDiffPlan {
  const byKey = new Map<string, ExistingKbRow>()
  for (const row of existing) {
    const k = normalizeKbTitle(row.title)
    if (k) byKey.set(k, row)
  }
  const plan: KbDiffPlan = { inserts: [], updates: [], unchanged: 0 }
  for (const row of incoming) {
    const k = normalizeKbTitle(row.title)
    if (!k) continue
    const hit = byKey.get(k)
    if (!hit) {
      plan.inserts.push(row)
      continue
    }
    const contentChanged = (hit.content || "").trim() !== (row.content || "").trim()
    const catChanged = (hit.category ?? null) !== (row.category ?? null)
    if (contentChanged || catChanged) {
      plan.updates.push({ id: hit.id as string | number, title: row.title, content: row.content, category: row.category ?? null })
    } else {
      plan.unchanged++
    }
  }
  return plan
}

/** Validate ONE entry → violations + warnings for that entry. */
function validateEntry(
  index: number,
  title: string,
  content: string,
  contactAsWarning: boolean
): { violations: KbViolation[]; warnings: KbViolation[] } {
  const violations: KbViolation[] = []
  const warnings: KbViolation[] = []
  const label = title || `(entry #${index + 1})`
  const push = (bucket: KbViolation[], rule: string, message: string) =>
    bucket.push({ index, title: label, rule, message })

  // R0 — basic sanity
  if (!title || !title.trim()) push(violations, "missing-title", "Entry has no title")
  if (!content || !content.trim()) push(violations, "missing-content", "Entry has no content")

  const hay = `${title}\n${content}`

  // R1 — approval guarantees (negated sentences like "we never guarantee
  // approval" are the compliant phrasing and stay allowed)
  for (const re of GUARANTEE_PATTERNS) {
    const m = hay.match(re)
    if (m && !isNegatedAt(hay, m.index ?? 0)) {
      push(
        violations,
        "approval-guarantee",
        `Script HARD RULE: never guarantee approval — found "${m[0]}". Rephrase ("very good chances" at most).`
      )
      break
    }
  }

  // R2 — sensitive-data solicitation / payment demands ("we never ask for
  // OTP" safety warnings are negated and stay allowed)
  for (const re of SOLICIT_PATTERNS) {
    const m = hay.match(re)
    if (m && !isNegatedAt(hay, m.index ?? 0)) {
      push(
        violations,
        "sensitive-solicitation",
        `Script HARD RULE: never ask for OTP/PIN/card/payment — found "${m[0]}". Safety warnings phrased as "we never ask" are fine; solicitation is not.`
      )
      break
    }
  }

  // R3 — non-canonical contact coordinates. On operator-authored entries
  // (manual / CSV) these are HARD blocks — the script explicitly forbids
  // inventing a complaint phone/email. On third-party imports (PDF / URL)
  // they downgrade to warnings: a bank's rate page legitimately carries the
  // bank's own helpline numbers, and blocking every fetch would kill the
  // feature while adding no safety (guarantee/OTP blocks still apply).
  const contactBucket = contactAsWarning ? warnings : violations
  const canonPhones = new Set(KB_CANON.phoneLast10.map((p) => p.replace(/\D/g, "").slice(-10)))
  for (const p of extractPhones(hay)) {
    if (!canonPhones.has(p)) {
      push(
        contactBucket,
        "foreign-phone",
        `Script HARD RULE: never invent a phone number — "${p}" is not a Right Agent Group number. Allowed: ${[...canonPhones].join(", ")}.`
      )
      break
    }
  }
  const canonEmail = KB_CANON.email.toLowerCase()
  for (const e of extractEmails(hay)) {
    if (e !== canonEmail) {
      push(
        contactBucket,
        "foreign-email",
        `Script HARD RULE: never invent an email — "${e}" is not the company email. Allowed: ${KB_CANON.email}.`
      )
      break
    }
  }

  // R4 — address drift (a pincode that isn't ours)
  for (const m of hay.matchAll(PINCODE_RE)) {
    if (m[0] !== KB_CANON.pincode) {
      push(
        contactBucket,
        "address-drift",
        `Pincode "${m[0]}" is not the office pincode (${KB_CANON.pincode}) — KB entries must carry the real office address only.`
      )
      break
    }
  }
  // Office/address talk with zero canonical anchor → likely a made-up location.
  // Trigger words are deliberately specific: "no office visits are needed" is
  // not an address claim, and "Address proof / address and income proof" are
  // DOCUMENT types (they appear in the documents-required entry), not claims
  // about where we are.
  if (
    /\b(?:(?:our\s+office|the\s+office|office\s+(?:address|location|is\s+(?:at|in|on|located))|visit\s+us|our\s+branch|head\s+office|branch\s+address)|address(?!\s*(?:proof|and|&)))/i.test(hay) &&
    !KB_CANON.addressTokens.some((t) => hay.toLowerCase().includes(t))
  ) {
    push(
      warnings,
      "address-unanchored",
      `Entry mentions office/address without any canonical detail (${KB_CANON.addressTokens.join(" / ")}) — confirm the location is real.`
    )
  }

  // R5 — over-length entry (retrieval clips at KB_MAX_SNIPPET → cut-off facts get invented)
  if ((content || "").length > KB_MAX_SNIPPET) {
    push(
      warnings,
      "over-length",
      `Content is ${content.length} chars; retrieval clips at ${KB_MAX_SNIPPET} — shorten it or Priya may invent the cut-off part.`
    )
  }

  return { violations, warnings }
}

/**
 * Validate a batch of KB entries against the script's strict rules.
 * Returns every violation (block) and warning (accept-with-notice) so the
 * caller can reject/flag with exact, human-readable reasons.
 *
 * opts.contactAsWarning — downgrade contact-coordinate blocks (foreign
 * phone/email/pincode) to warnings. Used by third-party content imports
 * (PDF / URL); operator-authored entries (manual / CSV) stay strict.
 */
export function validateKbEntries(
  entries: KbEntryLike[],
  opts?: { contactAsWarning?: boolean }
): KbValidation {
  const contactAsWarning = opts?.contactAsWarning === true
  const violations: KbViolation[] = []
  const warnings: KbViolation[] = []
  entries.forEach((e, i) => {
    const title = typeof e.title === "string" ? e.title : ""
    const content = typeof e.content === "string" ? e.content : ""
    const r = validateEntry(i, title, content, contactAsWarning)
    violations.push(...r.violations)
    warnings.push(...r.warnings)
  })
  return { violations, warnings, ok: violations.length === 0 }
}
