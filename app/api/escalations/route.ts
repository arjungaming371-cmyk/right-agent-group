import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole, type Role } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// UNIFIED HUMAN ACTION CENTER — "Needs Human" view.
// Consolidates:
// 1. Confirmed Loan Applicants (hot leads who agreed to loan on call or submitted application)
// 2. Scheduled Callbacks & Office Visits (from autonomous calendar agent)
// 3. Customer Escalations & Frustration Flags

const ROLE_LIST: Role[] = ["admin", "agent", "branch_manager", "developer"]

function normalizePhone(p?: string | null): string {
  if (!p) return ""
  return p.replace(/\D/g, "").slice(-10)
}

function parseCallSummary(raw: any): { fullSpokenName?: string; address?: string; nextAction?: string } {
  if (!raw) return {}
  if (typeof raw === "object") {
    return {
      fullSpokenName: raw.lead_name || undefined,
      address: raw.address || undefined,
      nextAction: raw.next_action || undefined,
    }
  }
  try {
    const parsed = JSON.parse(String(raw))
    return {
      fullSpokenName: parsed.lead_name || undefined,
      address: parsed.address || undefined,
      nextAction: parsed.next_action || undefined,
    }
  } catch {
    return {}
  }
}

function buildComprehensiveDescription(item: any): string {
  // If rich AI memory summary exists from the autonomous intelligence engine:
  if (item.memory_summary && item.memory_summary.trim().length > 25) {
    const mem = item.memory_summary.trim()
    if (item.category === "loan_confirmed") {
      return `🟢 LOAN CONFIRMED ON CALL — ${mem}`
    } else if (item.category === "callback") {
      return `📞 CALLBACK REQUESTED — ${mem}`
    } else if (item.category === "branch_visit") {
      return `🏢 OFFICE VISIT SCHEDULED — ${mem}`
    }
    return mem
  }

  const parts: string[] = []
  const product = item.product_interest ? item.product_interest.toUpperCase() : "LOAN"
  const amount = item.loan_amount ? `₹${Number(item.loan_amount).toLocaleString("en-IN")}` : ""
  const location = item.lead_address || item.city || ""
  const profile = item.employment_type ? `Occupation/Profile: ${item.employment_type}.` : ""

  if (item.category === "loan_confirmed") {
    parts.push(`🟢 LOAN CONFIRMED ON CALL — Caller confirmed requirement for ${product}${amount ? ` of ${amount}` : ""}${location ? ` in ${location}` : ""}.`)
    if (profile) parts.push(profile)
    if (item.call_duration) {
      const mins = Math.floor(item.call_duration / 60)
      const secs = item.call_duration % 60
      parts.push(`Discussed in detail on a ${mins > 0 ? `${mins}m ` : ""}${secs}s call (${item.call_language || "Telugu"}).`)
    }
    parts.push(`Official application link sent on WhatsApp (+${item.lead_whatsapp || item.lead_phone || ""}). Follow up for KYC, college/income documentation & bank file processing.`)
  } else if (item.category === "callback") {
    parts.push(`📞 CALLBACK REQUESTED — Follow-up requested for ${product}${amount ? ` (${amount})` : ""}.`)
    if (item.quote) parts.push(`Customer note: "${item.quote}".`)
    if (location) parts.push(`Location: ${location}.`)
  } else if (item.category === "branch_visit") {
    parts.push(`🏢 OFFICE VISIT — In-person appointment requested.`)
    if (item.location) parts.push(`Branch: ${item.location}.`)
    if (item.quote) parts.push(`Notes: "${item.quote}".`)
  } else {
    parts.push(`⚠️ ATTENTION NEEDED — Customer requested human assistance during conversation.`)
    if (item.quote) parts.push(`Statement: "${item.quote}".`)
    if (item.call_duration) parts.push(`Call duration: ${item.call_duration}s.`)
  }

  return parts.join(" ")
}

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ROLE_LIST)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  try {
    // 1. Confirmed Loans & Escalations from comm_logs joined with leads, last_call, and last_app
    const alertsRes = await query(
      `SELECT c.id, c.lead_id, c.summary, c.outcome, c.created_at,
              l.name AS lead_name, l.phone AS lead_phone, l.whatsapp_number AS lead_whatsapp,
              l.status AS lead_status, l.address AS lead_address,
              COALESCE(last_app.loan_type, l.product_interest, lm.facts->>'loan_type') AS product_interest,
              COALESCE(last_app.app_loan_amount, l.loan_amount, (lm.facts->>'loan_amount_needed')::numeric) AS loan_amount,
              COALESCE(last_app.monthly_income, (lm.facts->>'monthly_income')::numeric) AS monthly_income,
              COALESCE(last_app.employment_type, lm.facts->>'employment_type') AS employment_type,
              COALESCE(last_app.city, lm.facts->>'city', l.address) AS city,
              lm.summary AS memory_summary,
              last_call.duration AS call_duration,
              last_call.sentiment AS call_sentiment,
              last_call.language AS call_language,
              last_call.ai_summary AS call_ai_summary
         FROM comm_logs c
         LEFT JOIN leads l ON l.id = c.lead_id
         LEFT JOIN lead_memory lm ON lm.lead_id = l.id
         LEFT JOIN LATERAL (
           SELECT v.duration, v.sentiment, v.language, v.ai_summary
             FROM voice_calls v
            WHERE v.lead_id = l.id
            ORDER BY v.created_at DESC
            LIMIT 1
         ) last_call ON true
         LEFT JOIN LATERAL (
           SELECT la.loan_type, la.loan_amount AS app_loan_amount, la.monthly_income, la.employment_type, la.city
             FROM loan_applications la
            WHERE la.lead_id = l.id
            ORDER BY la.submitted_at DESC
            LIMIT 1
         ) last_app ON true
        WHERE c.type = 'alert' AND c.outcome IN ('needs_human', 'loan_confirmed')
          AND c.created_at > now() - interval '30 days'
          AND ($1::uuid IS NULL OR l.branch_id = $1::uuid)
        ORDER BY c.created_at DESC
        LIMIT 100`,
      [branchId]
    )

    // 2. Autonomous Calendar Events (Callbacks, Office Visits, Deadlines)
    const calRes = await query(
      `SELECT e.id, e.lead_id, e.title, e.event_type, e.event_at, e.end_at, e.status,
              e.confidence, e.location, e.channel, e.notes, e.raw_quote, e.created_at,
              l.name AS lead_name, l.phone AS lead_phone, l.whatsapp_number AS lead_whatsapp,
              l.status AS lead_status, l.address AS lead_address,
              COALESCE(l.product_interest, lm.facts->>'loan_type') AS product_interest,
              COALESCE(l.loan_amount, (lm.facts->>'loan_amount_needed')::numeric) AS loan_amount,
              lm.summary AS memory_summary,
              last_call.duration AS call_duration,
              last_call.sentiment AS call_sentiment,
              last_call.language AS call_language,
              last_call.ai_summary AS call_ai_summary
         FROM calendar_events e
         LEFT JOIN leads l ON l.id = e.lead_id
         LEFT JOIN lead_memory lm ON lm.lead_id = l.id
         LEFT JOIN LATERAL (
           SELECT v.duration, v.sentiment, v.language, v.ai_summary
             FROM voice_calls v
            WHERE v.lead_id = l.id
            ORDER BY v.created_at DESC
            LIMIT 1
         ) last_call ON true
        WHERE e.status IN ('confirmed', 'needs_review', 'rescheduled')
          AND e.event_type IN ('callback', 'branch_visit')
          AND e.event_at >= now() - interval '1 day'
          AND ($1::uuid IS NULL OR e.branch_id = $1::uuid)
        ORDER BY e.event_at ASC
        LIMIT 100`,
      [branchId]
    ).catch(() => ({ rows: [] as any[] }))

    // 3. New/Pending Loan Applications (to ensure every submitted application is surfaced)
    const loanAppsRes = await query(
      `SELECT a.id, a.lead_id, a.customer_name AS lead_name, a.phone AS lead_phone,
              a.whatsapp_number AS lead_whatsapp, a.loan_type AS product_interest,
              a.loan_amount, a.status AS loan_status, a.submitted_at, a.monthly_income,
              a.employment_type, a.city, a.address AS lead_address,
              lm.summary AS memory_summary,
              last_call.duration AS call_duration,
              last_call.sentiment AS call_sentiment,
              last_call.language AS call_language,
              last_call.ai_summary AS call_ai_summary
         FROM loan_applications a
         LEFT JOIN lead_memory lm ON lm.lead_id = a.lead_id
         LEFT JOIN LATERAL (
           SELECT v.duration, v.sentiment, v.language, v.ai_summary
             FROM voice_calls v
            WHERE v.lead_id = a.lead_id
            ORDER BY v.created_at DESC
            LIMIT 1
         ) last_call ON true
        WHERE a.status IN ('pending', 'submitted')
          AND a.submitted_at > now() - interval '30 days'
          AND ($1::uuid IS NULL OR a.branch_id = $1::uuid)
        ORDER BY a.submitted_at DESC
        LIMIT 50`,
      [branchId]
    ).catch(() => ({ rows: [] as any[] }))

    const items: any[] = []
    const seenLeadIds = new Set<string>()
    const seenPhones = new Set<string>()

    function findExisting(leadId?: string | null, phone?: string | null) {
      const norm = normalizePhone(phone)
      return items.find(i => {
        if (leadId && i.lead_id && String(i.lead_id) === String(leadId)) return true
        if (norm && normalizePhone(i.lead_phone || i.lead_whatsapp) === norm) return true
        return false
      })
    }

    function recordSeen(leadId?: string | null, phone?: string | null) {
      if (leadId) seenLeadIds.add(String(leadId))
      const norm = normalizePhone(phone)
      if (norm) seenPhones.add(norm)
    }

    function isSeen(leadId?: string | null, phone?: string | null): boolean {
      if (leadId && seenLeadIds.has(String(leadId))) return true
      const norm = normalizePhone(phone)
      if (norm && seenPhones.has(norm)) return true
      return false
    }

    // Map comm_logs alerts (Deduplicated per lead so loan officers see 1 unified card per lead)
    for (const r of alertsRes.rows) {
      if (isSeen(r.lead_id, r.lead_phone)) {
        const existing = findExisting(r.lead_id, r.lead_phone)
        if (existing) {
          if (r.outcome === "loan_confirmed") {
            existing.category = "loan_confirmed"
            existing.priority = "critical"
          }
          if (r.loan_amount) existing.loan_amount = existing.loan_amount || r.loan_amount
          if (r.product_interest) existing.product_interest = existing.product_interest || r.product_interest
          if (r.memory_summary) {
            existing.memory_summary = existing.memory_summary || r.memory_summary
            existing.full_description = buildComprehensiveDescription(existing)
          }
        }
        continue
      }
      recordSeen(r.lead_id, r.lead_phone)

      const isLoan = r.outcome === "loan_confirmed"
      const parsedAi = parseCallSummary(r.call_ai_summary)

      const rawItem = {
        id: `comm_${r.id}`,
        raw_id: String(r.id),
        item_source: "comm_log",
        category: isLoan ? "loan_confirmed" : "escalation",
        lead_id: r.lead_id,
        lead_name: r.lead_name,
        lead_phone: r.lead_phone,
        lead_whatsapp: r.lead_whatsapp,
        lead_status: r.lead_status,
        lead_address: r.lead_address || parsedAi.address || null,
        product_interest: r.product_interest,
        loan_amount: r.loan_amount,
        monthly_income: r.monthly_income,
        employment_type: r.employment_type,
        city: r.city,
        memory_summary: r.memory_summary || null,
        call_duration: r.call_duration,
        call_sentiment: r.call_sentiment,
        call_language: r.call_language,
        next_action: parsedAi.nextAction || null,
        summary: r.summary,
        created_at: r.created_at,
        event_at: null,
        location: null,
        priority: isLoan ? "critical" : "high",
      }

      items.push({
        ...rawItem,
        full_description: buildComprehensiveDescription(rawItem),
      })
    }

    // Map loan_applications (if not already surfaced via comm_log)
    for (const la of loanAppsRes.rows) {
      if (isSeen(la.lead_id, la.lead_phone)) {
        const existing = findExisting(la.lead_id, la.lead_phone)
        if (existing) {
          existing.category = "loan_confirmed"
          existing.priority = "critical"
          if (la.loan_amount) existing.loan_amount = existing.loan_amount || la.loan_amount
          if (la.product_interest) existing.product_interest = existing.product_interest || la.product_interest
          if (la.memory_summary) {
            existing.memory_summary = existing.memory_summary || la.memory_summary
            existing.full_description = buildComprehensiveDescription(existing)
          }
        }
        continue
      }
      recordSeen(la.lead_id, la.lead_phone)

      const parsedAi = parseCallSummary(la.call_ai_summary)

      const rawItem = {
        id: `app_${la.id}`,
        raw_id: String(la.id),
        item_source: "loan_application",
        category: "loan_confirmed",
        lead_id: la.lead_id,
        lead_name: la.lead_name,
        lead_phone: la.lead_phone,
        lead_whatsapp: la.lead_whatsapp,
        lead_status: "applied",
        lead_address: la.lead_address || la.city || parsedAi.address || null,
        product_interest: la.product_interest,
        loan_amount: la.loan_amount,
        monthly_income: la.monthly_income,
        employment_type: la.employment_type,
        city: la.city,
        memory_summary: la.memory_summary || null,
        call_duration: la.call_duration,
        call_sentiment: la.call_sentiment,
        call_language: la.call_language,
        next_action: parsedAi.nextAction || null,
        summary: `🟢 LOAN APPLICATION SUBMITTED — ${la.product_interest || "Loan"} of ${la.loan_amount ? "₹" + Number(la.loan_amount).toLocaleString("en-IN") : "requested amount"}. Ready for loan officer verification.`,
        created_at: la.submitted_at,
        event_at: null,
        location: null,
        priority: "critical",
      }

      items.push({
        ...rawItem,
        full_description: buildComprehensiveDescription(rawItem),
      })
    }

    // Map calendar_events (Callbacks, Office Visits)
    for (const ce of calRes.rows) {
      if (isSeen(ce.lead_id, ce.lead_phone)) {
        // Merge event timing into the existing card for this lead
        const existing = findExisting(ce.lead_id, ce.lead_phone)
        if (existing) {
          existing.event_at = existing.event_at || ce.event_at
          existing.location = existing.location || ce.location
          existing.channel = existing.channel || ce.channel
        }
        continue
      }
      recordSeen(ce.lead_id, ce.lead_phone)

      const eventTime = new Date(ce.event_at).getTime()
      const isOverdue = !isNaN(eventTime) && eventTime < Date.now()
      const isDueSoon = !isNaN(eventTime) && eventTime < Date.now() + 2 * 3600 * 1000
      const parsedAi = parseCallSummary(ce.call_ai_summary)

      const rawItem = {
        id: `cal_${ce.id}`,
        raw_id: String(ce.id),
        item_source: "calendar_event",
        category: ce.event_type || "callback",
        lead_id: ce.lead_id,
        lead_name: ce.lead_name,
        lead_phone: ce.lead_phone,
        lead_whatsapp: ce.lead_whatsapp,
        lead_status: ce.lead_status,
        lead_address: ce.lead_address || parsedAi.address || null,
        product_interest: ce.product_interest,
        loan_amount: ce.loan_amount,
        summary: ce.title || (ce.event_type === "branch_visit" ? "Scheduled office visit" : "Scheduled callback"),
        quote: ce.raw_quote || ce.notes || null,
        event_at: ce.event_at,
        location: ce.location,
        channel: ce.channel,
        confidence: ce.confidence,
        call_duration: ce.call_duration,
        call_sentiment: ce.call_sentiment,
        call_language: ce.call_language,
        next_action: parsedAi.nextAction || null,
        created_at: ce.created_at,
        priority: isOverdue ? "critical" : isDueSoon ? "high" : "medium",
        memory_summary: ce.memory_summary || null,
      }

      items.push({
        ...rawItem,
        full_description: buildComprehensiveDescription(rawItem),
      })
    }

    // Sort: Critical first (Overdue callbacks, Confirmed loans), then High, then Medium
    const pOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 }
    items.sort((a, b) => {
      const pDiff = (pOrder[a.priority] ?? 2) - (pOrder[b.priority] ?? 2)
      if (pDiff !== 0) return pDiff
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    const counts = {
      all: items.length,
      loans: items.filter(i => i.category === "loan_confirmed").length,
      callbacks: items.filter(i => i.category === "callback" || i.category === "branch_visit" || i.category === "document_deadline" || i.category === "reminder").length,
      escalations: items.filter(i => i.category === "escalation").length,
    }

    return NextResponse.json({ items, counts })
  } catch (e: any) {
    console.error("escalations GET failed:", e?.message)
    return NextResponse.json({ error: "Could not load action items. Please try again." }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ROLE_LIST)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const body = (await req.json().catch(() => ({}))) as {
    logId?: string
    id?: string
    itemSource?: string
    action?: string
  }
  const targetId = String(body.id || body.logId || "").trim()
  if (!targetId) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  try {
    // 1. Resolve Calendar Event
    if (targetId.startsWith("cal_") || body.itemSource === "calendar_event") {
      const calId = targetId.replace(/^cal_/, "")
      const res = await query(
        `UPDATE calendar_events
            SET status = 'completed', updated_at = now()
          WHERE id = $1
            AND ($2::uuid IS NULL OR branch_id = $2::uuid)`,
        [calId, branchId]
      )
      if ((res.rowCount ?? 0) === 0) {
        return NextResponse.json({ error: "not found or already resolved" }, { status: 404 })
      }
      logAudit("calendar event resolved", session.email, { calId })
      return NextResponse.json({ ok: true })
    }

    // 2. Resolve Loan Application
    if (targetId.startsWith("app_") || body.itemSource === "loan_application") {
      const appId = targetId.replace(/^app_/, "")
      const res = await query(
        `UPDATE loan_applications
            SET status = 'in_review'
          WHERE id = $1
            AND ($2::uuid IS NULL OR branch_id = $2::uuid)`,
        [appId, branchId]
      )
      if ((res.rowCount ?? 0) === 0) {
        return NextResponse.json({ error: "not found or already resolved" }, { status: 404 })
      }
      logAudit("loan application marked in_review", session.email, { appId })
      return NextResponse.json({ ok: true })
    }

    // 3. Default comm_log resolution
    const commId = targetId.replace(/^comm_/, "")
    const owner = await query(
      `SELECT l.branch_id, c.outcome FROM comm_logs c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = $1 AND c.type = 'alert' LIMIT 1`,
      [commId]
    )
    const row = owner.rows[0]
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 })
    if (branchId && row.branch_id && row.branch_id !== branchId) {
      return NextResponse.json({ error: "not found" }, { status: 404 })
    }

    const currentOutcome = row.outcome || "needs_human"
    const nextOutcome = currentOutcome.endsWith("_resolved") ? currentOutcome : `${currentOutcome}_resolved`

    const res = await query(
      `UPDATE comm_logs SET outcome = $2 WHERE id = $1`,
      [commId, nextOutcome]
    )
    if ((res.rowCount ?? 0) === 0) return NextResponse.json({ error: "already resolved" }, { status: 409 })

    logAudit("attention item resolved", session.email, { commId })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("escalations POST failed:", e?.message)
    return NextResponse.json({ error: "Could not resolve item. Please try again." }, { status: 500 })
  }
}
