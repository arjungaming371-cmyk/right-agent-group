import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { makeCall as makeOutboundCall } from "@/lib/exotel"
import { requireRole } from "@/lib/auth"

// STEP 2: User explicitly confirms — THIS triggers the actual calls
export async function POST(req: NextRequest) {
  if (!(await requireRole(req, ["admin"]))) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { uploadId, leadIds } = await req.json()

  if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds array required" }, { status: 400 })
  }

  let called = 0
  let failed = 0

  for (const leadId of leadIds) {
    try {
      const { data: lead } = await db.from("leads").select("*").eq("id", leadId).single()
      if (!lead || !lead.phone) { failed++; continue }

      const call = await makeOutboundCall(lead.phone, lead.id, lead.language || "english")

      await db.from("voice_calls").insert({
        lead_id: lead.id,
        twilio_call_sid: call.sid,
        direction: "outbound",
        status: "initiated",
        language: lead.language || "english",
        phone: lead.phone,
      })

      await db.from("outbound_queue").update({ status: "called" }).eq("lead_id", lead.id)
      called++
    } catch (e) {
      console.error(`Failed to call lead ${leadId}:`, e)
      failed++
    }
  }

  if (uploadId) {
    await db.from("uploaded_files").update({ status: "done", processed: called }).eq("id", uploadId)
  }

  return NextResponse.json({ ok: true, called, failed })
}
