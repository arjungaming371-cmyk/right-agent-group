// Unified outbound dialer — Priya places a call TO a lead on the channel
// you pick. The dashboard's lead "Call" modal posts here.
//
//   POST /api/calls/dial  { leadId, channel: "whatsapp" | "phone" | "auto" }
//
//   phone    → Exotel click-to-call (lib/exotel makeCall): Exotel rings the
//              lead, bridges them to the voicebot WebSocket, Priya runs the
//              shared call script. Works today wherever Exotel works.
//   whatsapp → Business-initiated WhatsApp call (Meta Business Calling API):
//              1. the voicebot holds a werift SDP OFFER  (/whatsapp/outbound-offer)
//              2. we POST it to Graph action=connect         (placeWhatsAppCall)
//              3. Meta rings the lead's WhatsApp; on answer the "calls"
//                 webhook delivers their answer SDP, which completes the
//                 negotiation and Priya goes live (identical session
//                 machinery to inbound: turns, endpointing, recording).
//
//              META PERMISSION GATE (their rule, not ours): a lead who has
//              called this number can be called back; otherwise the lead
//              must accept a call-permission request. Rejections surface
//              Meta's raw error text verbatim so the operator knows exactly
//              which gate to fix.
//   auto     → whatsapp when the lead called us on WhatsApp in the last 30
//              days (callback permission is then safe to assume), else phone.
//
// Gating is identical to /api/outbound: voice-module auth, compliance
// (DND / opt-out, fail-CLOSED), branch quota, usage accounting. The
// voice_calls row is written BEFORE the phone rings so /api/calls/turn's
// "start" event resolves lead + language + branch with zero extra lookups.
//
// `instructions` ("What should Priya talk about?") is honored on BOTH
// channels: it is stored on the voice_calls row, where /api/calls/turn's
// turn handler already reads it — the same field the legacy /api/calls
// phone path used. Every dial also writes a comm_logs row so the lead's
// timeline shows the attempt, and warms the LLM while the phone rings.
//
// Full machine (channels, permission gates, status lifecycle, scripts,
// campaign queue, runbook): docs/OUTBOUND-CALLS.md.
//
// Env: WHATSAPP_OUTBOUND_CALLS=0 hard-disables the whatsapp/auto channels
//      (phone stays available) — for deployments that have not enabled
//      Business Calling on their WABA number yet.

import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db } from "@/lib/db"
import { makeCall } from "@/lib/exotel"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId, checkQuota, recordUsage } from "@/lib/branches"
import { branchWhatsAppCtx, placeWhatsAppCall } from "@/lib/whatsapp"
import { checkCallCompliance } from "@/lib/compliance"
import { normalizePhone } from "@/lib/phone"
import { bridgeToVoicebot } from "@/lib/voicebot-bridge"
import { sanitizeText } from "@/lib/api-route"

export const dynamic = "force-dynamic"

const WA_OUTBOUND_WINDOW_DAYS = 30

type DialChannel = "whatsapp" | "phone" | "auto"

/** WhatsApp id = phone digits WITH country code, no "+". Leads stored as
 *  "9908838090" (10 digits) are Indian numbers → prefix 91. */
function toWaId(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "")
  if (!digits) return ""
  return digits.length === 10 ? `91${digits}` : digits
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  let body: { leadId?: string; channel?: string; instructions?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const leadId = String(body?.leadId || "").trim()
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 })
  const channelRaw = String(body?.channel || "auto").toLowerCase() as DialChannel
  if (!["whatsapp", "phone", "auto"].includes(channelRaw)) {
    return NextResponse.json({ error: `unknown channel "${channelRaw}" — use whatsapp | phone | auto` }, { status: 400 })
  }

  // 1) Lead — scoped to the session's branch (null = HQ sees everything).
  const { data: lead } = await db
    .from("leads")
    .select("id, name, phone, whatsapp_number, language, branch_id")
    .eq("id", leadId)
    .single()
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 })
  if (branchId && lead.branch_id && lead.branch_id !== branchId) {
    return NextResponse.json({ error: "lead belongs to another branch" }, { status: 403 })
  }

  const phone = normalizePhone(lead.whatsapp_number || lead.phone)
  if (!phone) return NextResponse.json({ error: "lead has no callable phone number" }, { status: 400 })
  const language = lead.language || "telugu"
  // "What should Priya talk about?" — same field, same cap, both channels.
  const instructions = sanitizeText(body?.instructions, 1000) || null

  // Warm the LLM while the phone rings (same as the legacy /api/calls path).
  fetch(`${process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000"}/api/warmup`, { method: "POST" }).catch(() => {})

  // 2) Channel resolution for "auto": WhatsApp callback is only safe when
  //    the lead recently called US (Meta's implicit callback permission).
  let channel: Exclude<DialChannel, "auto"> = channelRaw === "auto" ? "phone" : channelRaw
  if (channelRaw === "whatsapp" || channelRaw === "auto") {
    if (process.env.WHATSAPP_OUTBOUND_CALLS === "0") {
      if (channelRaw === "whatsapp") {
        return NextResponse.json({ error: "WhatsApp outbound calling is disabled (WHATSAPP_OUTBOUND_CALLS=0) — enable Business Calling for your WABA number first" }, { status: 501 })
      }
    } else {
      let calledUs = false
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
        calledUs = lastAt > Date.now() - WA_OUTBOUND_WINDOW_DAYS * 24 * 60 * 60 * 1000
      } catch (e) {
        // Permission probe failure must not block dialing — Meta remains the
        // real gate and its error is surfaced verbatim below.
        console.error("dial: callback-permission probe failed:", e instanceof Error ? e.message : e)
      }
      if (channelRaw === "whatsapp" || calledUs) channel = "whatsapp"
    }
  }

  // 3) Compliance + quota — ONE gate for every outbound channel (fail-closed
  //    on compliance errors, per checkCallCompliance's contract).
  const compliance = await checkCallCompliance({ leadId, phone })
  if (!compliance.allowed) {
    return NextResponse.json({ error: compliance.reason }, { status: 403 })
  }
  const quota = await checkQuota(branchId, "call")
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason }, { status: 403 })
  }

  // 4) Dial.
  try {
    if (channel === "whatsapp") {
      const waId = toWaId(phone)
      if (!waId) return NextResponse.json({ error: "cannot derive a WhatsApp id from this lead's number" }, { status: 400 })

      // 4a. Offer held on the voicebot (werift, ICE gathered).
      const offer = await bridgeToVoicebot("/whatsapp/outbound-offer", {
        from: waId,       // the customer we are dialing
        to: "",
        branchId: branchId || lead.branch_id || null,
      }, 8000)
      if (!offer.pendingId || !offer.offerSdp) {
        return NextResponse.json({ error: "voicebot did not return a call offer — is the voicebot (pm2) running?" }, { status: 502 })
      }

      // 4b. Graph action=connect — Meta rings the lead's WhatsApp.
      const waCtx = await branchWhatsAppCtx(branchId || lead.branch_id || null)
      const placed = await placeWhatsAppCall(waId, offer.offerSdp, waCtx)
      if (!placed.ok || !placed.callId) {
        // Release the held offer — a peer connection must never leak.
        await bridgeToVoicebot("/whatsapp/outbound-cancel", {
          pendingId: offer.pendingId,
          reason: "graph connect failed",
        }, 5000).catch(() => {})
        return NextResponse.json({
          error: placed.error || "Meta rejected the call",
          hint: "WhatsApp outbound calls need call permission: the lead must have called this number recently, or accepted a call-permission request. Also confirm Business Calling is enabled for the WABA number.",
        }, { status: 502 })
      }

      // 4c. Bind Meta's call_id → held offer so the answer webhook can
      //     complete the negotiation (bridge-local, zero migration).
      const reg = await bridgeToVoicebot("/whatsapp/outbound-register", {
        pendingId: offer.pendingId,
        callId: placed.callId,
      }, 5000)

      // 4d. Log the call row BEFORE it rings — /api/calls/turn "start" then
      //     resolves direction=outbound, lead, language and branch from it.
      //     `instructions` rides on the row: the turn handler reads it from
      //     there on every turn (the WhatsApp session can't pass custom text).
      const callSid = `wacall-${placed.callId}`
      await db.from("voice_calls").insert({
        lead_id: leadId,
        twilio_call_sid: callSid,
        direction: "outbound",
        status: "ringing",
        language,
        phone,
        branch_id: branchId || lead.branch_id || null,
        instructions,
      })
      if (branchId) recordUsage(branchId, "call")
      await db.from("comm_logs").insert({
        lead_id: leadId,
        type: "call",
        summary: instructions
          ? `Outbound WhatsApp call initiated to ${phone} — "${instructions}"`
          : `Outbound WhatsApp call initiated to ${phone}`,
        outcome: "pending",
      }).catch(() => {})
      console.log(`📤 WhatsApp outbound dial lead=${leadId} to=***${phone.slice(-4)} callId=***${placed.callId.slice(-8)} registered=${reg.ok ? "yes" : "no"}`)
      return NextResponse.json({ ok: true, channel: "whatsapp", callSid, status: "ringing" })
    }

    // phone — Exotel click-to-call (same flow as /api/outbound single mode).
    const call = await makeCall(phone, leadId, language, undefined, branchId || lead.branch_id || null)
    await db.from("voice_calls").insert({
      lead_id: leadId,
      twilio_call_sid: call.sid,
      direction: "outbound",
      status: "initiated",
      language,
      phone,
      branch_id: branchId || lead.branch_id || null,
      instructions,
    })
    if (branchId) recordUsage(branchId, "call")
    await db.from("comm_logs").insert({
      lead_id: leadId,
      type: "call",
      summary: instructions
        ? `Outbound AI call initiated to ${phone} — "${instructions}"`
        : `Outbound AI call initiated to ${phone}`,
      outcome: "pending",
    }).catch(() => {})
    return NextResponse.json({ ok: true, channel: "phone", callSid: call.sid, status: "initiated" })
  } catch (e) {
    return apiError(e)
  }
}
