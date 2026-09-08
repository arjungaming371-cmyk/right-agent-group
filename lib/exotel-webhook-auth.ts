import { NextRequest } from "next/server"

// Exotel's StatusCallback and Passthru applets don't support HMAC signing
// like Meta's webhooks do — but Exotel lets you configure ANY URL for these
// callbacks, including one with a secret query param baked in. This is the
// practical equivalent of a signature check for a provider that doesn't
// offer one natively.
//
// Setup (one-time, in the Exotel dashboard):
//   1. Set EXOTEL_WEBHOOK_KEY in .env to a long random string.
//   2. In Exotel's Voice Flow (App Bazaar), set the StatusCallback URL to:
//        https://YOUR-DOMAIN/api/calls/status?key=YOUR_SECRET
//      and the Passthru applet URL to:
//        https://YOUR-DOMAIN/api/calls/passthru?key=YOUR_SECRET
//
// FAIL-CLOSED when EXOTEL_WEBHOOK_KEY is unset (2026-09 security pass). These
// webhooks can flip lead statuses, overwrite recording URLs, and trigger
// WhatsApp sends — accepting unauthenticated requests for them was the
// single biggest forgeable surface in the app. Once you set EXOTEL_WEBHOOK_KEY
// and bake ?key= into the Exotel dashboard URLs, everything works as before.
// For local development without Exotel, set ALLOW_UNSIGNED_WEBHOOK=1 in .env
// to restore the old fail-open behaviour.
import crypto from "crypto"

export function verifyExotelWebhookKey(req: NextRequest): boolean {
  const expected = (process.env.EXOTEL_WEBHOOK_KEY || "").trim()
  if (!expected) {
    if (process.env.ALLOW_UNSIGNED_WEBHOOK === "1") return true // explicit dev escape hatch
    console.error("🚫 Rejecting Exotel webhook: EXOTEL_WEBHOOK_KEY is not set (fail-closed). " +
      "Set EXOTEL_WEBHOOK_KEY in .env and add ?key=YOUR_SECRET to the Exotel callback URLs, " +
      "or ALLOW_UNSIGNED_WEBHOOK=1 for local dev only.")
    return false
  }

  const { searchParams } = new URL(req.url)
  const provided = searchParams.get("key") || ""
  // Constant-time compare — the key is effectively a bearer credential.
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
