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

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ROLE_LIST)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  try {
    // 1. Confirmed Loans & Escalations from comm_logs
    const alertsRes = await query(
      `SELECT c.id, c.lead_id, c.summary, c.outcome, c.created_at,
              l.name AS lead_name, l.phone AS lead_phone, l.whatsapp_number AS lead_whatsapp,
              l.status AS lead_status, l.product_interest, l.loan_amount
         FROM comm_logs c
         LEFT JOIN leads l ON l.id = c.lead_id
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
              l.status AS lead_status, l.product_interest, l.loan_amount
         FROM calendar_events e
         LEFT JOIN leads l ON l.id = e.lead_id
        WHERE e.status IN ('confirmed', 'needs_review', 'rescheduled')
          AND e.event_at >= now() - interval '14 days'
          AND ($1::uuid IS NULL OR e.branch_id = $1::uuid)
        ORDER BY e.event_at ASC
        LIMIT 100`,
      [branchId]
    ).catch(() => ({ rows: [] as any[] }))

    // 3. New/Pending Loan Applications (to ensure every submitted application is surfaced)
    const loanAppsRes = await query(
      `SELECT a.id, a.lead_id, a.customer_name AS lead_name, a.phone AS lead_phone,
              a.whatsapp_number AS lead_whatsapp, a.loan_type AS product_interest,
              a.loan_amount, a.status AS loan_status, a.submitted_at, a.monthly_income, a.employment_type
         FROM loan_applications a
        WHERE a.status IN ('pending', 'submitted')
          AND a.submitted_at > now() - interval '30 days'
          AND ($1::uuid IS NULL OR a.branch_id = $1::uuid)
        ORDER BY a.submitted_at DESC
        LIMIT 50`,
      [branchId]
    ).catch(() => ({ rows: [] as any[] }))

    const items: any[] = []
    const seenLeadLoan = new Set<string>()

    // Map comm_logs alerts
    for (const r of alertsRes.rows) {
      const isLoan = r.outcome === "loan_confirmed"
      if (isLoan && r.lead_id) seenLeadLoan.add(String(r.lead_id))

      items.push({
        id: `comm_${r.id}`,
        raw_id: String(r.id),
        item_source: "comm_log",
        category: isLoan ? "loan_confirmed" : "escalation",
        lead_id: r.lead_id,
        lead_name: r.lead_name,
        lead_phone: r.lead_phone,
        lead_whatsapp: r.lead_whatsapp,
        lead_status: r.lead_status,
        product_interest: r.product_interest,
        loan_amount: r.loan_amount,
        summary: r.summary,
        created_at: r.created_at,
        event_at: null,
        location: null,
        priority: isLoan ? "critical" : "high",
      })
    }

    // Map loan_applications (if not already surfaced via comm_log)
    for (const la of loanAppsRes.rows) {
      if (la.lead_id && seenLeadLoan.has(String(la.lead_id))) continue
      if (la.lead_id) seenLeadLoan.add(String(la.lead_id))

      items.push({
        id: `app_${la.id}`,
        raw_id: String(la.id),
        item_source: "loan_application",
        category: "loan_confirmed",
        lead_id: la.lead_id,
        lead_name: la.lead_name,
        lead_phone: la.lead_phone,
        lead_whatsapp: la.lead_whatsapp,
        lead_status: "applied",
        product_interest: la.product_interest,
        loan_amount: la.loan_amount,
        monthly_income: la.monthly_income,
        employment_type: la.employment_type,
        summary: `🟢 LOAN APPLICATION SUBMITTED — ${la.product_interest || "Loan"} of ${la.loan_amount ? "₹" + Number(la.loan_amount).toLocaleString("en-IN") : "requested amount"}. Ready for loan officer verification.`,
        created_at: la.submitted_at,
        event_at: null,
        location: null,
        priority: "critical",
      })
    }

    // Map calendar_events (Callbacks, Office Visits)
    for (const ce of calRes.rows) {
      const eventTime = new Date(ce.event_at).getTime()
      const isOverdue = !isNaN(eventTime) && eventTime < Date.now()
      const isDueSoon = !isNaN(eventTime) && eventTime < Date.now() + 2 * 3600 * 1000

      items.push({
        id: `cal_${ce.id}`,
        raw_id: String(ce.id),
        item_source: "calendar_event",
        category: ce.event_type || "callback",
        lead_id: ce.lead_id,
        lead_name: ce.lead_name,
        lead_phone: ce.lead_phone,
        lead_whatsapp: ce.lead_whatsapp,
        lead_status: ce.lead_status,
        product_interest: ce.product_interest,
        loan_amount: ce.loan_amount,
        summary: ce.title || (ce.event_type === "branch_visit" ? "Scheduled office visit" : "Scheduled callback"),
        quote: ce.raw_quote || ce.notes || null,
        event_at: ce.event_at,
        location: ce.location,
        channel: ce.channel,
        confidence: ce.confidence,
        created_at: ce.created_at,
        priority: isOverdue ? "critical" : isDueSoon ? "high" : "medium",
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
