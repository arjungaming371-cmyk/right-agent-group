import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"
import { requireModuleOrRole, requireRole } from "@/lib/auth"
import { sessionBranchId, checkQuota, recordUsage } from "@/lib/branches"
import { logAudit } from "@/lib/audit"
import { checkCallCompliance, isWithinCallingWindow } from "@/lib/compliance"
import { getBulkDialer, BulkQueueRow, DialOutcome } from "@/lib/bulk-dialer"
import { placeOutboundCall } from "@/lib/outbound-dial"
import { getDialerSettings } from "@/lib/dialer-settings"
import { nextWindowStartMs } from "@/lib/dialer-logic"

// Shape of an outbound_queue row actually used by the dialer —
// replaces the previous untyped `item: any` without forcing `unknown`
// narrowing noise through the whole body.
type QueueRow = BulkQueueRow & {
  // 2026-09-26 bulk upgrade columns (migration 2026-09-26_bulk_queue_upgrade)
  channel?: string | null
  retry_count?: number | null
}

/**
 * Atomically claim pending rows for a dialer wave. Also re-claims rows
 * stuck in 'dialing' for >10 min (crashed run), so a crash can no longer
 * permanently orphan queue entries. Shared by the one-shot dialer AND the
 * bulk campaign runner (lib/bulk-dialer.ts).
 *
 * FIX (2026-09-20): ATOMIC CLAIM. The old flow was SELECT pending rows →
 * dial → mark 'called'. Two operators (or a double-click / two tabs / the
 * 4s dashboard poller) could run this route simultaneously and BOTH read
 * the same batch — every queued customer got two simultaneous sales calls.
 * Claim rows atomically first (FOR UPDATE SKIP LOCKED); only claimed rows
 * are dialed.
 */
async function claimPendingRows(branchId: string | null, limit: number): Promise<QueueRow[]> {
  // 2026-09-26 bulk upgrade: only DUE rows (scheduled_at <= now()) — the old
  // query only ORDERED BY scheduled_at, so "Schedule for Later" rows would
  // have dialed the moment they were queued. Priority rows dial first.
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
     RETURNING id, lead_id, phone, name, language, product_interest, notes, branch_id, channel, retry_count`,
    [branchId, limit]
  ).catch(async (e) => {
    if (!((e as { code?: unknown })?.code === "42703")) throw e // claimed_at column not added yet → claim without reaper support
    return query(
      `UPDATE outbound_queue SET status = 'dialing'
       WHERE id IN (
         SELECT id FROM outbound_queue
         WHERE status = 'pending' AND scheduled_at <= now() AND ($1::uuid IS NULL OR branch_id = $1)
         ORDER BY priority DESC, scheduled_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, lead_id, phone, name, language, product_interest, notes, branch_id, channel, retry_count`,
      [branchId, limit]
    )
  })
  return claim.rows as QueueRow[]
}

/**
 * Dial ONE claimed queue row. Returns the outcome instead of mutating
 * counters so both the one-shot loop and the bulk campaign runner can tally
 * independently. Business rejections are returned as "skipped"/"failed" —
 * only an unexpected throw propagates (the campaign runner counts it as a
 * failed row and carries on; the one-shot path catches it the same way).
 */
async function dialQueueRow(item: QueueRow, branchId: string | null): Promise<DialOutcome> {
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

    // Unattended dialer — this is exactly the code path a
    // do_not_call/DND/outside-window lead must never reach. Skip
    // (not "failed" — nothing went wrong, we're deliberately not
    // calling), with the specific reason recorded on the queue row.
    const compliance = await checkCallCompliance({ leadId, phone })
    if (!compliance.allowed) {
      if (compliance.code === "outside_window") {
        // AUTO-PAUSE (bulk plan Feature 2): the window closed mid-campaign —
        // RE-SCHEDULE for the next window open instead of terminally
        // skipping. The old behaviour permanently LOST every row it caught
        // past 19:00; now the campaign resumes by itself at 8:00 IST.
        const nextOpen = new Date(nextWindowStartMs(Date.now()))
        await db.from("outbound_queue")
          .update({ status: "pending", scheduled_at: nextOpen.toISOString(), claimed_at: null })
          .eq("id", item.id)
        return "skipped" // deferred, not lost
      }
      await db.from("outbound_queue").update({ status: `skipped_${compliance.code}` }).eq("id", item.id)
      return "skipped"
    }

    // DUAL CHANNEL (bulk plan Feature 1): row.channel picks the network —
    // 'phone' (Exotel), 'whatsapp_voice' (Meta Business Calling WebRTC),
    // 'auto' (WhatsApp for callback-eligible leads, else phone). Previously
    // Exotel-only. lib/outbound-dial writes the voice_calls row BEFORE the
    // phone rings and throws DialError with Meta's raw rejection text.
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

    await db.from("outbound_queue")
      .update({ status: "called", call_sid: placed.callSid, called_at: new Date().toISOString() })
      .eq("id", item.id)

    return "called"
  } catch (e) {
    console.error(`Failed to call ${item.phone}:`, e)
    await db.from("outbound_queue")
      .update({ status: "failed" })
      .eq("id", item.id)
      .catch(() => {})
    return "failed"
  }
}

/** Which runner instance this session talks to: its own branch, or "hq". */
function branchKey(branchId: string | null): string {
  return branchId || "hq"
}

/** Real deps for this app — wires the runner to DB + Exotel. */
function bulkDialerDeps(branchId: string | null) {
  return {
    claimBatch: (size: number) => claimPendingRows(branchId, size),
    dialRow: (row: QueueRow) => dialQueueRow(row, branchId),
    quotaOk: async () => {
      const quota = await checkQuota(branchId, "call")
      return { ok: quota.ok, reason: quota.reason }
    },
    maxConcurrency: 10,
    pauseMs: 500,
    log: (msg: string) => console.log(`[bulk-dialer] ${msg}`),
  }
}

/**
 * GET — live bulk-campaign status for the caller's branch scope:
 * the runner snapshot (running/called/failed/skipped/current phones) plus
 * queue counts grouped by status straight from the DB (source of truth,
 * so the dashboard can also show rows claimed by a crashed + reaped run).
 */
export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const run = getBulkDialer(branchKey(branchId), bulkDialerDeps(branchId)).status()
  const counts = await query(
    `SELECT status, count(*)::int AS n FROM outbound_queue
     WHERE ($1::uuid IS NULL OR branch_id = $1)
     GROUP BY status`,
    [branchId]
  ).catch(() => ({ rows: [] as { status: string; n: number }[] }))

  const queue: Record<string, number> = {}
  for (const r of counts.rows as { status: string; n: number }[]) queue[r.status] = r.n

  return NextResponse.json({ run, queue })
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  // The dialer only ever works the session's own branch queue (null = HQ = all).
  const branchId = sessionBranchId(session)

  // PAUSE/RESUME (bulk plan Feature 2): outside the calling window the
  // runner refuses to claim anything and rows STAY pending — a running or
  // starting campaign simply cannot fire, and it resumes by itself at the
  // next window open. Nothing is skipped, nothing is lost.
  if (!(await isWithinCallingWindow())) {
    return NextResponse.json({
      paused: true,
      reason: "Outside the permitted calling window — queue paused, rows stay pending and resume automatically",
    })
  }
  const dialer = getBulkDialer(branchKey(branchId), bulkDialerDeps(branchId))

  // ---- Campaign protocol (bulk calling console) --------------------------
  // { action: "start", concurrency? }  → drain the ENTIRE pending queue in
  //   the background; returns immediately, progress via GET.
  if (body.action === "start") {
    // Concurrency default comes from the persisted dialer settings (the
    // Call Queue slider) — live for every campaign without a redeploy.
    const settings = await getDialerSettings()
    const res = await dialer.start({ concurrency: body.concurrency ?? settings.concurrency })
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 409 })
    logAudit("bulk campaign started", session.email, { branchId, concurrency: dialer.status().concurrency })
    return NextResponse.json({ started: true, runId: res.runId, concurrency: dialer.status().concurrency })
  }

  // { action: "stop" } → finish the in-flight wave, leave the rest pending.
  if (body.action === "stop") {
    const stopped = dialer.stop()
    if (stopped) logAudit("bulk campaign stop requested", session.email, { branchId })
    return NextResponse.json({ ok: true, stopped })
  }

  // { action: "reset-failed" } → push failed rows back to 'pending' so a
  // campaign (or one-shot dialer) tries them again — the "Retry failed"
  // button. Skipped_* rows are deliberately NOT retried: DND/outside-window
  // are compliance decisions, not glitches.
  if (body.action === "reset-failed") {
    const res = await query(
      `UPDATE outbound_queue SET status = 'pending', claimed_at = NULL
       WHERE status = 'failed' AND ($1::uuid IS NULL OR branch_id = $1)`,
      [branchId]
    )
    const reset = res.rowCount ?? 0
    if (reset > 0) logAudit("bulk queue failed rows reset", session.email, { branchId, reset })
    return NextResponse.json({ ok: true, reset })
  }

  // ---- Legacy one-shot dial ({ concurrency, limit }) ---------------------
  // Kept for the "dial exactly N" mode and any existing callers. Same claim
  // + dial machinery as the campaign runner.
  const settings = await getDialerSettings()
  const concurrency = Math.max(1, Math.min(10, Number(body.concurrency) || settings.concurrency))
  const limit = Math.min(Number(body.limit) || 10, 50)

  const pending = await claimPendingRows(branchId, limit)

  if (!pending || pending.length === 0) {
    return NextResponse.json({ called: 0, failed: 0, total: 0 })
  }
  // Per-branch monthly cap still applies to the unattended dialer.
  const quota = await checkQuota(branchId, "call")
  if (!quota.ok) {
    // FIX (2026-09-26): the rows were ALREADY claimed ('dialing') above —
    // a 403 here used to leave them stranded in 'dialing' until the 10-min
    // reaper re-claimed them, so an operator hitting the cap saw their whole
    // queue vanish for 10 minutes. Release them back to 'pending' first.
    // (claimed_at left as-is is fine: the claim query matches on status.)
    await query(
      `UPDATE outbound_queue SET status = 'pending' WHERE id = ANY($1::uuid[])`,
      [pending.map((p) => p.id)]
    ).catch(() => {})
    return NextResponse.json({ error: quota.reason }, { status: 403 })
  }

  let called = 0
  let failed = 0

  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency)

    await Promise.allSettled(
      batch.map(async (item: QueueRow) => {
        const outcome = await dialQueueRow(item, branchId)
        if (outcome === "called") called++
        else if (outcome === "skipped") { /* tallied on the row, not a failure */ }
        else failed++
      })
    )

    // Small delay between batches to avoid overwhelming Exotel
    if (i + concurrency < pending.length) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  logAudit("outbound campaign triggered", session.email, { called, failed, total: pending.length, concurrency })
  return NextResponse.json({ called, failed, total: pending.length })
}
