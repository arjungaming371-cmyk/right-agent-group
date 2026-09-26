import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { promoteInstagramLead } from "@/lib/ig-promote"
import { isValidUUID } from "@/lib/lead-brain"

// POST /api/instagram/leads/[id]/promote — Convert to CRM Lead (2026-09-26).
//
//   Body: {
//     phone?:             string   // operator-entered or pre-filled from the
//                                  // auto-detected ig_phone_extracted
//     productInterest?:   string
//     notes?:             string
//     addToCallQueue?:    boolean  // push into the bulk dialer (opt-in)
//     sendWhatsAppLink?:  boolean  // default true — welcome + form link
//     channel?:           "phone" | "whatsapp_voice" | "auto"
//   }
//   → 200 { ok, lead: { id, name, phone, lead_code, is_social_prospect }, whatsappSent, queued }
//   → 409 { error: "phone_conflict", conflictLeadId } — the number already
//         belongs to another CRM lead. NEVER auto-merges: the operator must
//         decide (the other lead may be the SAME person, or the number may
//         have been typed by the wrong party — a human call, not a script's).
//
// All the hard guarantees (advisory-lock race safety, PII-safe collision
// handling, best-effort side effects) live in lib/ig-promote.ts so the
// webhook's auto-promoter and this endpoint behave IDENTICALLY.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireModuleOrRole(req, "instagram", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const { id } = await params
  if (!isValidUUID(id)) return NextResponse.json({ error: "invalid lead id" }, { status: 400 })

  const body = await req.json().catch(() => ({} as any))
  const sendWelcome = body?.sendWhatsAppLink !== false
  const addToCallQueue = body?.addToCallQueue === true
  const channel = ["phone", "whatsapp_voice", "auto"].includes(String(body?.channel)) ? String(body.channel) : "phone"

  // Branch scope: the operator may only promote prospects they can see.
  // (Promotion never moves branches — the row keeps the branch the webhook
  // stamped it with.)
  const scoped = await query(
    `SELECT id FROM leads WHERE id = $1 ${branchId ? "AND branch_id = $2" : ""} LIMIT 1`,
    branchId ? [id, branchId] : [id]
  )
  if (scoped.rows.length === 0) {
    return NextResponse.json({ error: "lead not found in your branch" }, { status: 404 })
  }

  const result = await promoteInstagramLead({
    leadId: id,
    phone: body?.phone || null,
    source: "operator",
    operatorEmail: session.email,
    productInterest: body?.productInterest || null,
    notes: body?.notes || null,
    sendWelcome,
    addToCallQueue,
    channel: channel as "phone" | "whatsapp_voice" | "auto",
  })

  if (!result.ok) {
    if (result.reason === "conflict") {
      return NextResponse.json(
        { error: "phone_conflict", message: result.error, conflictLeadId: result.conflictLeadId },
        { status: 409 }
      )
    }
    if (result.reason === "no_phone") {
      return NextResponse.json({ error: "phone required", message: result.error }, { status: 400 })
    }
    if (result.reason === "invalid_phone") {
      return NextResponse.json({ error: "valid phone required", message: result.error }, { status: 400 })
    }
    return NextResponse.json({ error: result.reason, message: result.error }, { status: result.reason === "not_found" ? 404 : 500 })
  }

  const lead = result.lead as any
  return NextResponse.json({
    ok: true,
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      lead_code: lead.lead_code || null,
      is_social_prospect: false,
    },
    whatsappSent: result.whatsappSent,
    queued: result.queued,
    alreadyPromoted: result.alreadyPromoted,
  })
}
