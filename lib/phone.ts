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

/** SQL fragment matching a leads.phone column against a $N last-10 param.
 *  SECURITY: exact last-10 equality. The old `LIKE '%' || $1` form matched
 *  EVERY row when $1 was '' (unparseable phone → phoneLast10 → ''), which let
 *  one malformed POST overwrite an arbitrary lead. NULLIF($1,'') makes the
 *  empty parameter match nothing. */
export const PHONE_MATCH_SQL = `right(regexp_replace(phone, '\\D', '', 'g'), 10) = NULLIF($1, '')`

/**
 * Detect an Indian mobile number typed INSIDE free text (Instagram DMs).
 *
 * Why not a one-line regex: the obvious `/\b[6-9]\d{9}\b/` misses the two
 * most common real-world formats — "+919876543210" (no word boundary between
 * the 91 prefix and the rest) and "98765 43210" / "98765-43210" (the way
 * almost everyone in India types numbers). Instead we walk digit RUNS
 * (digits with inline separators), strip the separators, and validate the
 * payload with the same rules as normalizePhone.
 *
 * Guards:
 *  - a candidate embedded in a LONGER digit run is rejected (order IDs,
 *    OTP-sized strings, concatenated digits never yield a phone)
 *  - anything that isn't 10 digits (or 11 with a 0 trunk prefix / 12 with a
 *    91 country prefix) is rejected — so 8-digit amounts, 12-digit Aadhaar
 *    and 16-digit card numbers never match
 *  - the 10-digit payload must start with 6-9 (Indian mobile ranges)
 *
 * Returns the normalized E.164 number (+91XXXXXXXXXX) plus the raw text the
 * customer actually typed (kept for leads.ig_phone_extracted), or null.
 */
export function extractIndianMobile(raw: string): { phone: string; raw: string } | null {
  const text = String(raw || "")
  if (!text) return null
  const run = /\+?\d[\d\s\-().]{6,}\d/g
  let m: RegExpExecArray | null
  while ((m = run.exec(text)) !== null) {
    const start = m.index
    const end = start + m[0].length
    // Embedded in a longer digit run → not a phone (a real phone is the
    // whole run; a phone inside "98765432109876" is coincidence).
    if (start > 0 && /\d/.test(text[start - 1])) continue
    if (end < text.length && /\d/.test(text[end])) continue
    const digits = m[0].replace(/\D/g, "")
    let ten = ""
    if (digits.length === 10) ten = digits
    else if (digits.length === 11 && digits.startsWith("0")) ten = digits.slice(1)
    else if (digits.length === 12 && digits.startsWith("91")) ten = digits.slice(2)
    if (!/^[6-9]\d{9}$/.test(ten)) continue
    return { phone: `+91${ten}`, raw: m[0].trim() }
  }
  return null
}
