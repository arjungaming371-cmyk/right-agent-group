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
// FAIL-OPEN when EXOTEL_WEBHOOK_KEY is unset — matches this codebase's own
// ip_allowlist pattern (lib/security.ts) of never breaking an existing
// deployment because a new optional protection wasn't configured yet.
// Once the key is set, requests without a matching ?key= are dropped.
export function verifyExotelWebhookKey(req: NextRequest): boolean {
  const expected = (process.env.EXOTEL_WEBHOOK_KEY || "").trim()
  if (!expected) return true // not configured yet — don't block Exotel

  const { searchParams } = new URL(req.url)
  const provided = searchParams.get("key") || ""
  return provided === expected
}
