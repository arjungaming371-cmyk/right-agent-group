import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { makeCall } from "@/lib/exotel"
import { requireRole } from "@/lib/auth"
import { checkCallCompliance } from "@/lib/compliance"

export async function GET() {
  const { data } = await db.from("outbound_queue").select("*").order("created_at", { ascending: false }).limit(200)
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  // Both modes below either queue contacts for a real outbound call campaign
  // or trigger one immediately — same privilege level as /api/calls POST.
  if (!(await requireRole(req, ["admin", "agent"]))) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()

  // Batch mode: { contacts: [...] } — queue without calling
  if (body.contacts && Array.isArray(body.contacts)) {
    let queued = 0
    for (const contact of body.contacts) {
      if (!contact.phone) continue
      try {
        // Dedupe — one lead per phone
        const { data: existing } = await db.from("leads").select("id").eq("phone", contact.phone).single()
        let leadId = existing?.id

        if (!leadId) {
          const { data: lead } = await db.from("leads").insert({
            name: contact.name, phone: contact.phone,
            language: contact.language || "english",
            product_interest: contact.product_interest,
            source: "CSV Upload", status: "new"
          }).select().single()
          leadId = lead?.id
        }

        await db.from("outbound_queue").insert({
          name: contact.name, phone: contact.phone,
          language: contact.language || "english",
          product_interest: contact.product_interest,
          lead_id: leadId || null,
          status: "pending",
        })
        queued++
      } catch {}
    }
    return NextResponse.json({ ok: true, queued })
  }

  // Single contact mode: { name, phone, language, ... } — call immediately
  const { name, phone, language, product_interest, notes } = body
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 })
  const compliance = await checkCallCompliance({ phone })
  if (!compliance.allowed) {
    return NextResponse.json({ error: compliance.reason }, { status: 403 })
  }

  try {
    // Dedupe
    const { data: existing } = await db.from("leads").select("id").eq("phone", phone).single()
    let leadId = existing?.id

    if (!leadId) {
      const { data: lead } = await db.from("leads").insert({
        name: name || "Unknown", phone,
        language: language || "english",
        product_interest, notes,
        source: "Manual Queue", status: "new"
      }).select().single()
      leadId = lead?.id
    }

    // Trigger call immediately
    const call = await makeCall(phone, leadId || "", language || "english")

    await db.from("voice_calls").insert({
      lead_id: leadId, twilio_call_sid: call.sid,
      direction: "outbound", status: "initiated",
      language: language || "english", phone,
    })

    await db.from("outbound_queue").insert({
      name, phone, language: language || "english",
      product_interest, notes, lead_id: leadId,
      status: "called",
    })

    return NextResponse.json({ ok: true, callSid: call.sid })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
