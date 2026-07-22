// Phone normalization shared by every path that creates or looks up a lead
// by phone number. Leads arrive from four directions (manual add, CSV
// upload, inbound calls, inbound WhatsApp) and each used to format numbers
// its own way ("9908838090" vs "+919908838090"), so the same person could
// exist twice. Store +91XXXXXXXXXX, match on the last 10 digits.

/** Normalize an Indian number for STORAGE: "99088 38090" → "+919908838090". */
export function normalizePhone(raw: string): string {
  let digits = String(raw || "").replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1)
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`
  return digits ? `+${digits}` : ""
}

/** Last 10 digits — the stable key for matching Indian numbers across formats. */
export function phoneLast10(raw: string): string {
  return String(raw || "").replace(/\D/g, "").slice(-10)
}

/** SQL fragment matching a leads.phone column against a $N last-10 param. */
export const PHONE_MATCH_SQL = `regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1`
