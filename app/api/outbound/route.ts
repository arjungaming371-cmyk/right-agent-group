import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db, query } from "@/lib/db"
import { makeCall } from "@/lib/exotel"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId, checkQuota, recordUsage } from "@/lib/branches"
import { checkCallCompliance } from "@/lib/compliance"
import { assertNoActiveDial } from "@/lib/outbound-dial"
import { sanitizeText } from "@/lib/api-route"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"
import { sanitizeCustomFields } from "@/lib/script-studio"

// "What should Priya talk about?" — the operator's agenda for this campaign.
// Same field, same cap, as /api/calls/dial's instructions. Stamped on every
// queued row; the bulk runner forwards it to placeOutboundCall({instructions})
// so each dialed call's voice_calls row carries it for /api/calls/turn.
function campaignTalkingPoints(v: unknown): string | null {
  return sanitizeText(v, 1000) || null
}

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  // ?summary=1 → status counts for the WHOLE queue (no 200-row cap).
  // The bulk calling console shows totals like "5 pending · 120 called";
  // counting them client-side from the capped row list would under-count
  // any CSV bigger than the list window.
  if (req.nextUrl.searchParams.get("summary")) {
    const res = await query(
      `SELECT status, count(*)::int AS n FROM outbound_queue
       WHERE ($1::uuid IS NULL OR branch_id = $1)
       GROUP BY status`,
      [branchId]
    ).catch(() => ({ rows: [] as { status: number | string; n: number }[] }))
    const counts: Record<string, number> = {}
    let total = 0
    for (const r of res.rows as { status: number | string; n: number }[]) {
      counts[r.status] = r.n
      total += r.n
    }
    return NextResponse.json({ counts, total })
  }

  // ?count=pending → sidebar badge (one tiny query, no rows pulled).
  if (req.nextUrl.searchParams.get("count") === "pending") {
    const res = await query(
      `SELECT count(*)::int AS n FROM outbound_queue WHERE status = 'pending' AND ($1::uuid IS NULL OR branch_id = $1)`,
      [branchId]
    ).catch(() => ({ rows: [{ n: 0 }] }))
    return NextResponse.json({ count: (res.rows[0] as { n: number } | undefined)?.n ?? 0 })
  }

  // ?status=pending,dialing&limit=100&offset=0 → filtered, paginated
  // listing for the Call Queue manager. With NO status filter the response
  // stays the historical bare array (the Upload console consumes it as
  // rows[]) — the { items, total } envelope only applies to filtered calls.
  const sp = req.nextUrl.searchParams
  const statusParam = (sp.get("status") || "").trim()
  const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : []
  const limit = Math.min(Math.max(parseInt(sp.get("limit") || "200", 10) || 200, 1), 500)
  const offset = Math.max(parseInt(sp.get("offset") || "0", 10) || 0, 0)

  const where: string[] = ["($1::uuid IS NULL OR branch_id = $1)"]
  const params: unknown[] = [branchId]
  if (statuses.length) {
    // "skipped" is a UI GROUP, not a stored status — the rows are
    // skipped_do_not_call / skipped_dnd_suppressed / skipped_outside_window.
    // Filtering with = ANY(['skipped']) matched nothing and the Skipped tab
    // was always empty.
    const exact = statuses.filter((s) => s !== "skipped")
    if (statuses.includes("skipped")) {
      if (exact.length) {
        params.push(exact)
        where.push(`(status = ANY($${params.length}) OR status LIKE 'skipped%')`)
      } else {
        where.push(`status LIKE 'skipped%'`)
      }
    } else {
      params.push(exact)
      where.push(`status = ANY($${params.length})`)
    }
  }
  const whereSql = `WHERE ${where.join(" AND ")}`
  const rows = await query(
    `SELECT * FROM outbound_queue ${whereSql} ORDER BY priority DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  )
  if (!statuses.length) return NextResponse.json(rows.rows ?? [])
  const totalRes = await query(`SELECT count(*)::int AS n FROM outbound_queue ${whereSql}`, params)
  return NextResponse.json({
    items: rows.rows ?? [],
    total: (totalRes.rows[0] as { n: number } | undefined)?.n ?? 0,
  })
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
    let skipped = 0
    // Campaign-level agenda from the CSV confirm modal / Add-Single form:
    // one "What should Priya talk about?" text stamped on every queued row.
    // A per-contact talking_points field (if a caller sends one) wins.
    const campaignPoints = campaignTalkingPoints(body.talking_points)
    for (const contact of body.contacts) {
      if (!contact.phone) continue
      contact.phone = normalizePhone(contact.phone)
      try {
        // QUEUE-LEVEL DEDUPE (2026-09-26): a pending/dialing row for the same
        // number must not be duplicated — re-confirming a CSV (double-click,
        // re-upload) used to create a second pending row and the batch dialer
        // then called that person once per row. Leads stay deduped below;
        // this guard is about not stacking CALLS.
        const dup = await query(
          `SELECT id FROM outbound_queue
            WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = NULLIF($1, '')
              AND status IN ('pending', 'dialing')
              AND ($2::uuid IS NULL OR branch_id = $2)
            LIMIT 1`,
          [phoneLast10(contact.phone), branchId]
        )
        if (dup.rows[0]) { skipped++; continue }

        // Dedupe — one lead per phone. FIX (2026-09-22): exact-match missed
        // format variants ("9876543210" vs "+919876543210") and created
        // duplicate leads for the same person — the queue PROCESSOR already
        // matched on last-10 digits, so the queue path and its processor
        // disagreed. Same rule everywhere now.
        const existing = await query(`SELECT id FROM leads WHERE ${PHONE_MATCH_SQL} AND ($2::uuid IS NULL OR branch_id = $2) LIMIT 1`, [phoneLast10(contact.phone), branchId])
        let leadId = existing.rows[0]?.id

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
          notes: (contact as Record<string, unknown>).notes as string | undefined || null,
          talking_points: campaignTalkingPoints((contact as Record<string, unknown>).talking_points) ?? campaignPoints,
          // Outpero-style per-lead sheet data (city, budget, plan, …) — the
          // dialer renders {merge_fields} in the talking points from this at
          // dial time (lib/script-studio.renderForDial).
          custom_fields: sanitizeCustomFields((contact as Record<string, unknown>).custom_fields),
          lead_id: leadId || null,
          status: "pending",
          branch_id: branchId,
        })
        queued++
      } catch (e) {
        console.error(`Failed to queue contact ${contact.phone}:`, e)
      }
    }
    return NextResponse.json({ ok: true, queued, skipped })
  }

  // Single contact mode: { name, phone, language, ... } — call immediately
  const { name, language, product_interest, notes } = body
  // Legacy immediate path keeps the same agenda contract as the queue: the
  // voice_calls row gets `instructions` (what /api/calls/turn reads) and the
  // queue row gets `talking_points` (what a re-queue of this row redials with).
  const talkingPoints = campaignTalkingPoints(body.talking_points)
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
  // Double-dial guard (2026-10-05) — see lib/outbound-dial.ts. Batch mode
  // skips this: the queue claim machinery already serializes campaign dials.
  try {
    await assertNoActiveDial(phone)
  } catch (e) {
    if (e instanceof Error && "status" in e) {
      return NextResponse.json({ error: e.message }, { status: (e as { status: number }).status })
    }
    throw e
  }

  try {
    // Dedupe — last-10 digits, same as batch mode + the queue processor.
    const existing = await query(`SELECT id FROM leads WHERE ${PHONE_MATCH_SQL} AND ($2::uuid IS NULL OR branch_id = $2) LIMIT 1`, [phoneLast10(phone), branchId])
    let leadId = existing.rows[0]?.id

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
    const call = await makeCall(phone, leadId || "", language || "telugu", talkingPoints ?? undefined, branchId)

    await db.from("voice_calls").insert({
      lead_id: leadId, twilio_call_sid: call.sid,
      direction: "outbound", status: "initiated",
      language: language || "telugu", phone,
      branch_id: branchId,
      instructions: talkingPoints,
    })
    if (branchId) recordUsage(branchId, "call")

    await db.from("outbound_queue").insert({
      name, phone, language: language || "telugu",
      product_interest, notes, lead_id: leadId,
      talking_points: talkingPoints,
      status: "called",
      call_sid: call.sid,
      branch_id: branchId,
    })

    return NextResponse.json({ ok: true, callSid: call.sid })
  } catch (e) {
    return apiError(e)
  }
}
