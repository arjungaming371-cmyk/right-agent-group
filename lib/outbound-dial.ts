// placeOutboundCall — THE one dial leg for every outbound Priya call.
//
// 2026-09-26 bulk upgrade: this was previously inlined in /api/calls/dial
// only, which is why the bulk runner could do phone (Exotel) but not
// WhatsApp voice. Now both the single-dial route AND the bulk runner share
// this module:
//
//   phone     → Exotel click-to-call (lib/exotel makeCall): Exotel rings the
//               lead, bridges them to the voicebot WebSocket, Priya runs the
//               shared call script. Works wherever Exotel works.
//   whatsapp  → Business-initiated WhatsApp call (Meta Business Calling):
//               1. the voicebot holds a werift SDP OFFER (/whatsapp/outbound-offer)
//               2. we POST it to Graph action=connect        (placeWhatsAppCall)
//               3. Meta rings the lead's WhatsApp; on answer the "calls"
//                  webhook completes the negotiation — identical session
//                  machinery to inbound (turns, endpointing, recording).
//   auto      → whatsapp when the lead called us in the last 30 days
//               (Meta's implicit callback permission), else phone.
//
// The voice_calls row is written BEFORE the phone rings (direction=outbound)
// so /api/calls/turn's "start" event resolves lead + language + branch with
// zero extra lookups — same contract the single-dial route always had.
//
// Errors throw DialError with an HTTP status + optional hint so both callers
// can surface Meta's raw rejection text verbatim (the operator needs to know
// exactly which gate to fix: call permission, Business Calling enablement,
// voicebot down, …).

import { db } from "@/lib/db"
import { makeCall } from "@/lib/exotel"
import { branchWhatsAppCtx, placeWhatsAppCall } from "@/lib/whatsapp"
import { bridgeToVoicebot } from "@/lib/voicebot-bridge"
import { normalizePhone, phoneLast10 } from "@/lib/phone"

export type RequestedChannel = "phone" | "whatsapp" | "auto"
export type ResolvedChannel = "phone" | "whatsapp"

const WA_OUTBOUND_WINDOW_DAYS = 30

export class DialError extends Error {
  status: number
  hint?: string
  constructor(message: string, status = 502, hint?: string) {
    super(message)
    this.status = status
    this.hint = hint
  }
}

/** WhatsApp id = phone digits WITH country code, no "+". Leads stored as
 *  "9908838090" (10 digits) are Indian numbers → prefix 91. */
export function toWaId(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "")
  if (!digits) return ""
  return digits.length === 10 ? `91${digits}` : digits
}

// PRE-DIAL GUARD (2026-10-05): the outbound QUEUE claims rows atomically
// (FOR UPDATE SKIP LOCKED + a unique partial index on active phones), but
// the three MANUAL dial paths (single-dial route, the legacy /api/calls
// loop, the one-shot /api/outbound immediate mode) used to bypass the queue
// entirely — an agent clicking "Call" during a live campaign produced TWO
// simultaneous calls to the same customer, and two rapid clicks produced
// two calls to anyone. Manual dials now run this shared guard first.
//
// Rejects when any of these is true for the same last-10 phone digits:
//   1. an active outbound_queue row (pending | dialing) — the campaign
//      machinery already owns this number right now;
//   2. an outbound voice_call still in flight (initiated | ringing |
//      in-progress);
//   3. an outbound voice_call created in the last 60s — covers the placement
//      window before the status webhook lands (redial after a genuinely
//      finished call stays possible immediately).
export async function assertNoActiveDial(phone: string): Promise<void> {
  const { query } = await import("@/lib/db")
  const last10 = phoneLast10(normalizePhone(phone))
  if (!last10) return
  const [queueRow, inFlight, justPlaced] = await Promise.all([
    query(
      `SELECT id FROM outbound_queue
        WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1
          AND status IN ('pending', 'dialing')
        LIMIT 1`,
      [last10]
    ),
    query(
      `SELECT id FROM voice_calls
        WHERE direction = 'outbound'
          AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1
          AND status IN ('initiated', 'ringing', 'in-progress')
        LIMIT 1`,
      [last10]
    ),
    query(
      `SELECT id FROM voice_calls
        WHERE direction = 'outbound'
          AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1
          AND created_at > now() - interval '60 seconds'
        LIMIT 1`,
      [last10]
    ),
  ])
  if (queueRow.rows[0]) {
    throw new DialError("This number already has a campaign call queued or in progress.", 409)
  }
  if (inFlight.rows[0] || justPlaced.rows[0]) {
    throw new DialError("A call to this number is already being placed or was just placed.", 409)
  }
}

/** "auto" resolution: WhatsApp callback is only safe when the lead recently
 *  called US (Meta's implicit callback permission). A probe failure never
 *  blocks dialing — Meta remains the real gate and its error surfaces
 *  verbatim from the connect step. */
export async function resolveChannel(requested: RequestedChannel, leadId: string): Promise<ResolvedChannel> {
  if (requested === "phone") return "phone"
  if (process.env.WHATSAPP_OUTBOUND_CALLS === "0") {
    if (requested === "whatsapp") {
      throw new DialError(
        "WhatsApp outbound calling is disabled (WHATSAPP_OUTBOUND_CALLS=0) — enable Business Calling for your WABA number first",
        501
      )
    }
    return "phone" // auto under the kill switch silently falls back to phone
  }
  if (requested === "whatsapp") return "whatsapp"
  // auto — probe the callback permission.
  try {
    const { data: recent } = await db
      .from("voice_calls")
      .select("created_at")
      .eq("lead_id", leadId)
      .like("twilio_call_sid", "wacall-%")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
    const lastAt = recent?.[0]?.created_at ? new Date(recent[0].created_at).getTime() : 0
    return lastAt > Date.now() - WA_OUTBOUND_WINDOW_DAYS * 24 * 60 * 60 * 1000 ? "whatsapp" : "phone"
  } catch (e) {
    console.error("dial: callback-permission probe failed:", e instanceof Error ? e.message : e)
    return "phone"
  }
}

import { isAiPaused, aiPauseMessage, type AiPauseKind } from "./ai-pause"

export async function placeOutboundCall(opts: {
  phone: string
  leadId: string | null
  language: string
  requested: RequestedChannel
  branchId?: string | null
  /** Per-call talk points for Priya — persisted on the voice_calls row so
   *  /api/calls/turn reads them. The /api/calls/dial route persists these;
   *  the bulk path silently dropped them (2026-09-26 audit: drifting
   *  duplicates), so bulk-dialed leads never got their talk points. */
  instructions?: string | null
}): Promise<{ channel: ResolvedChannel; callSid: string; status: string }> {
  const { leadId, language } = opts
  const phone = normalizePhone(opts.phone)
  const branchId = opts.branchId ?? null
  if (!phone) throw new DialError("lead has no callable phone number", 400)

  // AI KILL SWITCH — the single chokepoint for BOTH channels. Everything
  // that makes Priya dial an outbound call (manual dial, bulk runner,
  // one-shot legacy loop, WhatsApp business-initiated) funnels through
  // here, so one check guards them all. Global OR branch scope.
  if (await isAiPaused("calls", branchId)) {
    throw new DialError(aiPauseMessage("calls"), 503)
  }

  const channel = await resolveChannel(opts.requested, leadId || "")

  if (channel === "whatsapp") {
    const waId = toWaId(phone)
    if (!waId) throw new DialError("cannot derive a WhatsApp id from this lead's number", 400)

    // 1. Offer held on the voicebot (werift, ICE gathered).
    const offer = await bridgeToVoicebot(
      "/whatsapp/outbound-offer",
      { from: waId, to: "", branchId },
      8000
    )
    if (!offer.pendingId || !offer.offerSdp) {
      throw new DialError("voicebot did not return a call offer — is the voicebot (pm2) running?", 502)
    }

    // 2. Graph action=connect — Meta rings the lead's WhatsApp.
    const waCtx = await branchWhatsAppCtx(branchId)
    const placed = await placeWhatsAppCall(waId, offer.offerSdp, waCtx)
    if (!placed.ok || !placed.callId) {
      // Release the held offer — a peer connection must never leak.
      await bridgeToVoicebot("/whatsapp/outbound-cancel", { pendingId: offer.pendingId, reason: "graph connect failed" }, 5000).catch(() => {})
      throw new DialError(
        placed.error || "Meta rejected the call",
        502,
        "WhatsApp outbound calls need call permission: the lead must have called this number recently, or tapped Allow on a call-permission request. Ask them with the shield button on the WhatsApp Calls tab (POST /api/whatsapp/call-permission), or fall back to a phone dial. Also confirm Business Calling is enabled for the WABA number."
      )
    }

    // 3. Bind Meta's call_id → held offer so the answer webhook completes
    //    the negotiation (bridge-local, zero migration).
    const reg = await bridgeToVoicebot("/whatsapp/outbound-register", { pendingId: offer.pendingId, callId: placed.callId }, 5000)

    // 4. Log the call row BEFORE it rings.
    const callSid = `wacall-${placed.callId}`
    await db.from("voice_calls").insert({
      lead_id: leadId,
      twilio_call_sid: callSid,
      direction: "outbound",
      status: "ringing",
      language,
      phone,
      branch_id: branchId,
      instructions: opts.instructions ?? null,
    })
    console.log(`📤 WhatsApp outbound dial lead=${leadId || "—"} to=***${phone.slice(-4)} callId=***${placed.callId.slice(-8)} registered=${reg.ok ? "yes" : "no"}`)
    return { channel, callSid, status: "ringing" }
  }

  // phone — Exotel click-to-call.
  const call = await makeCall(phone, leadId || "", language, undefined, branchId)
  await db.from("voice_calls").insert({
    lead_id: leadId,
    twilio_call_sid: call.sid,
    direction: "outbound",
    status: "initiated",
    language,
    phone,
    branch_id: branchId,
    instructions: opts.instructions ?? null,
  })
  return { channel, callSid: call.sid, status: "initiated" }
}
