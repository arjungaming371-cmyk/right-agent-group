import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { makeCall as makeOutboundCall } from "@/lib/exotel"
import { requireRole } from "@/lib/auth"
import { sessionBranchId, checkQuota, recordUsage } from "@/lib/branches"
import { checkCallCompliance } from "@/lib/compliance"

// STEP 2: User explicitly confirms — THIS triggers the actual calls
export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)
  const { uploadId, leadIds } = await req.json()

  if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds array required" }, { status: 400 })
  }
  const quota = await checkQuota(branchId, "call")
  if (!quota.ok) return NextResponse.json({ error: quota.reason }, { status: 403 })

  let called = 0
  let failed = 0
  let skipped = 0

  for (const leadId of leadIds) {
    try {
      const { data: lead } = await db.from("leads").select("*").eq("id", leadId).single()
      if (!lead || !lead.phone) { failed++; continue }

      // Same compliance gate app/api/outbound/process/route.ts already
      // applies to its bulk dialer — this endpoint is the OTHER bulk-dial
      // path (triggered right after a CSV upload) and was missing it
      // entirely, meaning a DND-listed or outside-calling-window lead in an
      // uploaded CSV could get dialed with no check at all.
      const compliance = await checkCallCompliance({ leadId: lead.id, phone: lead.phone })
      if (!compliance.allowed) {
        await db.from("outbound_queue").update({ status: `skipped_${compliance.code}` }).eq("lead_id", lead.id)
        skipped++
        continue
      }

      const call = await makeOutboundCall(lead.phone, lead.id, lead.language || "telugu", undefined, branchId || lead.branch_id)

      await db.from("voice_calls").insert({
        lead_id: lead.id,
        twilio_call_sid: call.sid,
        direction: "outbound",
        status: "initiated",
        language: lead.language || "telugu",
        phone: lead.phone,
        branch_id: lead.branch_id || branchId,
      })
      const callBranch = lead.branch_id || branchId
      if (callBranch) recordUsage(callBranch, "call")

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

  return NextResponse.json({ ok: true, called, failed, skipped })
}
