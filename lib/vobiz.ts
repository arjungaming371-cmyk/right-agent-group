// Vobiz AI Telephony Provider
//
// Inbound & Outbound AI voice calling via Vobiz Audio Streams.
// Connects to wss://YOUR-DOMAIN/voicebot via bidirectional WebSocket.

export type VobizCreds = {
  authId: string
  authToken: string
  callerId: string
}

export type CallResult = { sid: string; status: string }

function envCreds(): VobizCreds {
  return {
    authId: (process.env.VOBIZ_AUTH_ID || "").trim(),
    authToken: (process.env.VOBIZ_AUTH_TOKEN || "").trim(),
    callerId: (process.env.VOBIZ_CALLER_ID || "").trim(),
  }
}

/**
 * Resolve credentials: branch override -> env default.
 */
export async function credsForBranch(branchId: string | null | undefined): Promise<VobizCreds> {
  const env = envCreds()
  if (!branchId) return env
  try {
    const { getBranch } = await import("./branches")
    const b = await getBranch(branchId)
    if (!b) return env
    return {
      authId: (b as Record<string, unknown>).vobiz_auth_id ? String((b as Record<string, unknown>).vobiz_auth_id) : env.authId,
      authToken: (b as Record<string, unknown>).vobiz_auth_token ? String((b as Record<string, unknown>).vobiz_auth_token) : env.authToken,
      callerId: (b as Record<string, unknown>).vobiz_caller_id ? String((b as Record<string, unknown>).vobiz_caller_id) : env.callerId,
    }
  } catch {
    return env
  }
}

/**
 * Outbound call: Vobiz dials the lead, and on answer fetches answer_url
 * which returns VobizXML pointing to our bidirectional WebSocket (wss://.../voicebot).
 */
export async function makeVobizCall(
  to: string,
  leadId: string,
  language: string = "telugu",
  _instructions?: string,
  branchId?: string | null
): Promise<CallResult> {
  const creds = await credsForBranch(branchId)
  if (!creds.authId || !creds.authToken) {
    throw new Error("Vobiz credentials not configured. Please set VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN in .env")
  }
  if (!creds.callerId) {
    throw new Error("VOBIZ_CALLER_ID not set. Please set your Vobiz virtual number in .env")
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl || !/^https?:\/\//.test(appUrl)) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set or invalid — Vobiz Answer/Status callback URL cannot be constructed")
  }

  const webhookKey = (process.env.VOBIZ_WEBHOOK_KEY || process.env.EXOTEL_WEBHOOK_KEY || "").trim()
  const keyParam = webhookKey ? `&key=${encodeURIComponent(webhookKey)}` : ""
  const statusKeyParam = webhookKey ? `?key=${encodeURIComponent(webhookKey)}` : ""

  const answerUrl = `${appUrl.replace(/\/+$/, "")}/api/calls/vobiz-answer?leadId=${encodeURIComponent(leadId)}&branchId=${encodeURIComponent(branchId || "")}&lang=${encodeURIComponent(language)}${keyParam}`
  const statusCallback = `${appUrl.replace(/\/+$/, "")}/api/calls/status${statusKeyParam}`

  const payload = {
    from: creds.callerId,
    to,
    answer_url: answerUrl,
    answer_method: "POST",
    status_callback_url: statusCallback,
    status_callback_method: "POST",
    record: true,
    record_callback_url: statusCallback,
    record_callback_method: "POST",
  }

  const url = `https://api.vobiz.ai/api/v1/Account/${creds.authId}/Call/`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-ID": creds.authId,
      "X-Auth-Token": creds.authToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(String(data?.message || data?.error || `Vobiz HTTP ${res.status}`))
  }

  return {
    sid: String(data.call_uuid || data.callId || data.request_id || data.api_id || "vobiz_" + Date.now()),
    status: String(data.message || "initiated"),
  }
}
