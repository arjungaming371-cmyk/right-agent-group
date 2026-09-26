import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db, query } from "@/lib/db"
import { makeCall } from "@/lib/exotel"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId, checkQuota, recordUsage } from "@/lib/branches"
import { checkCallCompliance } from "@/lib/compliance"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)
  const sp = new URL(req.url).searchParams

  // Sidebar badge: ?count=pending → { count }
  if (sp.get("count") === "pending") {
    const res = branchId
      ? await query(`SELECT count(*)::int AS n FROM outbound_queue WHERE status = 'pending' AND branch_id = $1`, [branchId])
      : await query(`SELECT count(*)::int AS n FROM outbound_queue WHERE status = 'pending'`)
    return NextResponse.json({ count: res.rows[0]?.n ?? 0 })
  }

  // Live radar: ?stats=1 → per-status counts (the Call Queue view's tab
  // badges + progress bar read this — computing them client-side would
  // require pulling every row).
  if (sp.get("stats") === "1") {
    const res = branchId
      ? await query(`SELECT status, count(*)::int AS n FROM outbound_queue WHERE branch_id = $1 GROUP BY status`, [branchId])
      : await query(`SELECT status, count(*)::int AS n FROM outbound_queue GROUP BY status`)
    const counts: Record<string, number> = {}
    for (const r of res.rows as { status: string; n: number }[]) counts[r.status] = r.n
    return NextResponse.json({ counts })
  }

  // Queue listing with filters: ?status=pending,dialing&limit=100&offset=0
  // (the old unfiltered last-200 shape remains the default).
  const statusParam = (sp.get("status") || "").trim()
  const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : []
  const limit = Math.min(Math.max(parseInt(sp.get("limit") || "200", 10) || 200, 1), 500)
  const offset = Math.max(parseInt(sp.get("offset") || "0", 10) || 0, 0)

  const where: string[] = []
  const params: unknown[] = []
  if (branchId) {
    params.push(branchId)
    where.push(`branch_id = $${params.length}`)
  }
  if (statuses.length) {
    params.push(statuses)
    where.push(`status = ANY($${params.length})`)
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const [rows, total] = await Promise.all([
    query(
      `SELECT * FROM outbound_queue ${whereSql} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    query(`SELECT count(*)::int AS n FROM outbound_queue ${whereSql}`, params),
  ])
  return NextResponse.json({ items: rows.rows ?? [], total: (total.rows[0] as { n: number } | undefined)?.n ?? 0 })
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
        // Dedupe — one lead per phone. FIX (2026-09-22): exact-match missed
        // format variants ("9876543210" vs "+919876543210") and created
        // duplicate leads for the same person — the queue PROCESSOR already
        // matched on last-10 digits, so the queue path and its processor
        // disagreed. Same rule everywhere now.
        const existing = await query(`SELECT id FROM leads WHERE ${PHONE_MATCH_SQL} LIMIT 1`, [phoneLast10(contact.phone)])
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
    // Dedupe — last-10 digits, same as batch mode + the queue processor.
    const existing = await query(`SELECT id FROM leads WHERE ${PHONE_MATCH_SQL} LIMIT 1`, [phoneLast10(phone)])
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
  } catch (e) {
    return apiError(e)
  }
}
