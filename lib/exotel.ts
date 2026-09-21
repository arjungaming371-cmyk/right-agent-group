// Exotel — the ONLY telephony provider now (Twilio removed).
//
// Architecture: calls run through an Exotel FLOW containing a VOICEBOT APPLET.
// The Voicebot applet opens a bidirectional WebSocket to our own
// server/voicebot-server.js, which streams audio both ways:
//   caller audio → our STT (Sarvam) → LLM (Priya) → our TTS → caller.
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
//
// MULTI-BRANCH: a branch can carry its OWN Exotel account + DLT-approved
// ExoPhone (branches.exotel_*). makeCall resolves the effective credentials
// for the branch being dialed — branch override → env default. That is what
// makes each branch dial from ITS approved number while the bill stays on the
// parent account.

const EXOTEL_SID       = process.env.EXOTEL_SID || ""
const EXOTEL_API_KEY   = process.env.EXOTEL_API_KEY || ""
const EXOTEL_API_TOKEN = process.env.EXOTEL_API_TOKEN || ""
const EXOTEL_SUBDOMAIN = process.env.EXOTEL_SUBDOMAIN || "api.exotel.com"
const EXOTEL_CALLER_ID = process.env.EXOTEL_CALLER_ID || ""
const EXOTEL_FLOW_APP_ID = process.env.EXOTEL_FLOW_APP_ID || ""

export type ExotelCreds = {
  sid: string
  apiKey: string
  apiToken: string
  subdomain: string
  callerId: string
  flowAppId: string
}

function envCreds(): ExotelCreds {
  return { sid: EXOTEL_SID, apiKey: EXOTEL_API_KEY, apiToken: EXOTEL_API_TOKEN, subdomain: EXOTEL_SUBDOMAIN, callerId: EXOTEL_CALLER_ID, flowAppId: EXOTEL_FLOW_APP_ID }
}

/**
 * Resolve the credentials for a call: a branch with its own Exotel account
 * (all required fields set) overrides the env-level default. Branches that
 * only set a callerId ride the default account but dial from THEIR number.
 */
async function credsForBranch(branchId: string | null | undefined): Promise<ExotelCreds> {
  const env = envCreds()
  if (!branchId) return env
  try {
    const { getBranch } = await import("./branches")
    const b = await getBranch(branchId)
    if (!b) return env
    return {
      sid: b.exotel_sid || env.sid,
      apiKey: b.exotel_api_key || env.apiKey,
      apiToken: b.exotel_api_token || env.apiToken,
      subdomain: env.subdomain,
      callerId: b.exotel_caller_id || env.callerId,
      flowAppId: b.exotel_flow_app_id || env.flowAppId,
    }
  } catch {
    return env
  }
}

function authHeader(creds: ExotelCreds) {
  const token = Buffer.from(`${creds.apiKey}:${creds.apiToken}`).toString("base64")
  return `Basic ${token}`
}

export type CallResult = { sid: string; status: string }

/**
 * Outbound call: Exotel dials the lead, and on answer connects them to the
 * Voicebot flow (→ our WebSocket server → Priya).
 *
 * leadId/language are NOT passed through Exotel — the caller of this function
 * (app/api/outbound/*) records { call sid → lead, language, branch } in the
 * voice_calls table, and the voicebot server resolves the context by CallSid
 * via /api/calls/turn. That keeps the Exotel side dead simple.
 */
export async function makeExotelCall(
  to: string,
  _leadId: string,
  _language: string = "telugu",
  _instructions?: string,
  branchId?: string | null
): Promise<CallResult> {
  const creds = await credsForBranch(branchId)
  if (!creds.sid || !creds.apiKey || !creds.apiToken) throw new Error("Exotel credentials not configured")
  if (!creds.flowAppId) throw new Error("EXOTEL_FLOW_APP_ID not set — create the Voicebot flow in Exotel App Bazaar first")
  if (!creds.callerId) throw new Error("EXOTEL_CALLER_ID not set (and the branch has no ExoPhone of its own)")

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const url = `https://${creds.subdomain}/v1/Accounts/${creds.sid}/Calls/connect.json`

  // NOTE: no StatusCallbackEvents parameter on purpose. Verified against the
  // live API (Jul 2026): every explicit form of it — plain, [0]-indexed, [] —
  // is rejected with "Invalid 'StatusCallbackEvents' specified". When omitted,
  // Exotel accepts the request and sends the terminal status callback by
  // default, which is exactly what /api/calls/status needs.
  //
  // SECURITY FIX (2026-09-20): /api/calls/status now FAILS CLOSED without a
  // valid ?key= — but this programmatic StatusCallback used to omit it, so the
  // moment EXOTEL_WEBHOOK_KEY was configured, every outbound call's status
  // callback was silently rejected (statuses/recording/follow-ups never ran)
  // and the only "fix" operators found was ALLOW_UNSIGNED_WEBHOOK=1, which
  // reopens the forged-webhook hole. Bake the key into every per-call callback.
  const webhookKey = (process.env.EXOTEL_WEBHOOK_KEY || "").trim()
  if (!webhookKey && process.env.ALLOW_UNSIGNED_WEBHOOK !== "1") {
    throw new Error("EXOTEL_WEBHOOK_KEY is not set — outbound call status callbacks would be rejected by /api/calls/status. Set EXOTEL_WEBHOOK_KEY in .env (or ALLOW_UNSIGNED_WEBHOOK=1 for local dev).")
  }
  const statusCallback = webhookKey
    ? `${appUrl}/api/calls/status?key=${encodeURIComponent(webhookKey)}`
    : `${appUrl}/api/calls/status`
  const params = new URLSearchParams({
    From: to,
    CallerId: creds.callerId,
    Url: `https://my.exotel.com/${creds.sid}/exoml/start_voice/${creds.flowAppId}`,
    Record: "true", // Exotel records the call → RecordingUrl arrives in the status callback → dashboard player
    StatusCallback: statusCallback,
    StatusCallbackContentType: "application/json",
  })

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader(creds), "Content-Type": "application/x-www-form-urlencoded" },
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
export async function makeCall(to: string, leadId: string, language: string = "telugu", instructions?: string, branchId?: string | null): Promise<CallResult> {
  return makeExotelCall(to, leadId, language, instructions, branchId)
}

export function activeProvider(): "exotel" {
  return "exotel"
}
