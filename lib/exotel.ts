// Exotel — the ONLY telephony provider now (Twilio removed).
//
// Architecture: calls run through an Exotel FLOW containing a VOICEBOT APPLET.
// The Voicebot applet opens a bidirectional WebSocket to our own
// server/voicebot-server.js, which streams audio both ways:
//   caller audio → our STT → Ollama (Priya) → our TTS → caller.
//
// One-time Exotel dashboard setup (App Bazaar):
//   1. Create a new Call Flow (Custom App).
//   2. Add a "Voicebot" applet as the first step.
//   3. Set its URL to:  wss://YOUR-DOMAIN/voicebot   (nginx proxies to :3002)
//   4. Note the flow's App ID (visible in the flow URL) → EXOTEL_FLOW_APP_ID.
//   5. Point your ExoPhone's incoming-call app to this same flow so INBOUND
//      calls also reach Priya.
//
// Env: EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_SUBDOMAIN,
//      EXOTEL_CALLER_ID (your ExoPhone), EXOTEL_FLOW_APP_ID

const EXOTEL_SID       = process.env.EXOTEL_SID || ""
const EXOTEL_API_KEY   = process.env.EXOTEL_API_KEY || ""
const EXOTEL_API_TOKEN = process.env.EXOTEL_API_TOKEN || ""
const EXOTEL_SUBDOMAIN = process.env.EXOTEL_SUBDOMAIN || "api.exotel.com"
const EXOTEL_CALLER_ID = process.env.EXOTEL_CALLER_ID || ""
const EXOTEL_FLOW_APP_ID = process.env.EXOTEL_FLOW_APP_ID || ""

function authHeader() {
  const token = Buffer.from(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`).toString("base64")
  return `Basic ${token}`
}

export type CallResult = { sid: string; status: string }

/**
 * Outbound call: Exotel dials the lead, and on answer connects them to the
 * Voicebot flow (→ our WebSocket server → Priya).
 *
 * leadId/language are NOT passed through Exotel — the caller of this function
 * (app/api/outbound/*) records { call sid → lead, language } in the
 * voice_calls table, and the voicebot server resolves the context by CallSid
 * via /api/calls/turn. That keeps the Exotel side dead simple.
 */
export async function makeExotelCall(to: string, _leadId: string, _language: string = "english", _instructions?: string): Promise<CallResult> {
  if (!EXOTEL_SID || !EXOTEL_API_KEY || !EXOTEL_API_TOKEN) throw new Error("Exotel credentials not configured")
  if (!EXOTEL_FLOW_APP_ID) throw new Error("EXOTEL_FLOW_APP_ID not set — create the Voicebot flow in Exotel App Bazaar first")

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const url = `https://${EXOTEL_SUBDOMAIN}/v1/Accounts/${EXOTEL_SID}/Calls/connect.json`

  // NOTE: no StatusCallbackEvents parameter on purpose. Verified against the
  // live API (Jul 2026): every explicit form of it — plain, [0]-indexed, [] —
  // is rejected with "Invalid 'StatusCallbackEvents' specified". When omitted,
  // Exotel accepts the request and sends the terminal status callback by
  // default, which is exactly the one /api/calls/status needs.
  const params = new URLSearchParams({
    From: to,
    CallerId: EXOTEL_CALLER_ID,
    Url: `https://my.exotel.com/${EXOTEL_SID}/exoml/start_voice/${EXOTEL_FLOW_APP_ID}`,
    Record: "true", // Exotel records the call → RecordingUrl arrives in the status callback → dashboard player
    StatusCallback: `${appUrl}/api/calls/status`,
    StatusCallbackContentType: "application/json",
  })

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.RestException?.Message || data?.error || `Exotel HTTP ${res.status}`)
  }

  return {
    sid: data.Call?.Sid || data.call_details?.sid,
    status: data.Call?.Status || data.call_details?.state || "initiated",
  }
}

/** Kept for API compatibility with the outbound routes. */
export async function makeCall(to: string, leadId: string, language: string = "english", instructions?: string): Promise<CallResult> {
  return makeExotelCall(to, leadId, language, instructions)
}

export function activeProvider(): "exotel" {
  return "exotel"
}
