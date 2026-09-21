// Shared constant-time bearer-key check for internal service endpoints
// (voicebot bridge, digest mailer, scheduled scans). Before 2026-09-20 every
// one of these compared `key !== process.env.*` — plain string equality on a
// long-lived credential. All other webhook keys already used timingSafeEqual;
// this unifies the pattern for the rest.
//
// Fail-closed: when the expected env var is unset/empty the key is rejected
// (set ALLOW_UNSIGNED_WEBHOOK=1 for local development only).
import crypto from "crypto"

export function verifyServiceKey(req: Request, envVar = "WHATSAPP_SERVICE_KEY"): boolean {
  const expected = (process.env[envVar] || "").trim()
  if (!expected) {
    if (process.env.ALLOW_UNSIGNED_WEBHOOK === "1") return true // explicit dev escape hatch
    console.error(`🚫 Rejecting service request: ${envVar} is not set (fail-closed). Set it in .env, or ALLOW_UNSIGNED_WEBHOOK=1 for local dev only.`)
    return false
  }
  const provided = req.headers.get("x-api-key") || new URL(req.url).searchParams.get("key") || ""
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
