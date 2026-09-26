import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { sessionBranchId, checkQuota, recordUsage } from "@/lib/branches"
import { logAudit } from "@/lib/audit"
import { checkCallCompliance, isWithinCallingWindow } from "@/lib/compliance"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"
import { placeOutboundCall, DialError } from "@/lib/outbound-dial"
import { getDialerSettings } from "@/lib/dialer-settings"
import { nextWindowStartMs } from "@/lib/dialer-logic"

// The unattended bulk dialer. POST claims a batch of DUE queue rows
// atomically and dials each through the shared dual-channel leg.
//
// 2026-09-26 bulk upgrade (see the Outbound Bulk Calling plan):
//   PAUSE/RESUME, not terminal skip — if the calling window is closed the
//   runner refuses to claim and reports { paused: true }; rows STAY pending
//   and the campaign resumes by itself on the next trigger after opening
//   time. The old behaviour terminally skipped every row it caught outside
//   the window — a 100-lead campaign started at 18:50 silently lost
//   everything past 19:00 forever. A row that ages past the window MID-batch
//   is re-scheduled to the next window open instead of being skipped.
//   SCHEDULED AT LAST — the claim now filters scheduled_at <= now(); the old
//   query only ORDERED BY scheduled_at, so "Schedule for Later" rows would
//   have dialed immediately the moment the scheduler UI existed.
//   PRIORITY — higher priority rows dial first within due rows (ORDER BY
//   priority DESC, scheduled_at ASC).
//   DUAL CHANNEL — row.channel: 'phone' (Exotel), 'whatsapp_voice' (Meta
//   WebRTC via the shared leg), 'auto' (WhatsApp callback-eligible leads,
//   else phone). Previously Exotel-only.
//   LIVE CONCURRENCY — read from dialer_settings every invocation so the
//   dashboard slider is genuinely on-the-fly (the old per-request
//   concurrency param died with each POST, and the UI's max of 20 never
//   matched the route's cap of 10 — both are clamped 1-10 now).

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { limit = 25 } = await req.json().catch(() => ({}))
  // The dialer only ever works the session's own branch queue (null = HQ = all).
  const branchId = sessionBranchId(session)

  // PAUSE CHECK — before claiming anything. Pending rows are left untouched
  // so the same campaign auto-resumes when the window re-opens (8:00 IST by
  // default; dashboard-configurable via compliance_settings).
  if (!(await isWithinCallingWindow())) {
    return NextResponse.json({
      paused: true,
      called: 0,
      failed: 0,
      total: 0,
      reason: "Outside the permitted calling window — queue paused, rows stay pending and resume automatically",
    })
  }

  // Shape of an outbound_queue row actually used by the dialer loop below.
  type QueueRow = {
    id: string
    lead_id: string | null
    phone: string
    name: string | null
    language: string | null
    product_interest: string | null
    notes: string | null
    branch_id: string | null
    channel: string | null
    retry_count: number | null
  }

  // ATOMIC CLAIM (2026-09-20): FOR UPDATE SKIP LOCKED so two operators /
  // tabs / pollers can never both dial the same customer. 2026-09-26: only
  // DUE rows (scheduled_at <= now()), priority first.
  const settings = await getDialerSettings()
  const claimLimit = Math.min(Number(limit) || 25, 50)
  const claim = await query(
    `UPDATE outbound_queue SET status = 'dialing', claimed_at = now()
     WHERE id IN (
       SELECT id FROM outbound_queue
       WHERE (status = 'pending' OR (status = 'dialing' AND claimed_at IS NOT NULL AND claimed_at < now() - interval '10 minutes'))
         AND scheduled_at <= now()
         AND ($1::uuid IS NULL OR branch_id = $1)
       ORDER BY priority DESC, scheduled_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [branchId, claimLimit]
  ).catch(async (e) => {
    if (!((e as { code?: unknown })?.code === "42703")) throw e // claimed_at column not added yet → claim without reaper support
    return query(
      `UPDATE outbound_queue SET status = 'dialing'
       WHERE id IN (
         SELECT id FROM outbound_queue
         WHERE status = 'pending' AND scheduled_at <= now() AND ($1::uuid IS NULL OR branch_id = $1)
         ORDER BY priority DESC, scheduled_at ASC
         LIMIT $2
       )
       RETURNING *`,
      [branchId, claimLimit]
    )
  })
  const pending = claim.rows as QueueRow[]

  if (!pending || pending.length === 0) {
    return NextResponse.json({ called: 0, failed: 0, skipped: 0, total: 0, paused: false, concurrency: settings.concurrency })
  }
  // Per-branch monthly cap still applies to the unattended dialer.
  const quota = await checkQuota(branchId, "call")
  if (!quota.ok) {
    // Release the claims — a quota abort must not orphan rows in 'dialing'.
    await query(
      `UPDATE outbound_queue SET status = 'pending', claimed_at = NULL
        WHERE id = ANY($1::uuid[]) AND status = 'dialing'`,
      [pending.map((p) => p.id)]
    ).catch(() => {})
    return NextResponse.json({ error: quota.reason }, { status: 403 })
  }

  let called = 0
  let failed = 0
  let deferred = 0

  // Process in batches based on the PERSISTED concurrency (1-10, live from
  // the dashboard settings).
  const batchSize = settings.concurrency

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize)

    await Promise.allSettled(
      batch.map(async (item: QueueRow) => {
        try {
          // Get lead details for AI context
          let leadId = item.lead_id || null
          const phone = normalizePhone(item.phone)

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
          // do_not_call/DND lead must never reach. Terminal skip (recorded
          // with the specific reason). outside_window is NOT terminal
          // anymore — handled below with a re-schedule (auto-pause).
          const compliance = await checkCallCompliance({ leadId, phone })
          if (!compliance.allowed) {
            if (compliance.code === "outside_window") {
              // Window closed mid-batch → re-schedule for the next opening
              // instead of terminally skipping (auto-resume, see header).
              const nextOpen = new Date(nextWindowStartMs(Date.now()))
              await db.from("outbound_queue")
                .update({ status: "pending", scheduled_at: nextOpen.toISOString(), claimed_at: null })
                .eq("id", item.id)
              deferred++
              return
            }
            await db.from("outbound_queue").update({ status: `skipped_${compliance.code}` }).eq("id", item.id)
            return
          }

          // Dual-channel dial through the shared leg (voice_calls row is
          // written inside, BEFORE the phone rings).
          const requested = item.channel === "whatsapp_voice" ? "whatsapp" : item.channel === "auto" ? "auto" : "phone"
          const placed = await placeOutboundCall({
            phone,
            leadId,
            language: item.language || "telugu",
            requested,
            branchId: item.branch_id || branchId,
          })

          const callBranch = item.branch_id || branchId
          if (callBranch) recordUsage(callBranch, "call")

          // 'called' = dial attempt placed (terminal outcome arrives later
          // via the status webhooks, which drive the auto-retry re-queue).
          await db.from("outbound_queue")
            .update({ status: "called", call_sid: placed.callSid, called_at: new Date().toISOString() })
            .eq("id", item.id)

          called++
        } catch (e) {
          const detail = e instanceof DialError ? `${e.message}${e.hint ? ` (${e.hint})` : ""}` : e instanceof Error ? e.message : String(e)
          console.error(`Failed to call ${item.phone}:`, detail)
          await db.from("outbound_queue")
            .update({ status: "failed" })
            .eq("id", item.id)
          failed++
        }
      })
    )

    // Small delay between batches to avoid overwhelming the provider.
    if (i + batchSize < pending.length) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  logAudit("outbound campaign triggered", session.email, {
    called, failed, deferred, total: pending.length, concurrency: batchSize,
  })
  return NextResponse.json({ called, failed, deferred, total: pending.length, paused: false, concurrency: batchSize })
}
