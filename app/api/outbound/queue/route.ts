import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { checkCallCompliance } from "@/lib/compliance"
import { normalizePhone, phoneLast10 } from "@/lib/phone"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

const LAST10_SQL = "right(regexp_replace(phone, '\\D', '', 'g'), 10)"
const QUEUE_CHANNELS = ["phone", "whatsapp_voice", "auto"]

// Batch-queue selected leads for the bulk dialer (the "Add to Call Queue"
// modal in Leads). Contract from the Outbound Bulk Calling plan:
//
//   POST /api/outbound/queue
//   {
//     leadIds: string[],                    // selected leads (branch-scoped)
//     channel?: "phone" | "whatsapp_voice" | "auto",
//     scheduledAt?: string | null,          // ISO timestamp or null = now
//     priority?: boolean,                   // true = dial before the backlog
//     skipRecentCalledHours?: number,       // default 24, 0 = off
//     language?: "auto" | "telugu" | "hindi" | "english"
//   }
//   → { ok, queuedCount, skippedDnd, skippedRecent, skippedDuplicate }
//
// Protections enforced HERE (queue time), in addition to the runner's own
// dial-time compliance gate — the suppression list can change between
// queueing and dialing, so BOTH gates stay fail-closed:
//   - DND / do-not-call leads are refused (with a count)
//   - a number already pending/dialing is not stacked (backed by the unique
//     partial index uq_outbound_queue_active_phone — the INSERT itself
//     loses the race safely and counts as a duplicate)
//   - a number dialed within the last N hours is skipped (default 24h)

type LeadRow = {
  id: string
  name: string | null
  phone: string | null
  whatsapp_number: string | null
  language: string | null
  product_interest: string | null
  branch_id: string | null
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const body = await req.json().catch(() => ({}))
  const leadIds: string[] = Array.isArray(body?.leadIds) ? body.leadIds.map((x: unknown) => String(x)).filter(Boolean) : []
  if (!leadIds.length) return NextResponse.json({ error: "leadIds required" }, { status: 400 })
  if (leadIds.length > 1000) return NextResponse.json({ error: "too many leads in one batch (max 1000)" }, { status: 400 })

  const channel = QUEUE_CHANNELS.includes(String(body?.channel)) ? String(body.channel) : "phone"
  const priority = body?.priority === true ? 100 : 0
  const skipRecentHours = Math.min(Math.max(Number(body?.skipRecentCalledHours ?? 24) || 0, 0), 168)
  const forceLanguage = ["telugu", "hindi", "english"].includes(String(body?.language)) ? String(body.language) : null
  let scheduledAt: Date | null = null
  if (body?.scheduledAt) {
    const d = new Date(String(body.scheduledAt))
    if (!isNaN(d.getTime())) scheduledAt = d
  }

  // 1) Load the selected leads, branch-scoped (null = HQ = everything).
  const params: unknown[] = [leadIds]
  if (branchId) {
    params.push(branchId)
  }
  const leadsRes = await query(
    `SELECT id, name, phone, whatsapp_number, language, product_interest, branch_id
       FROM leads
      WHERE id = ANY($1::uuid[]) ${branchId ? "AND branch_id = $2" : ""}`,
    params
  )
  const leads = leadsRes.rows as LeadRow[]

  // 2) Dedupe the SELECTION itself by last-10 digits — the same number
  //    entered twice (or present under two lead rows) must not queue twice.
  const byLast10 = new Map<string, LeadRow>()
  let skippedDuplicate = 0
  for (const lead of leads) {
    const target = normalizePhone(lead.whatsapp_number || lead.phone || "")
    if (!target) continue
    const key = phoneLast10(target)
    if (byLast10.has(key)) {
      skippedDuplicate++
      continue
    }
    byLast10.set(key, lead)
  }

  // 3) Batch pre-checks: numbers already pending/dialing, numbers called
  //    recently. Two grouped queries instead of two per lead.
  const keys = [...byLast10.keys()]
  const pendingSet = new Set<string>()
  const recentSet = new Set<string>()
  if (keys.length) {
    const pendingRes = await query(
      `SELECT DISTINCT ${LAST10_SQL} AS k FROM outbound_queue WHERE status IN ('pending','dialing') AND ${LAST10_SQL} = ANY($1)`,
      [keys]
    )
    for (const r of pendingRes.rows as { k: string }[]) pendingSet.add(r.k)
    if (skipRecentHours > 0) {
      const recentRes = await query(
        `SELECT DISTINCT ${LAST10_SQL} AS k FROM voice_calls
          WHERE direction = 'outbound' AND created_at > now() - ($2 || ' hours')::interval
            AND ${LAST10_SQL} = ANY($1)`,
        [keys, String(skipRecentHours)]
      )
      for (const r of recentRes.rows as { k: string }[]) recentSet.add(r.k)
    }
  }

  // 4) Insert with per-lead gates. The unique partial index is the final
  //    race guard — a concurrent insert from another operator lands as 23505.
  let queuedCount = 0
  let skippedDnd = 0
  let skippedRecent = 0

  for (const [key, lead] of byLast10) {
    const target = normalizePhone(lead.whatsapp_number || lead.phone || "")

    if (pendingSet.has(key)) {
      skippedDuplicate++
      continue
    }
    if (recentSet.has(key)) {
      skippedRecent++
      continue
    }

    // Queue-time compliance: only the REGULATORY blocks refuse queueing.
    // outside_window is fine here — scheduling a call for later is exactly
    // what the queue is for; the runner pauses/resumes around the window.
    const compliance = await checkCallCompliance({ leadId: lead.id, phone: target })
    if (!compliance.allowed && (compliance.code === "do_not_call" || compliance.code === "dnd_suppressed")) {
      skippedDnd++
      continue
    }

    try {
      await query(
        `INSERT INTO outbound_queue
           (lead_id, name, phone, language, product_interest, status, branch_id, channel, priority, scheduled_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)`,
        [
          lead.id,
          lead.name,
          target,
          forceLanguage || lead.language || "telugu",
          lead.product_interest,
          lead.branch_id || branchId,
          channel,
          priority,
          scheduledAt || new Date().toISOString(),
        ]
      )
      queuedCount++
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "23505") {
        skippedDuplicate++ // lost the anti-stacking race — exactly correct
        continue
      }
      throw e
    }
  }

  logAudit("outbound queue batch", session.email, {
    selected: leadIds.length, queued: queuedCount, skippedDnd, skippedRecent, skippedDuplicate, channel,
  })
  return NextResponse.json({ ok: true, queuedCount, skippedDnd, skippedRecent, skippedDuplicate })
}
