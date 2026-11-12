// Compliance & quality checks for Priya's queue-time agenda / talking points.
//
// Pure module: safe to import in client components (live typing warnings)
// and server routes alike.

export interface AgendaWarning {
  code: "rate_figure" | "guarantee" | "no_check" | "sensitive_solicitation"
  message: string
  match?: string
}

const RATE_RE = /\b(\d+(?:\.\d+)?\s*%)/
const GUARANTEE_RE = /\b(guarant(?:ee|eed|y)|assured|pakka|pukka|100\s*%|sure[- ]?shot)\b/i
const NO_CHECK_RE = /\b(no\s+cibil|no\s+credit\s+check|no\s+documents?\s+required|guaranteed\s+approval|no\s+rejection)\b/i
const SENSITIVE_RE = /\b(otp|pin|cvv|password|upi\s*pin|pay\s+now|upfront\s+fee)\b/i

export function checkAgendaRules(text: string): AgendaWarning[] {
  const warnings: AgendaWarning[] = []
  const t = (text || "").trim()
  if (!t) return warnings

  // 1. Rate figures
  const rateMatch = t.match(RATE_RE)
  if (rateMatch) {
    warnings.push({
      code: "rate_figure",
      match: rateMatch[1],
      message: `"${rateMatch[1]}" — interest rates change frequently. Priya will mention this figure on every call in this batch. Consider "current competitive rates" or verify the lender's live rate.`,
    })
  }

  // 2. Guarantees
  const guaranteeMatch = t.match(GUARANTEE_RE)
  if (guaranteeMatch) {
    warnings.push({
      code: "guarantee",
      match: guaranteeMatch[1],
      message: `"${guaranteeMatch[1]}" — avoid absolute approval promises. Loan sanctions depend on bank underwriting and credit checks.`,
    })
  }

  // 3. No CIBIL / No check promises
  const noCheckMatch = t.match(NO_CHECK_RE)
  if (noCheckMatch) {
    warnings.push({
      code: "no_check",
      match: noCheckMatch[1],
      message: `"${noCheckMatch[1]}" — promising loans without verification violates regulatory lending guidelines.`,
    })
  }

  // 4. Sensitive solicitation
  const sensMatch = t.match(SENSITIVE_RE)
  if (sensMatch) {
    warnings.push({
      code: "sensitive_solicitation",
      match: sensMatch[1],
      message: `"${sensMatch[1]}" — Priya must never solicit OTPs, PINs, or upfront fees on outbound calls.`,
    })
  }

  return warnings
}
