import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db } from "@/lib/db"
import { makeCall } from "@/lib/exotel"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId, checkQuota, recordUsage } from "@/lib/branches"
import { checkCallCompliance } from "@/lib/compliance"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // Branch-scoped users only see their branch's calls (admin sees all).
  const branchId = sessionBranchId(session)
  // channel=whatsapp → WhatsApp Calls tab ONLY (twilio_call_sid = wacall-*).
  // Without it the tab mixed in every Exotel/local phone-line call, which is
  // not how WhatsApp's Calls screen works — phone-line calls stay in
  // Voice Logs / Comm Log (this endpoint's other consumers).
  const channel = req.nextUrl.searchParams.get("channel")
  let q = db.from("voice_calls").select("*, leads(name, phone, source)")
  if (branchId) q = q.eq("branch_id", branchId)
  if (channel === "whatsapp") q = q.like("twilio_call_sid", "wacall-%")
  const { data, error } = await q.order("created_at", { ascending: false }).limit(100)
  if (error) return apiError(error)
  let rows: any[] = data ?? []

  // WhatsApp Calls tab: MISSED / declined / failed WhatsApp calls never
  // reach voice_calls (no session → no turn-start row), but finalizeWhatsAppCall
  // logs a call bubble for them (whatsapp_messages msg_type='call',
  // status='received'). Merge those in so the tab shows the complete WhatsApp
  // call history — answered (with duration) AND missed — newest first. On a
  // pre-rich-chat DB the msg_type filter errors and the shim returns []: the
  // tab then degrades gracefully to answered calls only.
  if (channel === "whatsapp") {
    let mb = db
      .from("whatsapp_messages")
      .select("*, leads(name, phone, source)")
      .eq("msg_type", "call")
      .eq("status", "received")
      .like("wa_message_id", "wacall-%")
    if (branchId) mb = mb.eq("branch_id", branchId)
    const missedRes = await mb.order("created_at", { ascending: false }).limit(100)
    const missed = ((missedRes.data ?? []) as any[]).map((m) => ({
      id: m.wa_message_id || m.id,
      lead_id: m.lead_id ?? null,
      twilio_call_sid: m.wa_message_id || null,
      direction: "inbound",
      status: "missed",
      duration: 0,
      outcome: "missed",
      created_at: m.created_at,
      phone: m.phone_number ?? null,
      branch_id: m.branch_id ?? null,
      leads: m.leads ?? null,
    }))
    rows = [...rows, ...missed]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 100)
  }

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { leadId, phone, language, instructions } = await req.json()
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 })
  const compliance = await checkCallCompliance({ leadId, phone })
  if (!compliance.allowed) {
    return NextResponse.json({ error: compliance.reason }, { status: 403 })
  }
  // Multi-branch: new calls belong to the session's active branch and draw
  // from its monthly quota. Calls made from the HQ scope (no branch) are
  // unlimited and unattributed, exactly like pre-multi-branch calls.
  const branchId = sessionBranchId(session)
  const quota = await checkQuota(branchId, "call")
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason }, { status: 403 })
  }
  try {
    // Warm up the AI brain BEFORE the call starts (so it's ready when caller picks up).
    // Loopback — never route this through the public tunnel.
    const internal = process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000"
    fetch(`${internal}/api/warmup`, { method: "POST" }).catch(() => {})

    const call = await makeCall(phone, leadId ?? "", language ?? "telugu", instructions, branchId)
    await db.from("voice_calls").insert({
      lead_id: leadId ?? null,
      twilio_call_sid: call.sid,
      direction: "outbound",
      status: "initiated",
      language: language ?? "telugu",
      phone,
      branch_id: branchId,
      // Exotel's voicebot bridge only ever knows the call SID — it can't
      // hand back custom text per turn — so this is stored here and read
      // back by /api/calls/turn instead of being passed through the call.
      instructions: instructions?.trim() || null,
    })
    if (branchId) recordUsage(branchId, "call")
    if (leadId) {
      await db.from("comm_logs").insert({
        lead_id: leadId,
        type: "call",
        summary: instructions ? `Outbound AI call initiated to ${phone} — "${instructions}"` : `Outbound AI call initiated to ${phone}`,
        outcome: "pending",
      })
    }
    return NextResponse.json({ callSid: call.sid, status: call.status })
  } catch (e: unknown) {
    return apiError(e)
  }
}
