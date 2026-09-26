// Unified outbound dialer — Priya places a call TO a lead on the channel
// you pick. The dashboard's lead "Call" modal posts here.
//
//   POST /api/calls/dial  { leadId, channel: "whatsapp" | "phone" | "auto" }
//
//   phone    → Exotel click-to-call: Exotel rings the lead, bridges them to
//              the voicebot WebSocket, Priya runs the shared call script.
//   whatsapp → Business-initiated WhatsApp call (Meta Business Calling API):
//              the voicebot holds a werift SDP offer, we POST it to Graph
//              action=connect, Meta rings the lead's WhatsApp and the answer
//              webhook completes the negotiation (identical session
//              machinery to inbound: turns, endpointing, recording).
//   auto     → whatsapp when the lead called us on WhatsApp in the last 30
//              days (callback permission is then safe to assume), else phone.
//
// 2026-09-26: the dial legs themselves moved to lib/outbound-dial.ts so the
// BULK runner dials through the exact same code path — one place to fix, one
// place to extend. This route keeps the operator-facing contract: auth,
// lead branch-scoping, compliance (fail-CLOSED), branch quota, usage
// accounting, and verbatim Meta error surfacing.
//
// Env: WHATSAPP_OUTBOUND_CALLS=0 hard-disables the whatsapp/auto channels
//      (phone stays available; auto falls back to phone).

import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId, checkQuota, recordUsage } from "@/lib/branches"
import { checkCallCompliance } from "@/lib/compliance"
import { normalizePhone } from "@/lib/phone"
import { placeOutboundCall, DialError, type RequestedChannel } from "@/lib/outbound-dial"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  let body: { leadId?: string; channel?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const leadId = String(body?.leadId || "").trim()
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 })
  const channelRaw = String(body?.channel || "auto").toLowerCase() as RequestedChannel
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

  // 2) Compliance + quota — ONE gate for every outbound channel (fail-closed
  //    on compliance errors, per checkCallCompliance's contract).
  const compliance = await checkCallCompliance({ leadId, phone })
  if (!compliance.allowed) {
    return NextResponse.json({ error: compliance.reason }, { status: 403 })
  }
  const quota = await checkQuota(branchId, "call")
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason }, { status: 403 })
  }

  // 3) Dial through the shared leg (channel resolution + Meta/Exotel flow +
  //    the pre-ring voice_calls row all live there now).
  try {
    const placed = await placeOutboundCall({
      phone,
      leadId,
      language,
      requested: channelRaw,
      branchId: branchId || lead.branch_id || null,
    })
    if (branchId) recordUsage(branchId, "call")
    return NextResponse.json({ ok: true, channel: placed.channel, callSid: placed.callSid, status: placed.status })
  } catch (e) {
    if (e instanceof DialError) {
      return NextResponse.json(e.hint ? { error: e.message, hint: e.hint } : { error: e.message }, { status: e.status })
    }
    return apiError(e)
  }
}
