// Real arithmetic for anything money-related that Priya (or the dashboard)
// says out loud to a customer. An LLM asked to "compute" an EMI will
// confidently produce a WRONG number — this file is the one place actual
// math happens, so every quoted figure is exact, not a model's guess.

/** Standard reducing-balance EMI formula. */
export function calculateEMI(principal: number, annualRatePct: number, tenureMonths: number): number {
  if (principal <= 0 || tenureMonths <= 0) return 0
  const r = annualRatePct / 12 / 100
  if (r === 0) return Math.round(principal / tenureMonths)
  const emi = (principal * r * Math.pow(1 + r, tenureMonths)) / (Math.pow(1 + r, tenureMonths) - 1)
  return Math.round(emi)
}

export function totalPayable(emi: number, tenureMonths: number): number {
  return emi * tenureMonths
}

export function totalInterest(principal: number, emi: number, tenureMonths: number): number {
  return Math.max(0, totalPayable(emi, tenureMonths) - principal)
}

/**
 * Rough affordability check used for "will I qualify" style questions.
 * Lenders typically cap EMI at ~50% of monthly income (FOIR). This is a
 * conservative ESTIMATE for conversation purposes only — never presented
 * as a guarantee, per the script's hard rules.
 */
export function estimateMaxEligibleLoan(monthlyIncome: number, existingEMI: number, annualRatePct: number, tenureMonths: number): number {
  const maxEmi = Math.max(0, monthlyIncome * 0.5 - existingEMI)
  if (maxEmi <= 0) return 0
  const r = annualRatePct / 12 / 100
  if (r === 0) return Math.round(maxEmi * tenureMonths)
  return Math.round((maxEmi * (Math.pow(1 + r, tenureMonths) - 1)) / (r * Math.pow(1 + r, tenureMonths)))
}

export function formatINR(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN")
}

// ---- Best-available rate lookup (from the knowledge base rate sheet) ----
// Kept in code, not re-parsed from KB text at call time — parsing free text
// for a rate mid-conversation is exactly the kind of "AI guesses a number"
// risk this file exists to avoid. Update this table when rates change.
export const LOAN_TYPE_ALIASES: Record<string, string> = {
  home: "Home Loan", "home loan": "Home Loan", housing: "Home Loan",
  personal: "Personal Loan", "personal loan": "Personal Loan",
  business: "Business Loan", "business loan": "Business Loan",
  shop: "Business Loan", kirana: "Business Loan", vyapar: "Business Loan", vyaparam: "Business Loan",
  vyapaaram: "Business Loan", "expand my shop": "Business Loan", dukaanam: "Business Loan",
  "loan against property": "Loan Against Property", lap: "Loan Against Property",
  "four wheeler": "Four Wheeler Loan", car: "Four Wheeler Loan", "car loan": "Four Wheeler Loan",
  "two wheeler": "Two Wheeler Loan", bike: "Two Wheeler Loan",
  education: "Education Loan", "education loan": "Education Loan",
}

// Real market-starting rates (India, sourced July 2026 — see below), NOT
// invented figures. These are STARTING/best-case rates from public sector
// banks and top lenders, same framing the script already uses for Home
// Loan ("starts from X%, final rate depends on profile"). Update this
// table (not the model) whenever real rates change — the AI must never be
// asked to remember or vary these numbers itself.
//
// Sources (checked July 2026):
//  - Home Loan 7.25% SBI: existing knowledge_base rate sheet
//  - Personal Loan 9.99% HDFC/ICICI (paisabazaar.com, bajajfinservmarkets.in)
//  - Business Loan 9% PSB starting rate (flexiloans.com, iifl.com — PSBs "from 9%")
//  - Loan Against Property 8.45% best-case (cleartax.in, hdbfs.com)
//  - Four Wheeler Loan 7.30% SBI new-car (creditmantri.com, bankbazaar.com)
//  - Two Wheeler Loan 7.60% best-case market low (bankbazaar.com two-wheeler survey)
//  - Education Loan 7.15% SBI (policybazaar.com) / Bank of Baroda from 6.9%
export const BEST_RATES: Record<string, { ratePct: number; maxTenureYears: number; lender: string }> = {
  "Home Loan":            { ratePct: 7.25, maxTenureYears: 30, lender: "SBI" },
  "Personal Loan":        { ratePct: 9.99, maxTenureYears: 5,  lender: "HDFC Bank / ICICI Bank" },
  "Business Loan":        { ratePct: 9.0,  maxTenureYears: 7,  lender: "public sector bank partners" },
  "Loan Against Property":{ ratePct: 8.45, maxTenureYears: 15, lender: "leading bank partners" },
  "Four Wheeler Loan":    { ratePct: 7.30, maxTenureYears: 7,  lender: "SBI" },
  "Two Wheeler Loan":     { ratePct: 7.60, maxTenureYears: 4,  lender: "leading bank partners" },
  "Education Loan":       { ratePct: 7.15, maxTenureYears: 15, lender: "SBI" },
}

/**
 * Turns a raw customer utterance ("20 lakh loan, 20 years, EMI entha?")
 * into an EXACT, code-computed answer Priya can read out — instead of the
 * LLM attempting the arithmetic itself. Returns null when the message
 * isn't actually an EMI/eligibility question, so callers only pay for this
 * when it matters.
 */
const EMI_QUESTION_RE = /\b(emi|monthly (payment|installment|kattali|kattana)|per month|nela ki|month ki)\b/i
const LAKH_CRORE_RE = /(\d+(?:\.\d+)?)\s*(lakh|lac|l\b|crore|cr\b)/i
// "50 thousand" / "50k" / Hinglish "hazaar"/"hazar" / Tenglish "vela" — a
// smaller personal-loan amount phrased this way used to fail to parse at
// all (fell through to PLAIN_AMOUNT_RE, which requires 5+ digits and
// ignores bare "50"), silently skipping the EMI/eligibility grounding and
// leaving the LLM to guess the math itself.
const THOUSAND_RE = /(\d+(?:\.\d+)?)\s*(thousand|hazaar|hazar|vela|k)\b/i
const PLAIN_AMOUNT_RE = /(?:rs\.?|₹|inr)?\s*(\d[\d,]{4,})/i
const YEARS_RE = /(\d{1,2})\s*(year|yr|years)/i

export function parseAmount(text: string): number | null {
  const lc = text.toLowerCase()
  const m = lc.match(LAKH_CRORE_RE)
  if (m) {
    const n = parseFloat(m[1])
    const unit = m[2]
    if (unit.startsWith("cr")) return Math.round(n * 1e7)
    return Math.round(n * 1e5)
  }
  const t = lc.match(THOUSAND_RE)
  if (t) {
    return Math.round(parseFloat(t[1]) * 1000)
  }
  const p = text.match(PLAIN_AMOUNT_RE)
  if (p) {
    const n = parseInt(p[1].replace(/,/g, ""), 10)
    if (n >= 10000) return n // ignore small numbers (phone digits, ages, etc.)
  }
  return null
}

export function parseTenureMonths(text: string): number | null {
  const y = text.match(YEARS_RE)
  if (y) return parseInt(y[1], 10) * 12
  return null
}

export function detectLoanType(text: string): string | null {
  const lc = text.toLowerCase()
  for (const [alias, canonical] of Object.entries(LOAN_TYPE_ALIASES)) {
    if (lc.includes(alias)) return canonical
  }
  return null
}

export type EmiAnswer = { instruction: string; principal: number; ratePct: number; tenureMonths: number; emi: number }

// ---- Eligibility ("will I qualify / how much can I get") ----
const ELIGIBILITY_QUESTION_RE = /\b(eligib|qualify|qualif|how much (loan|amount|money).*(get|qualify)|how much (can|will) i get|max(imum)? loan|entha (loan|amount) (vastundi|isthaaru|dorukutundi)|kitna loan mil|loan amount entha)\b/i
const INCOME_CONTEXT_RE = /\b(income|salary|earn|kamai|sambalam|jeetham)\b/i
const EXISTING_EMI_RE = /\b(existing emi|already paying|other loan|already (an )?emi|current emi)\b/i

export function parseIncome(text: string): number | null {
  if (!INCOME_CONTEXT_RE.test(text)) return null
  return parseAmount(text)
}

export type EligibilityAnswer = { instruction: string; monthlyIncome: number; maxLoan: number; ratePct: number; tenureMonths: number }

/**
 * Same principle as buildEmiInstruction: real code computes a maximum
 * eligible loan amount (standard 50%-of-income EMI affordability rule),
 * the AI just states it — with the mandatory "estimate, not a guarantee"
 * framing the script's hard rules require.
 */
export function buildEligibilityInstruction(
  customerMessage: string,
  fallback: { loanType?: string | null; monthlyIncome?: number | null }
): EligibilityAnswer | null {
  if (!ELIGIBILITY_QUESTION_RE.test(customerMessage)) return null

  const monthlyIncome = parseIncome(customerMessage) || fallback.monthlyIncome || null
  if (!monthlyIncome || monthlyIncome < 5000) {
    // Not enough to compute anything real — tell the AI to ASK, not guess.
    return {
      instruction:
        "ELIGIBILITY CHECK REQUESTED but their monthly income is not known yet. Your VERY NEXT reply must directly ask their approximate monthly income (e.g. \"Sure — what's your monthly income, roughly?\") BEFORE anything else. Do NOT give a loan amount range or any eligibility figure yet — you have no real number to base it on.",
      monthlyIncome: 0, maxLoan: 0, ratePct: 0, tenureMonths: 0,
    }
  }

  const loanType = detectLoanType(fallback.loanType || customerMessage) || "Home Loan"
  const rateInfo = BEST_RATES[loanType] || BEST_RATES["Home Loan"]
  const tenureMonths = rateInfo.maxTenureYears * 12
  const existingEmiMentioned = EXISTING_EMI_RE.test(customerMessage)
  const maxLoan = estimateMaxEligibleLoan(monthlyIncome, existingEmiMentioned ? monthlyIncome * 0.1 : 0, rateInfo.ratePct, tenureMonths)

  const instruction =
    `ELIGIBILITY ESTIMATE (real calculation, use this exact figure — do NOT invent your own): ` +
    `Based on a monthly income of ${formatINR(monthlyIncome)}, they could be eligible for up to approximately ${formatINR(maxLoan)} ` +
    `on a ${loanType} at ${rateInfo.ratePct}% p.a. over ${tenureMonths / 12} years (standard lenders cap the EMI at about half of monthly income). ` +
    `Always frame this as an ESTIMATE, never a guarantee — the final eligibility depends on credit score, existing loans, and lender-specific checks.`

  return { instruction, monthlyIncome, maxLoan, ratePct: rateInfo.ratePct, tenureMonths }
}

/**
 * Main entry point for the call/WhatsApp turn handlers. Give it the raw
 * customer message plus whatever the lead record already knows
 * (loan_amount, product_interest) as fallback context. Returns an
 * instruction string to inject into the AI's context ("EXACT EMI — state
 * this number, do not calculate your own") or null if no EMI math applies
 * this turn.
 */
// ---- Rate grounding ("what's the interest rate") ----
// The knowledge base only has a detailed rate SHEET for Home Loan — for
// every other product (Personal, Business, Two/Four Wheeler, Education...)
// there is no grounded text, so the model was observed inventing a
// different rate on different calls for the SAME loan type (18% then 13%
// for Business Loan). BEST_RATES is the single source of truth for every
// product; ground every rate question in it, not just EMI-shaped ones.
const RATE_QUESTION_RE = /\b(interest|rate|% ?p\.?a\.?|percent|vaddi|entha (rate|interest|vaddi)|interest entha)\b/i

export function buildRateInstruction(customerMessage: string, fallback: { loanType?: string | null }): string | null {
  if (!RATE_QUESTION_RE.test(customerMessage)) return null
  const loanType = detectLoanType(customerMessage) || detectLoanType(fallback.loanType || "") || "Home Loan"
  const rateInfo = BEST_RATES[loanType] || BEST_RATES["Home Loan"]
  return (
    `EXACT RATE (use this precise figure every time — never invent or vary it): ` +
    `Our ${loanType} rate starts from ${rateInfo.ratePct}% p.a. with ${rateInfo.lender}, tenure up to ${rateInfo.maxTenureYears} years. ` +
    `State this exact rate. The final rate for THIS customer still depends on their profile — say that too, but the starting figure above is fixed and must never change between calls.`
  )
}

export function buildEmiInstruction(customerMessage: string, fallback: { loanAmount?: number | null; loanType?: string | null }): EmiAnswer | null {
  // An income/eligibility statement ("my monthly income is 80000") mentions
  // a bare number too — that number is NOT a loan principal, so don't let
  // it trigger an EMI calc. Only a real EMI question, or an amount clearly
  // NOT framed as income/eligibility, counts.
  const isIncomeOrEligibility = INCOME_CONTEXT_RE.test(customerMessage) || ELIGIBILITY_QUESTION_RE.test(customerMessage)
  if (!EMI_QUESTION_RE.test(customerMessage) && (isIncomeOrEligibility || !parseAmount(customerMessage))) return null

  const loanType = detectLoanType(customerMessage) || detectLoanType(fallback.loanType || "") || "Home Loan"
  const rateInfo = BEST_RATES[loanType] || BEST_RATES["Home Loan"]

  const principal = parseAmount(customerMessage) || fallback.loanAmount || 2000000 // sane default: 20L
  const tenureMonths = parseTenureMonths(customerMessage) || rateInfo.maxTenureYears * 12

  const emi = calculateEMI(principal, rateInfo.ratePct, tenureMonths)
  const totalInt = totalInterest(principal, emi, tenureMonths)

  const instruction =
    `EXACT EMI CALCULATION (use this precise number, do NOT calculate your own — you are bad at arithmetic): ` +
    `For a ${loanType} of ${formatINR(principal)} at ${rateInfo.ratePct}% p.a. (${rateInfo.lender}) over ${tenureMonths / 12} years, ` +
    `the EMI is ${formatINR(emi)} per month (total interest over the loan: ${formatINR(totalInt)}). ` +
    `State this exact EMI figure directly and confidently — it is a real calculation, not a guess. ` +
    `Still remind them the FINAL rate depends on their credit profile, so this is an illustrative estimate.`

  return { instruction, principal, ratePct: rateInfo.ratePct, tenureMonths, emi }
}
