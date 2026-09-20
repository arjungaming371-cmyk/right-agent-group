import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { makeCall } from "@/lib/exotel"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"
import { requireRole } from "@/lib/auth"
import { sessionBranchId, checkQuota, recordUsage } from "@/lib/branches"
import { logAudit } from "@/lib/audit"
import { checkCallCompliance } from "@/lib/compliance"

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { concurrency = 1, limit = 10 } = await req.json().catch(() => ({}))
  // The dialer only ever works the session's own branch queue (null = HQ = all).
  const branchId = sessionBranchId(session)

  // RACE FIX (2026-09): the old SELECT-pending → dial → mark-called pattern
  // let two concurrent triggers (manual click + cron, or a double-click) read
  // the same 'pending' rows and dial REAL customers twice. Rows are now
  // claimed atomically with FOR UPDATE SKIP LOCKED — each row can only ever
  // be claimed by one worker. Rows left 'dialing' by a crashed worker are
  // reclaimed after 15 minutes.
  await query(
    `UPDATE outbound_queue SET status = 'pending', claimed_at = NULL
      WHERE status = 'dialing' AND claimed_at IS NOT NULL
        AND claimed_at < now() - interval '15 minutes'`
  )
  const claimed = await query(
    `UPDATE outbound_queue SET status = 'dialing', claimed_at = now()
      WHERE id IN (
        SELECT id FROM outbound_queue
         WHERE status = 'pending' ${branchId ? "AND branch_id = $1" : ""}
         ORDER BY id
         LIMIT $${branchId ? 2 : 1}
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    branchId ? [branchId, Math.min(limit, 50)] : [Math.min(limit, 50)]
  )
  const pending: any[] = claimed.rows

  if (pending.length === 0) {
    return NextResponse.json({ called: 0, failed: 0, total: 0 })
  }
  // Per-branch monthly cap still applies to the unattended dialer.
  const quota = await checkQuota(branchId, "call")
  if (!quota.ok) {
    // Release THIS run's claimed rows back to the queue so the next run picks
    // them up immediately instead of waiting out the 15-minute stale window.
    await query(
      `UPDATE outbound_queue SET status = 'pending', claimed_at = NULL
        WHERE id = ANY($1::uuid[])`,
      [pending.map((r: any) => r.id)]
    )
    return NextResponse.json({ error: quota.reason }, { status: 403 })
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
          let phone = normalizePhone(item.phone)

          if (!leadId) {
            // Find-or-create — match on last-10 digits so a queue row for a
            // number already in leads (any format) reuses that lead.
            const existing = await query(`SELECT id FROM leads WHERE ${PHONE_MATCH_SQL} LIMIT 1`, [phoneLast10(phone)])
            leadId = existing.rows[0]?.id || null
            if (!leadId) {
              const { data: lead } = await db.from("leads").insert({
                name: item.name, phone,
                language: item.language || "telugu",
                product_interest: item.product_interest,
                notes: item.notes, source: "Queue", status: "new",
                branch_id: item.branch_id || branchId,
              }).select().single()
              leadId = lead?.id
            }
          }

          // Unattended bulk dialer — this is exactly the code path a
          // do_not_call/DND/outside-window lead must never reach. Skip
          // (not "failed" — nothing went wrong, we're deliberately not
          // calling), with the specific reason recorded on the queue row.
          const compliance = await checkCallCompliance({ leadId, phone })
          if (!compliance.allowed) {
            await db.from("outbound_queue").update({ status: `skipped_${compliance.code}` }).eq("id", item.id)
            return
          }

          const call = await makeCall(phone, leadId || "", item.language || "telugu", undefined, item.branch_id || branchId)

          await db.from("voice_calls").insert({
            lead_id: leadId,
            twilio_call_sid: call.sid,
            direction: "outbound",
            status: "initiated",
            language: item.language || "telugu",
            phone,
            branch_id: item.branch_id || branchId,
          })
          const callBranch = item.branch_id || branchId
          if (callBranch) recordUsage(callBranch, "call")

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
