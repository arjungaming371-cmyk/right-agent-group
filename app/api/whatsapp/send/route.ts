import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { query } from "@/lib/db"
import {
  sendWhatsAppText, sendWhatsAppReply, sendWhatsAppMedia,
  branchWhatsAppCtx, dndGate, type WhatsAppMediaKind,
} from "@/lib/whatsapp"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// Manual agent send — text or media, optionally quoting another message.
//
// Body:
//   to / leadId                        — recipient (both required for scoping)
//   message                            — text body (or media caption)
//   replyTo                            — optional wa_message_id to quote
//   mediaKind + mediaId + mediaName?   — send an uploaded media message
//                                        (mediaId from POST /api/whatsapp/upload)
//
// Returns { ok, id } where id is the Meta wa_message_id — the UI's optimistic
// bubble keys onto it so the real ✓/✓✓ ticks from Meta's status webhooks land
// on the message the agent actually sent.
export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { to, message, leadId, replyTo, mediaKind, mediaId, mediaName } = await req.json()
  if (!to) return NextResponse.json({ error: "to required" }, { status: 400 })
  if (!message && !mediaId) return NextResponse.json({ error: "message or media required" }, { status: 400 })
  if (mediaId && !["image", "video", "audio", "document", "sticker"].includes(mediaKind)) {
    return NextResponse.json({ error: "valid mediaKind required with mediaId" }, { status: 400 })
  }
  const branchId = sessionBranchId(session)

  // FIX (2026-09-20): branch-bound staff could write messages onto ANY
  // branch's lead by supplying its leadId (cross-tenant contamination).
  // Verify ownership before touching the lead's records.
  if (leadId && branchId) {
    const owner = await db.from("leads").select("branch_id").eq("id", leadId).single()
    if (!owner.data || owner.data.branch_id !== branchId) {
      return NextResponse.json({ error: "Lead not found in your branch" }, { status: 404 })
    }
  }

  // FIX (2026-09-20): manual business-initiated sends bypassed the
  // DND/opt-out gate — the ONLY ungated WhatsApp send path left. Replying to
  // a customer who said "stop messaging me" is exactly the TRAI-penalizable
  // contact the compliance module exists to prevent. (Inbound-triggered
  // auto-replies inside the 24h service window remain exempt by design.)
  const gate = await dndGate(to)
  if (gate && !gate.ok) {
    return NextResponse.json({ error: "DND_SUPPRESSED", message: gate.error }, { status: 403 })
  }

  // Branch-bound staff reply from their BRANCH's WABA number (falls back to
  // the company number when the branch has none).
  const waBranch = await branchWhatsAppCtx(branchId)

  // Text reply (optionally quoting), or media send — never both shapes at once.
  const result = mediaId
    ? await sendWhatsAppMedia(to, mediaKind as WhatsAppMediaKind, mediaId, {
        caption: message || undefined,
        filename: mediaName || undefined,
        quotedWaMessageId: replyTo || null,
      }, waBranch)
    : replyTo
      ? await sendWhatsAppReply(to, message, replyTo, waBranch)
      : await sendWhatsAppText(to, message, waBranch)

  if (!result.ok) {
    if (result.error && result.error.includes("not configured")) {
      return NextResponse.json(
        { error: "WHATSAPP_NOT_CONFIGURED", message: "WhatsApp Cloud API is not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env (see SETUP-GUIDE-CLOUD-API.md), or set the branch's own WhatsApp number in Branches." },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  const mediaFallback = mediaId
    ? { msg_type: String(mediaKind), media_id: String(mediaId), media_name: mediaName || null }
    : {}
  try {
    await db.from("whatsapp_messages").insert({
      lead_id: leadId ?? null, phone_number: to, direction: "outbound",
      content: message || "", status: "sent", branch_id: branchId,
      wa_message_id: result.id || null,
      quoted_wa_id: replyTo || null,
      ...mediaFallback,
    })
  } catch {
    // Pre-migration DB or shim hiccup: retry with legacy columns only.
    await db.from("whatsapp_messages").insert({
      lead_id: leadId ?? null, phone_number: to, direction: "outbound",
      content: message || "", status: "sent", branch_id: branchId,
    }).catch(() => {})
  }
  if (leadId) {
    const summary = mediaId ? `[${mediaKind} message] ${(message || "").slice(0, 100)}` : message.slice(0, 140)
    await db.from("comm_logs").insert({ lead_id: leadId, type: "whatsapp", summary, outcome: "sent" }).catch(() => {})
    // Outbound quoted rows cache the quoted text so the UI (and the customer's
    // own quote rendering) always has it — mirror of the inbound webhook logic.
    if (replyTo) {
      query(
        `UPDATE whatsapp_messages
            SET quoted_wa_id = $1,
                quoted_text  = COALESCE((SELECT content FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1), '[message]'),
                quoted_from  = (SELECT direction FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1)
          WHERE wa_message_id = $2`,
        [replyTo, result.id || ""]
      ).catch(() => {})
    }
  }
  return NextResponse.json({ ok: true, id: result.id || null })
}
