// Loopback bridge client for the voicebot's WhatsApp calling HTTP endpoints
// (server/voicebot-server.js → the werift call engine).
//
// Loopback-only by design (127.0.0.1:VOICEBOT_HTTP_PORT, nginx never exposes
// it) and authenticated with the SAME shared WHATSAPP_SERVICE_KEY the turn
// API uses — one internal secret for the whole calling stack.

export type VoicebotBridgeResult = {
  ok?: boolean
  error?: string
  // inbound connect
  answerSdp?: string
  // terminate
  ended?: boolean
  // outbound offer / accept
  pendingId?: string
  offerSdp?: string
  callSid?: string
}

export function voicebotBaseUrl(): string {
  return (process.env.VOICEBOT_INTERNAL_URL || "http://127.0.0.1:3003").replace(/\/$/, "")
}

/** POST one command to the voicebot bridge. Throws on transport failure or a
 *  non-OK bridge response (the bridge always answers { ok, error? }). */
export async function bridgeToVoicebot(
  path: string,
  payload: Record<string, unknown>,
  timeoutMs = 8000
): Promise<VoicebotBridgeResult> {
  const res = await fetch(`${voicebotBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.WHATSAPP_SERVICE_KEY || "",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = (await res.json().catch(() => ({}))) as VoicebotBridgeResult
  if (!res.ok) throw new Error(data?.error || `voicebot HTTP ${res.status}`)
  return data
}
