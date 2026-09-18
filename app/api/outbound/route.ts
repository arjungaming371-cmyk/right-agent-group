import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db } from "@/lib/db"
import { makeCall } from "@/lib/exotel"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId, checkQuota, recordUsage } from "@/lib/branches"
import { checkCallCompliance } from "@/lib/compliance"
import { normalizePhone } from "@/lib/phone"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)
  let q = db.from("outbound_queue").select("*")
  if (branchId) q = q.eq("branch_id", branchId)
  const { data } = await q.order("created_at", { ascending: false }).limit(200)
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  // Both modes below either queue contacts for a real outbound call campaign
  // or trigger one immediately — same privilege level as /api/calls POST.
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  // Multi-branch: everything queued/called here belongs to the session's
  // active branch (null for HQ admins viewing the whole company).
  const branchId = sessionBranchId(session)

  // Batch mode: { contacts: [...] } — queue without calling
  if (body.contacts && Array.isArray(body.contacts)) {
    let queued = 0
    for (const contact of body.contacts) {
      if (!contact.phone) continue
      contact.phone = normalizePhone(contact.phone)
      try {
        // Dedupe — one lead per phone
        const { data: existing } = await db.from("leads").select("id").eq("phone", contact.phone).single()
        let leadId = existing?.id

        if (!leadId) {
          const { data: lead } = await db.from("leads").insert({
            name: contact.name, phone: contact.phone,
            language: contact.language || "telugu",
            product_interest: contact.product_interest,
            source: "CSV Upload", status: "new",
            branch_id: branchId,
          }).select().single()
          leadId = lead?.id
        }

        await db.from("outbound_queue").insert({
          name: contact.name, phone: contact.phone,
          language: contact.language || "telugu",
          product_interest: contact.product_interest,
          lead_id: leadId || null,
          status: "pending",
          branch_id: branchId,
        })
        queued++
      } catch (e) {
        console.error(`Failed to queue contact ${contact.phone}:`, e)
      }
    }
    return NextResponse.json({ ok: true, queued })
  }

  // Single contact mode: { name, phone, language, ... } — call immediately
  const { name, language, product_interest, notes } = body
  const phone = normalizePhone(body.phone)
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 })
  const compliance = await checkCallCompliance({ phone })
  if (!compliance.allowed) {
    return NextResponse.json({ error: compliance.reason }, { status: 403 })
  }
  const quota = await checkQuota(branchId, "call")
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason }, { status: 403 })
  }

  try {
    // Dedupe
    const { data: existing } = await db.from("leads").select("id").eq("phone", phone).single()
    let leadId = existing?.id

    if (!leadId) {
      const { data: lead } = await db.from("leads").insert({
        name: name || "Unknown", phone,
        language: language || "telugu",
        product_interest, notes,
        source: "Manual Queue", status: "new",
        branch_id: branchId,
      }).select().single()
      leadId = lead?.id
    }

    // Trigger call immediately
    const call = await makeCall(phone, leadId || "", language || "telugu", undefined, branchId)

    await db.from("voice_calls").insert({
      lead_id: leadId, twilio_call_sid: call.sid,
      direction: "outbound", status: "initiated",
      language: language || "telugu", phone,
      branch_id: branchId,
    })
    if (branchId) recordUsage(branchId, "call")

    await db.from("outbound_queue").insert({
      name, phone, language: language || "telugu",
      product_interest, notes, lead_id: leadId,
      status: "called",
      branch_id: branchId,
    })

    return NextResponse.json({ ok: true, callSid: call.sid })
  } catch (e: any) {
    return apiError(e)
  }
}
