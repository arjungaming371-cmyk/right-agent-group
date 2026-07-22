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
  "loan against property": "Loan Against Property", lap: "Loan Against Property",
  "four wheeler": "Four Wheeler Loan", car: "Four Wheeler Loan", "car loan": "Four Wheeler Loan",
  "two wheeler": "Two Wheeler Loan", bike: "Two Wheeler Loan",
  education: "Education Loan", "education loan": "Education Loan",
}

export const BEST_RATES: Record<string, { ratePct: number; maxTenureYears: number; lender: string }> = {
  "Home Loan":            { ratePct: 7.25, maxTenureYears: 30, lender: "SBI" },
  "Personal Loan":        { ratePct: 10.5, maxTenureYears: 5,  lender: "leading NBFC partners" },
  "Business Loan":        { ratePct: 11.0, maxTenureYears: 7,  lender: "leading NBFC partners" },
  "Loan Against Property":{ ratePct: 9.0,  maxTenureYears: 15, lender: "leading bank partners" },
  "Four Wheeler Loan":    { ratePct: 8.75, maxTenureYears: 7,  lender: "leading bank partners" },
  "Two Wheeler Loan":     { ratePct: 11.5, maxTenureYears: 4,  lender: "leading NBFC partners" },
  "Education Loan":       { ratePct: 9.5,  maxTenureYears: 15, lender: "leading bank partners" },
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

/**
 * Main entry point for the call/WhatsApp turn handlers. Give it the raw
 * customer message plus whatever the lead record already knows
 * (loan_amount, product_interest) as fallback context. Returns an
 * instruction string to inject into the AI's context ("EXACT EMI — state
 * this number, do not calculate your own") or null if no EMI math applies
 * this turn.
 */
export function buildEmiInstruction(customerMessage: string, fallback: { loanAmount?: number | null; loanType?: string | null }): EmiAnswer | null {
  if (!EMI_QUESTION_RE.test(customerMessage) && !parseAmount(customerMessage)) return null

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
