import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { branchWhatsAppCtx, requestCallPermission, getCallPermission, dndGate } from "@/lib/whatsapp"
import { toWaId } from "@/lib/outbound-dial"

export const dynamic = "force-dynamic"

// Call-permission requests — the explicit gate for business-initiated
// WhatsApp calls (Meta: Calling → User call permissions).
//
// A lead who never called our WhatsApp number cannot be rung until they
// GRANT call permission. The flow this route drives:
//
//   POST /api/whatsapp/call-permission { leadId, note? }
//     → interactive "call_permission_request" (FREE-FORM, so Meta only
//       delivers it inside the 24h customer-service window — the lead must
//       have messaged us; outside it Meta refuses with 131047 and the raw
//       error text is surfaced to the operator)
//     → the lead sees Allow / Don't allow in WhatsApp
//     → their tap arrives on /api/whatsapp as interactive
//       "call_permission_reply" (logged on the chat + comm_logs, never
//       answered by Priya)
//     → the dial route / WhatsApp Calls tab can then ring them (temporary
//       permission; permanent when they granted it from our profile)
//
//   GET /api/whatsapp/call-permission?leadId=…
//     → live probe of Meta's /call_permissions for that lead —
//       { status: no_permission | temporary | permanent, canStartCall,
//         canSendRequest } — used to label the row BEFORE trying to dial.
//
// Both legs are business-initiated WhatsApp activity → DND/opt-out gated
// (fail-closed), same as every template / manual send.

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "branch_manager", "viewer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const leadId = req.nextUrl.searchParams.get("leadId") || ""
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 })

  const { data: lead } = await db
    .from("leads")
    .select("id, phone, whatsapp_number, branch_id")
    .eq("id", leadId)
    .single()
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 })
  if (branchId && lead.branch_id && lead.branch_id !== branchId) {
    return NextResponse.json({ error: "lead belongs to another branch" }, { status: 403 })
  }

  const phone = String(lead.whatsapp_number || lead.phone || "")
  const to = toWaId(phone)
  if (!to) return NextResponse.json({ error: "lead has no WhatsApp-reachable number" }, { status: 400 })

  const perm = await getCallPermission(to, await branchWhatsAppCtx(branchId || lead.branch_id || null))
  if (!perm.ok) return NextResponse.json({ error: perm.error || "permission probe failed" }, { status: 502 })
  return NextResponse.json({
    ok: true,
    leadId,
    status: perm.status,
    canStartCall: !!perm.canStartCall,
    canSendRequest: !!perm.canSendRequest,
  })
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  let body: { leadId?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const leadId = String(body?.leadId || "").trim()
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 })
  const note = String(body?.note || "").trim().slice(0, 500)

  const { data: lead } = await db
    .from("leads")
    .select("id, name, phone, whatsapp_number, branch_id")
    .eq("id", leadId)
    .single()
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 })
  if (branchId && lead.branch_id && lead.branch_id !== branchId) {
    return NextResponse.json({ error: "lead belongs to another branch" }, { status: 403 })
  }

  const phone = String(lead.whatsapp_number || lead.phone || "")
  const to = toWaId(phone)
  if (!to) return NextResponse.json({ error: "lead has no WhatsApp-reachable number" }, { status: 400 })

  // Business-initiated message → DND/opt-out gate, fail-closed.
  const gate = await dndGate(phone)
  if (gate && !gate.ok) {
    return NextResponse.json({ error: "DND_SUPPRESSED", message: gate.error }, { status: 403 })
  }

  const waBranch = await branchWhatsAppCtx(branchId || lead.branch_id || null)
  const text = note
    ? `Hi ${lead.name || "there"}! ${note} Tap Allow so our AI assistant Priya can call you directly on WhatsApp when there's an update on your enquiry.`
    : `Hi ${lead.name || "there"}! May we call you on WhatsApp to discuss your loan enquiry? Tap Allow so our AI assistant Priya can reach you directly.`
  const result = await requestCallPermission(to, text, waBranch)
  if (!result.ok) {
    // Meta's raw rejection verbatim — usually 131047 (outside the 24h
    // window for a free-form request) or calling not enabled on the number.
    return NextResponse.json({ error: result.error || "Meta rejected the permission request" }, { status: 502 })
  }

  // Persist the request the same way a manual agent send is persisted, so
  // it shows in the chat and on the lead's timeline. The customer's ANSWER
  // arrives later as call_permission_reply (webhook) and updates the chat.
  try {
    await db.from("whatsapp_messages").insert({
      lead_id: leadId, phone_number: phone, direction: "outbound",
      content: text, status: "sent", branch_id: branchId || null,
      wa_message_id: result.id || null,
    })
  } catch {
    // Pre-migration DB or shim hiccup: retry with legacy columns only.
    await db.from("whatsapp_messages").insert({
      lead_id: leadId, direction: "outbound",
      content: text, status: "sent",
    }).catch(() => {})
  }
  await db.from("comm_logs").insert({
    lead_id: leadId,
    type: "whatsapp",
    summary: `Call-permission request sent to ${phone} — awaiting the customer's Allow tap`,
    outcome: "sent",
  }).catch(() => {})

  console.log(`🔐 WhatsApp call-permission request sent lead=${leadId} to=***${to.slice(-4)}${branchId ? ` branch=${branchId}` : ""}`)
  return NextResponse.json({ ok: true, id: result.id || null })
}
