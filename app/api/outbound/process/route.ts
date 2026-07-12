import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { makeCall } from "@/lib/exotel"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { concurrency = 1, limit = 10 } = await req.json().catch(() => ({}))

  const { data: pending } = await db.from("outbound_queue")
    .select("*")
    .eq("status", "pending")
    .limit(Math.min(limit, 50)) // max 50 at once for safety

  if (!pending || pending.length === 0) {
    return NextResponse.json({ called: 0, failed: 0, total: 0 })
  }

  let called = 0
  let failed = 0

  // Process in batches based on concurrency
  const batchSize = Math.max(1, Math.min(concurrency, 10))

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize)

    await Promise.allSettled(
      batch.map(async (item: any) => {
        try {
          // Get lead details for AI context
          let leadId = item.lead_id || null
          let phone = item.phone

          if (!leadId) {
            // Create lead if not exists
            const { data: lead } = await db.from("leads").insert({
              name: item.name, phone: item.phone,
              language: item.language || "english",
              product_interest: item.product_interest,
              notes: item.notes, source: "Queue", status: "new"
            }).select().single()
            leadId = lead?.id
          }

          const call = await makeCall(phone, leadId || "", item.language || "english")

          await db.from("voice_calls").insert({
            lead_id: leadId,
            twilio_call_sid: call.sid,
            direction: "outbound",
            status: "initiated",
            language: item.language || "english",
            phone,
          })

          await db.from("outbound_queue")
            .update({ status: "called" })
            .eq("id", item.id)

          called++
        } catch (e) {
          console.error(`Failed to call ${item.phone}:`, e)
          await db.from("outbound_queue")
            .update({ status: "failed" })
            .eq("id", item.id)
          failed++
        }
      })
    )

    // Small delay between batches to avoid overwhelming Exotel
    if (i + batchSize < pending.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  logAudit("outbound campaign triggered", session.email, { called, failed, total: pending.length, concurrency })
  return NextResponse.json({ called, failed, total: pending.length })
}
