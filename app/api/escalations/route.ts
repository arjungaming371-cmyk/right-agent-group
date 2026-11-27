import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole, type Role } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// UNIFIED CRM HUMAN ACTION CENTER API
// Consolidates Voice & WhatsApp interactions per lead into actionable CRM items:
// 1. Confirmed Loans (High-value applicants)
// 2. Confirmed & Proposed Branch Visits (In-person appointments)
// 3. Scheduled Callbacks (Phone/WhatsApp voice calls)
// 4. Interested Leads (Inquiry/brochure requests)
// 5. Customer Escalations & Frustration Flags

const ROLE_LIST: Role[] = ["admin", "agent", "branch_manager", "developer"]

function normalizePhone(p?: string | null): string {
  if (!p) return ""
  return p.replace(/\D/g, "").slice(-10)
}

function parseCallSummary(raw: any): { fullSpokenName?: string; address?: string; nextAction?: string; concerns?: string[] } {
  if (!raw) return {}
  try {
    const parsed = typeof raw === "object" ? raw : JSON.parse(String(raw))
    return {
      fullSpokenName: parsed.lead_name || undefined,
      address: parsed.address || undefined,
      nextAction: parsed.next_action || undefined,
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns : undefined,
    }
  } catch {
    return {}
  }
}

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ROLE_LIST)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const url = new URL(req.url)
  const searchQuery = (url.searchParams.get("search") || "").trim().toLowerCase()
  const categoryFilter = url.searchParams.get("category") || "all"
  const priorityFilter = url.searchParams.get("priority") || "all"
  const channelFilter = url.searchParams.get("channel") || "all"

  try {
    // 1. Fetch pending alerts from comm_logs
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
              lm.facts AS memory_facts,
              last_call.id AS call_id,
              last_call.duration AS call_duration,
              last_call.sentiment AS call_sentiment,
              last_call.language AS call_language,
              last_call.ai_summary AS call_ai_summary,
              last_call.created_at AS call_created_at
         FROM comm_logs c
         LEFT JOIN leads l ON l.id = c.lead_id
         LEFT JOIN lead_memory lm ON lm.lead_id = l.id
         LEFT JOIN LATERAL (
           SELECT v.id, v.duration, v.sentiment, v.language, v.ai_summary, v.created_at
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
          AND c.created_at > now() - interval '60 days'
          AND ($1::uuid IS NULL OR l.branch_id = $1::uuid)
          AND NOT EXISTS (
            SELECT 1 FROM comm_logs r
             WHERE r.lead_id = c.lead_id
               AND (
                 r.outcome IN ('needs_human_resolved', 'loan_confirmed_resolved')
                 OR (r.type = 'system' AND r.outcome = 'resolved')
               )
               AND r.created_at >= c.created_at
          )
        ORDER BY c.created_at DESC
        LIMIT 250`,
      [branchId]
    ).catch(() => ({ rows: [] as any[] }))

    // 2. Fetch calendar events (Appointments, Callbacks, Proposed visits)
    const calRes = await query(
      `SELECT e.id, e.lead_id, e.title, e.event_type, e.event_at, e.end_at, e.status,
              e.confidence, e.location, e.channel, e.notes, e.raw_quote, e.created_at,
              l.name AS lead_name, l.phone AS lead_phone, l.whatsapp_number AS lead_whatsapp,
              l.status AS lead_status, l.address AS lead_address,
              COALESCE(l.product_interest, lm.facts->>'loan_type') AS product_interest,
              COALESCE(l.loan_amount, (lm.facts->>'loan_amount_needed')::numeric) AS loan_amount,
              lm.summary AS memory_summary,
              lm.facts AS memory_facts,
              last_call.id AS call_id,
              last_call.duration AS call_duration,
              last_call.sentiment AS call_sentiment,
              last_call.language AS call_language,
              last_call.ai_summary AS call_ai_summary,
              last_call.created_at AS call_created_at
         FROM calendar_events e
         LEFT JOIN leads l ON l.id = e.lead_id
         LEFT JOIN lead_memory lm ON lm.lead_id = l.id
         LEFT JOIN LATERAL (
           SELECT v.id, v.duration, v.sentiment, v.language, v.ai_summary, v.created_at
             FROM voice_calls v
            WHERE v.lead_id = l.id
            ORDER BY v.created_at DESC
            LIMIT 1
         ) last_call ON true
        WHERE e.status IN ('confirmed', 'needs_review', 'rescheduled')
          AND e.event_type IN ('branch_visit', 'proposed_visit', 'callback', 'interested_lead')
          AND e.created_at >= now() - interval '60 days'
          AND ($1::uuid IS NULL OR e.branch_id = $1::uuid)
        ORDER BY e.event_at ASC NULLS LAST, e.created_at DESC
        LIMIT 250`,
      [branchId]
    ).catch(() => ({ rows: [] as any[] }))

    // 3. Fetch loan applications
    const loanAppsRes = await query(
      `SELECT a.id, a.lead_id, a.customer_name AS lead_name, a.phone AS lead_phone,
              a.whatsapp_number AS lead_whatsapp, a.loan_type AS product_interest,
              a.loan_amount, a.status AS loan_status, a.submitted_at, a.monthly_income,
              a.employment_type, a.city, a.address AS lead_address,
              lm.summary AS memory_summary,
              lm.facts AS memory_facts,
              last_call.id AS call_id,
              last_call.duration AS call_duration,
              last_call.sentiment AS call_sentiment,
              last_call.language AS call_language,
              last_call.ai_summary AS call_ai_summary,
              last_call.created_at AS call_created_at
         FROM loan_applications a
         LEFT JOIN lead_memory lm ON lm.lead_id = a.lead_id
         LEFT JOIN LATERAL (
           SELECT v.id, v.duration, v.sentiment, v.language, v.ai_summary, v.created_at
             FROM voice_calls v
            WHERE v.lead_id = a.lead_id
            ORDER BY v.created_at DESC
            LIMIT 1
         ) last_call ON true
        WHERE a.status IN ('pending', 'submitted')
          AND a.submitted_at > now() - interval '60 days'
          AND ($1::uuid IS NULL OR a.branch_id = $1::uuid)
        ORDER BY a.submitted_at DESC
        LIMIT 100`,
      [branchId]
    ).catch(() => ({ rows: [] as any[] }))

    // =========================================================================
    // CONSOLIDATION ENGINE: Group all interactions per Unique Lead
    // =========================================================================
    const leadMap = new Map<string, any>()

    function getLeadKey(leadId?: string | null, phone?: string | null): string {
      if (leadId) return `lead_${leadId}`
      const norm = normalizePhone(phone)
      if (norm) return `phone_${norm}`
      return `temp_${Math.random().toString(36).slice(2)}`
    }

    function getOrCreateLeadRecord(
      key: string,
      leadId: string | null,
      name: string | null,
      phone: string | null,
      whatsapp: string | null,
      status: string | null,
      city: string | null
    ) {
      if (!leadMap.has(key)) {
        leadMap.set(key, {
          id: key,
          lead_id: leadId,
          lead_name: name || "Unknown Lead",
          lead_phone: phone,
          lead_whatsapp: whatsapp || phone,
          lead_status: status || "new",
          city: city || null,
          category: "escalation", // default, upgraded by tasks
          priority: "medium",     // default, upgraded by tasks
          tasks: [],
          financial: {},
          concerns: new Set<string>(),
          recommended_actions: [] as string[],
          timeline: [] as any[],
          ai_analysis: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          summary: "",
          full_description: "",
        })
      }
      const existing = leadMap.get(key)
      if (!existing.lead_name || existing.lead_name === "Unknown Lead") {
        if (name) existing.lead_name = name
      }
      if (!existing.lead_phone && phone) existing.lead_phone = phone
      if (!existing.lead_whatsapp && (whatsapp || phone)) existing.lead_whatsapp = whatsapp || phone
      if (city && !existing.city) existing.city = city
      return existing
    }

    // 1. Map Calendar Events
    for (const ce of calRes.rows) {
      const key = getLeadKey(ce.lead_id, ce.lead_phone)
      const lead = getOrCreateLeadRecord(key, ce.lead_id, ce.lead_name, ce.lead_phone, ce.lead_whatsapp, ce.lead_status, ce.location || ce.lead_address)

      const eventTime = ce.event_at ? new Date(ce.event_at).getTime() : NaN
      const isOverdue = !isNaN(eventTime) && eventTime < Date.now()
      const isDueSoon = !isNaN(eventTime) && eventTime < Date.now() + 2 * 3600 * 1000

      let taskType = ce.event_type || "callback"
      let taskPriority: "critical" | "high" | "medium" | "low" = "medium"

      if (taskType === "branch_visit") {
        taskPriority = isOverdue ? "critical" : isDueSoon ? "critical" : "high"
      } else if (taskType === "proposed_visit") {
        taskPriority = "medium"
      } else if (taskType === "callback") {
        taskPriority = isOverdue ? "critical" : isDueSoon ? "high" : "medium"
      } else if (taskType === "interested_lead") {
        taskPriority = "medium"
      }

      lead.tasks.push({
        id: `cal_${ce.id}`,
        raw_id: String(ce.id),
        type: taskType,
        title: ce.title || (taskType === "branch_visit" ? "Confirmed Office Visit" : taskType === "proposed_visit" ? "Proposed Office Visit" : "Scheduled Callback"),
        status: ce.status,
        due_at: ce.event_at,
        created_at: ce.created_at,
        source: "calendar_event",
        source_id: String(ce.id),
        notes: ce.notes,
        raw_quote: ce.raw_quote,
        location: ce.location,
        channel: ce.channel || "phone",
        confidence: ce.confidence || "medium",
        is_overdue: isOverdue,
      })

      // Upgrade lead priority & primary category
      if (taskPriority === "critical") lead.priority = "critical"
      else if (taskPriority === "high" && lead.priority !== "critical") lead.priority = "high"

      if (taskType === "branch_visit") lead.category = "branch_visit"
      else if (taskType === "callback" && lead.category !== "branch_visit" && lead.category !== "loan_confirmed") lead.category = "callback"
      else if (taskType === "proposed_visit" && lead.category === "escalation") lead.category = "proposed_visit"

      if (ce.product_interest) lead.financial.product_interest = ce.product_interest
      if (ce.loan_amount) lead.financial.loan_amount = ce.loan_amount
      if (ce.memory_summary) lead.ai_analysis.summary = ce.memory_summary
      if (ce.memory_facts) lead.ai_analysis.facts = ce.memory_facts
      if (ce.created_at && (!lead.created_at || new Date(ce.created_at) < new Date(lead.created_at))) {
        lead.created_at = ce.created_at
      }
    }

    // 2. Map Alerts from comm_logs
    for (const r of alertsRes.rows) {
      const key = getLeadKey(r.lead_id, r.lead_phone)
      const lead = getOrCreateLeadRecord(key, r.lead_id, r.lead_name, r.lead_phone, r.lead_whatsapp, r.lead_status, r.city || r.lead_address)

      const isLoan = r.outcome === "loan_confirmed"
      const taskType = isLoan ? "loan_confirmed" : "escalation"
      const taskPriority = isLoan ? "critical" : "high"

      lead.tasks.push({
        id: `comm_${r.id}`,
        raw_id: String(r.id),
        type: taskType,
        title: isLoan ? "Loan Confirmed by Customer" : "Human Attention Escalation",
        status: "pending",
        due_at: null,
        created_at: r.created_at,
        source: "comm_log",
        source_id: String(r.id),
        notes: r.summary,
        channel: "voice",
      })

      if (isLoan) {
        lead.category = "loan_confirmed"
        lead.priority = "critical"
      } else if (lead.priority !== "critical") {
        lead.priority = "high"
      }

      if (r.product_interest) lead.financial.product_interest = r.product_interest
      if (r.loan_amount) lead.financial.loan_amount = r.loan_amount
      if (r.monthly_income) lead.financial.monthly_income = r.monthly_income
      if (r.employment_type) lead.financial.employment_type = r.employment_type
      if (r.city) lead.financial.city = r.city
      if (r.memory_summary) lead.ai_analysis.summary = r.memory_summary
      if (r.memory_facts) lead.ai_analysis.facts = r.memory_facts
    }

    // 3. Map Loan Applications
    for (const la of loanAppsRes.rows) {
      const key = getLeadKey(la.lead_id, la.lead_phone)
      const lead = getOrCreateLeadRecord(key, la.lead_id, la.lead_name, la.lead_phone, la.lead_whatsapp, la.loan_status, la.city || la.lead_address)

      lead.tasks.push({
        id: `app_${la.id}`,
        raw_id: String(la.id),
        type: "loan_confirmed",
        title: `Loan Application Submitted (${la.product_interest || "Loan"})`,
        status: la.loan_status || "pending",
        due_at: null,
        created_at: la.submitted_at,
        source: "loan_application",
        source_id: String(la.id),
        channel: "online",
      })

      lead.category = "loan_confirmed"
      lead.priority = "critical"

      if (la.product_interest) lead.financial.product_interest = la.product_interest
      if (la.loan_amount) lead.financial.loan_amount = la.loan_amount
      if (la.monthly_income) lead.financial.monthly_income = la.monthly_income
      if (la.employment_type) lead.financial.employment_type = la.employment_type
      if (la.city) lead.financial.city = la.city
      if (la.memory_summary) lead.ai_analysis.summary = la.memory_summary
      if (la.memory_facts) lead.ai_analysis.facts = la.memory_facts
    }

    // Convert Map to Array
    const rawLeads = Array.from(leadMap.values())

    // 4. Enrich Leads with Timeline, Concerns & Recommended Actions
    const leadIdsForEnrichment = rawLeads.map(l => l.lead_id).filter(Boolean)
    let callHistoryMap = new Map<string, any[]>()
    let waHistoryMap = new Map<string, any[]>()

    if (leadIdsForEnrichment.length > 0) {
      // Fetch recent voice calls
      const callsQuery = await query(
        `SELECT v.id, v.lead_id, v.duration, v.sentiment, v.language, v.ai_summary, v.created_at, v.recording_url
           FROM voice_calls v
          WHERE v.lead_id = ANY($1::uuid[])
          ORDER BY v.created_at DESC`,
        [leadIdsForEnrichment]
      ).catch(() => ({ rows: [] as any[] }))

      for (const c of callsQuery.rows) {
        if (!callHistoryMap.has(c.lead_id)) callHistoryMap.set(c.lead_id, [])
        callHistoryMap.get(c.lead_id)!.push(c)
      }

      // Fetch recent whatsapp messages
      const waQuery = await query(
        `SELECT m.id, m.lead_id, m.body, m.direction, m.created_at, m.status
           FROM whatsapp_messages m
          WHERE m.lead_id = ANY($1::uuid[])
          ORDER BY m.created_at DESC
          LIMIT 500`,
        [leadIdsForEnrichment]
      ).catch(() => ({ rows: [] as any[] }))

      for (const m of waQuery.rows) {
        if (!waHistoryMap.has(m.lead_id)) waHistoryMap.set(m.lead_id, [])
        waHistoryMap.get(m.lead_id)!.push(m)
      }
    }

    // Build Final Clean Lead Structure
    const enrichedLeads = rawLeads.map(lead => {
      const calls = lead.lead_id ? callHistoryMap.get(lead.lead_id) || [] : []
      const waMsgs = lead.lead_id ? waHistoryMap.get(lead.lead_id) || [] : []

      // Build Chronological Timeline
      const timeline: any[] = []
      calls.slice(0, 5).forEach(c => {
        const parsed = parseCallSummary(c.ai_summary)
        timeline.push({
          id: `call_${c.id}`,
          channel: "phone",
          direction: "outbound",
          timestamp: c.created_at,
          title: `Voice Call (${c.duration ? `${Math.floor(c.duration / 60)}m ${c.duration % 60}s` : "Connected"})`,
          summary: typeof c.ai_summary === "string" ? c.ai_summary : (parsed.fullSpokenName ? `Call with ${parsed.fullSpokenName}` : "Voice interaction with Priya"),
          sentiment: c.sentiment || "neutral",
          language: c.language || "Telugu",
          recording_url: c.recording_url,
        })
      })

      waMsgs.slice(0, 5).forEach(w => {
        timeline.push({
          id: `wa_${w.id}`,
          channel: "whatsapp",
          direction: w.direction || "inbound",
          timestamp: w.created_at,
          title: w.direction === "inbound" ? "WhatsApp Message Received" : "WhatsApp Message Sent",
          summary: w.body ? w.body.slice(0, 160) : "WhatsApp message",
          sentiment: "neutral",
        })
      })

      timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      lead.timeline = timeline

      // Detect Concerns from Memory & Tasks
      const concernsList = new Set<string>()
      const memText = (lead.ai_analysis.summary || "").toLowerCase()
      const quoteText = lead.tasks.map((t: any) => t.raw_quote || "").join(" ").toLowerCase()
      const combinedIntel = `${memText} ${quoteText}`

      if (combinedIntel.includes("interest") || combinedIntel.includes("rate") || combinedIntel.includes("roi") || combinedIntel.includes("expensive")) {
        concernsList.add("Interest Rate Sensitivity")
      }
      if (combinedIntel.includes("cibil") || combinedIntel.includes("score") || combinedIntel.includes("overdue") || combinedIntel.includes("settlement")) {
        concernsList.add("Low CIBIL / Past Delinquency")
      }
      if (combinedIntel.includes("processing") || combinedIntel.includes("fee") || combinedIntel.includes("charges")) {
        concernsList.add("Processing Fee Queries")
      }
      if (combinedIntel.includes("father") || combinedIntel.includes("family") || combinedIntel.includes("spouse") || combinedIntel.includes("wife")) {
        concernsList.add("Family / Co-applicant Consultation")
      }
      if (combinedIntel.includes("agri") || combinedIntel.includes("land") || combinedIntel.includes("passbook") || combinedIntel.includes("dharani")) {
        concernsList.add("Agricultural Land Collateral")
      }
      if (combinedIntel.includes("frustrat") || combinedIntel.includes("angry") || combinedIntel.includes("annoyed") || combinedIntel.includes("human")) {
        concernsList.add("Frustrated / Demanded Senior Person")
      }

      lead.concerns = Array.from(concernsList)

      // Derive Recommended Next Actions
      const actions: string[] = []
      const hasLoanConfirmed = lead.tasks.some((t: any) => t.type === "loan_confirmed")
      const hasBranchVisit = lead.tasks.some((t: any) => t.type === "branch_visit")
      const hasCallback = lead.tasks.some((t: any) => t.type === "callback")
      const hasProposedVisit = lead.tasks.some((t: any) => t.type === "proposed_visit")

      if (hasLoanConfirmed) {
        actions.push("Review KYC & Bank Statement PDF")
        actions.push("Check eligibility across partner banks (HDFC/ICICI/SBI)")
        actions.push("Generate and send Sanction Key Facts Statement (KFS)")
      } else if (hasBranchVisit) {
        actions.push("Confirm Branch Officer availability for scheduled visit")
        actions.push("Send WhatsApp location pin (Mallikarjuna Complex, Gandimaisamma)")
        actions.push("Prepare physical file checklist (Aadhaar, PAN, Payslips)")
      } else if (hasCallback) {
        const nextCb = lead.tasks.find((t: any) => t.type === "callback")
        actions.push(`Call customer at promised callback slot (${nextCb?.due_at ? new Date(nextCb.due_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }) : "As scheduled"})`)
        actions.push("Have lowest ROI corporate discount quotes ready")
      } else if (hasProposedVisit) {
        actions.push("Follow up on WhatsApp with office directions & timings (9 AM - 6 PM)")
        actions.push("Lock in a specific appointment time slot")
      } else {
        actions.push("Connect directly to understand loan requirement")
        actions.push("Verify employment and monthly income")
      }

      lead.recommended_actions = actions

      // Clean Structured AI Summary (Structured 2-line summary instead of giant paragraphs)
      const prod = (lead.financial.product_interest || "Loan").toUpperCase()
      const amtStr = lead.financial.loan_amount ? `₹${Number(lead.financial.loan_amount).toLocaleString("en-IN")}` : "Flexible requirement"
      const cityStr = lead.city || lead.financial.city ? ` in ${lead.city || lead.financial.city}` : ""
      const taskHighlight = lead.tasks[0]?.title || "Attention required"

      lead.summary = `${taskHighlight}: ${prod} (${amtStr})${cityStr}. ${lead.concerns.length > 0 ? `Concerns: ${lead.concerns.join(", ")}.` : ""}`
      lead.full_description = lead.ai_analysis.summary || lead.summary

      return lead
    })

    // Apply In-Memory Search & Filters (Scalable to 10,000 leads)
    let filtered = enrichedLeads

    if (searchQuery) {
      filtered = filtered.filter(l => {
        const nameMatch = (l.lead_name || "").toLowerCase().includes(searchQuery)
        const phoneMatch = (l.lead_phone || "").includes(searchQuery) || (l.lead_whatsapp || "").includes(searchQuery)
        const cityMatch = (l.city || "").toLowerCase().includes(searchQuery)
        const prodMatch = (l.financial.product_interest || "").toLowerCase().includes(searchQuery)
        const summaryMatch = (l.summary || "").toLowerCase().includes(searchQuery)
        return nameMatch || phoneMatch || cityMatch || prodMatch || summaryMatch
      })
    }

    if (categoryFilter !== "all") {
      filtered = filtered.filter(l => {
        if (categoryFilter === "loan_confirmed") return l.category === "loan_confirmed" || l.tasks.some((t: any) => t.type === "loan_confirmed")
        if (categoryFilter === "branch_visit") return l.category === "branch_visit" || l.tasks.some((t: any) => t.type === "branch_visit")
        if (categoryFilter === "proposed_visit") return l.category === "proposed_visit" || l.tasks.some((t: any) => t.type === "proposed_visit")
        if (categoryFilter === "callback") return l.category === "callback" || l.tasks.some((t: any) => t.type === "callback")
        if (categoryFilter === "escalation") return l.category === "escalation" || l.tasks.some((t: any) => t.type === "escalation")
        if (categoryFilter === "interested_lead") return l.category === "interested_lead" || l.tasks.some((t: any) => t.type === "interested_lead")
        return true
      })
    }

    if (priorityFilter !== "all") {
      filtered = filtered.filter(l => l.priority === priorityFilter)
    }

    if (channelFilter !== "all") {
      filtered = filtered.filter(l => {
        if (channelFilter === "phone") return l.timeline.some((t: any) => t.channel === "phone") || l.tasks.some((t: any) => t.channel === "phone")
        if (channelFilter === "whatsapp") return l.timeline.some((t: any) => t.channel === "whatsapp") || l.tasks.some((t: any) => t.channel === "whatsapp_text" || t.channel === "whatsapp_voice")
        return true
      })
    }

    // Sort: Critical first, then High, then Medium, then newest
    const pOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    filtered.sort((a, b) => {
      const pDiff = (pOrder[a.priority] ?? 2) - (pOrder[b.priority] ?? 2)
      if (pDiff !== 0) return pDiff
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    const counts = {
      all: enrichedLeads.length,
      loans: enrichedLeads.filter(i => i.category === "loan_confirmed" || i.tasks.some((t: any) => t.type === "loan_confirmed")).length,
      visits: enrichedLeads.filter(i => i.category === "branch_visit" || i.tasks.some((t: any) => t.type === "branch_visit")).length,
      proposed_visits: enrichedLeads.filter(i => i.category === "proposed_visit" || i.tasks.some((t: any) => t.type === "proposed_visit")).length,
      callbacks: enrichedLeads.filter(i => i.category === "callback" || i.tasks.some((t: any) => t.type === "callback")).length,
      escalations: enrichedLeads.filter(i => i.category === "escalation" || i.tasks.some((t: any) => t.type === "escalation")).length,
      interested: enrichedLeads.filter(i => i.category === "interested_lead" || i.tasks.some((t: any) => t.type === "interested_lead")).length,
      critical: enrichedLeads.filter(i => i.priority === "critical").length,
      high: enrichedLeads.filter(i => i.priority === "high").length,
    }

    // Optional server pagination
    const page = parseInt(url.searchParams.get("page") || "1")
    const limit = parseInt(url.searchParams.get("limit") || "50")
    const totalItems = filtered.length
    const startIndex = (page - 1) * limit
    const paginatedItems = filtered.slice(startIndex, startIndex + limit)

    return NextResponse.json({
      items: paginatedItems,
      total: totalItems,
      page,
      limit,
      counts,
    })
  } catch (e: any) {
    console.error("[ActionCenter] escalations GET failed:", e?.message)
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
    bulkIds?: string[]
    itemSource?: string
    action?: string
    notes?: string
  }

  const targetIds: string[] = body.bulkIds && Array.isArray(body.bulkIds) && body.bulkIds.length > 0
    ? body.bulkIds
    : [String(body.id || body.logId || "").trim()].filter(Boolean)

  const noteText = String(body.notes || "").trim()
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "id or bulkIds required" }, { status: 400 })
  }

  try {
    for (const targetId of targetIds) {
      // 1. Resolve Calendar Event (cal_ID)
      if (targetId.startsWith("cal_")) {
        const calId = targetId.replace(/^cal_/, "")
        const res = await query(
          `UPDATE calendar_events
              SET status = 'completed',
                  notes = CASE WHEN $3 <> '' THEN COALESCE(notes || E'\n[Resolution Note]: ', '') || $3 ELSE notes END,
                  updated_at = now()
            WHERE id = $1
              AND ($2::uuid IS NULL OR branch_id = $2::uuid)
            RETURNING lead_id, title`,
          [calId, branchId, noteText]
        )
        const leadId = res.rows[0]?.lead_id
        if (leadId) {
          await query(
            `INSERT INTO comm_logs (lead_id, type, summary, outcome)
             VALUES ($1, 'system', $2, 'resolved')`,
            [leadId, `Resolved (${session.email || "Staff"}): ${res.rows[0]?.title || "Appointment"}${noteText ? ` — Note: ${noteText}` : ""}`]
          ).catch(() => {})

          await query(
            `UPDATE comm_logs
                SET outcome = CASE WHEN outcome = 'needs_human' THEN 'needs_human_resolved' WHEN outcome = 'loan_confirmed' THEN 'loan_confirmed_resolved' ELSE outcome || '_resolved' END,
                    summary = CASE WHEN $2 <> '' THEN summary || ' | Resolved: ' || $2 ELSE summary END
              WHERE lead_id = $1 AND type = 'alert' AND outcome IN ('needs_human', 'loan_confirmed')`,
            [leadId, noteText]
          ).catch(() => {})
        }

        logAudit("calendar event resolved", session.email, {
          calId,
          leadId,
          resolutionNotes: noteText,
        })
      }
      // 2. Resolve Loan Application (app_ID)
      else if (targetId.startsWith("app_")) {
        const appId = targetId.replace(/^app_/, "")
        const res = await query(
          `UPDATE loan_applications
              SET status = 'in_review'
            WHERE id = $1 AND ($2::uuid IS NULL OR branch_id = $2::uuid)
            RETURNING lead_id`,
          [appId, branchId]
        )
        const leadId = res.rows[0]?.lead_id
        if (leadId) {
          await query(
            `INSERT INTO comm_logs (lead_id, type, summary, outcome)
             VALUES ($1, 'system', $2, 'resolved')`,
            [leadId, `Loan application marked in-review (${session.email || "Staff"})${noteText ? ` — Note: ${noteText}` : ""}`]
          ).catch(() => {})
        }
        logAudit("loan application marked in_review", session.email, { appId, leadId, resolutionNotes: noteText })
      }
      // 3. Resolve Comm Log Alert (comm_ID)
      else if (targetId.startsWith("comm_")) {
        const commId = targetId.replace(/^comm_/, "")
        const owner = await query(`SELECT lead_id, outcome FROM comm_logs WHERE id = $1 LIMIT 1`, [commId])
        const row = owner.rows[0]
        if (row) {
          const nextOutcome = row.outcome?.endsWith("_resolved") ? row.outcome : `${row.outcome || "needs_human"}_resolved`
          await query(
            `UPDATE comm_logs
                SET outcome = $2,
                    summary = CASE WHEN $3 <> '' THEN summary || ' | Resolved: ' || $3 ELSE summary END
              WHERE id = $1`,
            [commId, nextOutcome, noteText]
          )
          if (row.lead_id) {
            await query(
              `UPDATE calendar_events
                  SET status = 'completed', updated_at = now()
                WHERE lead_id = $1 AND status IN ('confirmed', 'needs_review', 'rescheduled')`,
              [row.lead_id]
            ).catch(() => {})
          }
          logAudit("attention item resolved", session.email, { commId, leadId: row.lead_id, resolutionNotes: noteText })
        }
      }
      // 4. Resolve Consolidated Lead directly (lead_UUID)
      else if (targetId.startsWith("lead_")) {
        const leadId = targetId.replace(/^lead_/, "")
        await query(
          `UPDATE comm_logs
              SET outcome = CASE WHEN outcome = 'needs_human' THEN 'needs_human_resolved' WHEN outcome = 'loan_confirmed' THEN 'loan_confirmed_resolved' ELSE outcome || '_resolved' END,
                  summary = CASE WHEN $2 <> '' THEN summary || ' | Resolved: ' || $2 ELSE summary END
            WHERE lead_id = $1 AND type = 'alert' AND outcome IN ('needs_human', 'loan_confirmed')`,
          [leadId, noteText]
        ).catch(() => {})

        await query(
          `UPDATE calendar_events
              SET status = 'completed', updated_at = now(),
                  notes = CASE WHEN $2 <> '' THEN COALESCE(notes || E'\n[Resolution Note]: ', '') || $2 ELSE notes END
            WHERE lead_id = $1 AND status IN ('confirmed', 'needs_review', 'rescheduled')`,
          [leadId, noteText]
        ).catch(() => {})

        await query(
          `INSERT INTO comm_logs (lead_id, type, summary, outcome)
           VALUES ($1, 'system', $2, 'resolved')`,
          [leadId, `Action Center item resolved (${session.email || "Staff"})${noteText ? ` — Note: ${noteText}` : ""}`]
        ).catch(() => {})

        logAudit("lead action items resolved", session.email, { leadId, resolutionNotes: noteText })
      }
    }

    return NextResponse.json({ ok: true, resolvedCount: targetIds.length })
  } catch (e: any) {
    console.error("[ActionCenter] escalations POST failed:", e?.message)
    return NextResponse.json({ error: "Could not resolve item. Please try again." }, { status: 500 })
  }
}
