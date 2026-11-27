import { NextRequest, NextResponse } from "next/server"
import { query, withTransaction } from "@/lib/db"
import { requireModuleOrRole, type Role } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// UNIFIED CRM HUMAN ACTION CENTER API (ENTERPRISE SINGLE-BRANCH ARCHITECTURE)
// Right Agent Group operates as a single-branch financial consultancy in Hyderabad, India.
// Consolidates Voice & WhatsApp interactions, Calendar commitments, and Loan applications per lead.

const ROLE_LIST: Role[] = ["admin", "agent", "branch_manager", "developer"]

const COMPANY_CONFIG = {
  name: "Right Agent Group",
  officeName: "Head Office (Medchal Branch)",
  officeLocation: "Medchal branch above Masters GYM, Hyderabad",
  operatingHours: "Weekdays 9:30 AM – 6:30 PM",
  helpline: "+91 8333997227",
  whatsappSupport: "+91 8333993223",
  partnerBanksCount: "20+ leading banks and NBFCs",
}

function normalizePhone(p?: string | null): string {
  if (!p) return ""
  return p.replace(/\D/g, "").slice(-10)
}

function extractStructuredConcerns(facts: any, memorySummary: string, tasks: any[]): string[] {
  const concernsList = new Set<string>()

  // 1. Semantic Objections directly from Lead Brain analysis
  if (Array.isArray(facts?.objections_raised)) {
    for (const obj of facts.objections_raised) {
      if (typeof obj === "string" && obj.trim()) {
        concernsList.add(obj.trim())
      }
    }
  }

  // 2. Verified CIBIL analysis (Only flag if score is actually subprime / delinquent, not just mentioned)
  const cibilStr = String(facts?.cibil_mentioned || "")
  const cibilNum = parseInt(cibilStr.replace(/\D/g, ""), 10)
  if (!isNaN(cibilNum)) {
    if (cibilNum < 650) {
      concernsList.add(`Low CIBIL (${cibilNum})`)
    }
  } else if (/low\s+cibil|bad\s+cibil|cibil\s+issue|past\s+default|delinquen|settlement/i.test(cibilStr)) {
    concernsList.add("Low CIBIL / Past Delinquency")
  }

  // 3. Collateral Details (Agricultural land requires specialized lending programs)
  const propDetails = String(facts?.property_details || "")
  if (/agri|agriculture|land|patta|passbook|dharani/i.test(propDetails)) {
    concernsList.add("Agricultural Land Collateral")
  }

  // 4. Processing fees & charges queries
  if (/processing\s+fee|hidden\s+charge|advance\s+payment/i.test(memorySummary)) {
    concernsList.add("Processing Fee Queries")
  }

  // 5. Genuine Escalations / Frustration from tasks
  const hasEscalationTask = tasks.some(t => t.type === "escalation" || /frustrated|complaint|manager/i.test(t.title || ""))
  if (hasEscalationTask) {
    concernsList.add("Requested Senior Assistance")
  }

  return Array.from(concernsList)
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
    // 1. Fetch pending alerts from comm_logs (No hardcoded limits; no 60-day exclusion of active alerts)
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
        WHERE c.type = 'alert' AND c.outcome IN ('needs_human', 'loan_confirmed', 'application_submitted', 'link_shared', 'escalation')
          AND ($1::uuid IS NULL OR l.branch_id = $1::uuid)
          AND NOT EXISTS (
            SELECT 1 FROM comm_logs r
             WHERE r.lead_id = c.lead_id
               AND (
                 r.outcome IN ('needs_human_resolved', 'loan_confirmed_resolved', 'application_submitted_resolved', 'link_shared_resolved', 'escalation_resolved')
                 OR (r.type = 'system' AND r.outcome = 'resolved')
               )
               AND r.created_at >= c.created_at
          )
        ORDER BY c.created_at DESC`,
      [branchId]
    )

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
          AND ($1::uuid IS NULL OR e.branch_id = $1::uuid)
        ORDER BY e.event_at ASC NULLS LAST, e.created_at DESC`,
      [branchId]
    )

    // 3. Fetch loan applications pending review
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
          AND ($1::uuid IS NULL OR a.branch_id = $1::uuid)
        ORDER BY a.submitted_at DESC`,
      [branchId]
    )

    // =========================================================================
    // CONSOLIDATION ENGINE: Group all interactions per Unique Customer
    // One customer may have multiple tasks, but appears only once in customer table
    // =========================================================================
    const leadMap = new Map<string, any>()

    function getLeadKey(leadId?: string | null, phone?: string | null): string {
      const norm = normalizePhone(phone)
      if (norm) return `phone_${norm}`
      if (leadId) return `lead_${leadId}`
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
          concerns: [] as string[],
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
      if (!existing.lead_id && leadId) existing.lead_id = leadId
      if (!existing.lead_name || existing.lead_name === "Unknown Lead") {
        if (name) existing.lead_name = name
      }
      if (!existing.lead_phone && phone) existing.lead_phone = phone
      if (!existing.lead_whatsapp && (whatsapp || phone)) existing.lead_whatsapp = whatsapp || phone
      if (city && !existing.city) existing.city = city
      return existing
    }

    // 1. Process Calendar Events
    for (const ce of calRes.rows) {
      const key = getLeadKey(ce.lead_id, ce.lead_phone)
      const lead = getOrCreateLeadRecord(key, ce.lead_id, ce.lead_name, ce.lead_phone, ce.lead_whatsapp, ce.lead_status, ce.location || ce.lead_address)

      const isTentative = ce.status === "needs_review" || ce.confidence !== "high" ||
        /open invitation|without confirming|did not commit|tentative/i.test(ce.notes || "") ||
        /open invitation|without confirming|did not commit|tentative/i.test(ce.review_reason || "") ||
        !ce.event_at

      let taskType = ce.event_type || "callback"
      if (isTentative && (taskType === "branch_visit" || !taskType)) {
        taskType = "proposed_visit"
      }

      const eventTime = !isTentative && ce.event_at ? new Date(ce.event_at).getTime() : NaN
      const isOverdue = !isNaN(eventTime) && eventTime < Date.now()
      const isDueSoon = !isNaN(eventTime) && eventTime < Date.now() + 2 * 3600 * 1000

      let taskPriority: "critical" | "high" | "medium" | "low" = "medium"
      if (taskType === "branch_visit") {
        taskPriority = isOverdue ? "critical" : isDueSoon ? "critical" : "high"
      } else if (taskType === "proposed_visit") {
        taskPriority = "medium"
      } else if (taskType === "callback") {
        taskPriority = isOverdue ? "critical" : isDueSoon ? "high" : "medium"
      } else if (taskType === "interested_lead") {
        taskPriority = "low"
      }

      lead.tasks.push({
        id: `cal_${ce.id}`,
        raw_id: String(ce.id),
        type: taskType,
        title: ce.title || (taskType === "branch_visit" ? "Confirmed Office Visit" : taskType === "proposed_visit" ? "Proposed Office Visit" : "Scheduled Callback"),
        status: ce.status,
        due_at: isTentative ? null : ce.event_at,
        created_at: ce.created_at,
        source: "calendar_event",
        source_id: String(ce.id),
        notes: ce.notes,
        raw_quote: ce.raw_quote,
        location: ce.location,
        channel: ce.channel || "phone",
        confidence: ce.confidence || "medium",
        is_overdue: isOverdue,
        is_due_soon: isDueSoon,
        priority: taskPriority,
      })

      // Update lead priority
      if (taskPriority === "critical") lead.priority = "critical"
      else if (taskPriority === "high" && lead.priority !== "critical") lead.priority = "high"

      // Category assignment
      if (taskType === "branch_visit") lead.category = "branch_visit"
      else if (taskType === "proposed_visit" && lead.category !== "branch_visit") lead.category = "proposed_visit"
      else if (taskType === "callback" && lead.category !== "branch_visit" && lead.category !== "proposed_visit") lead.category = "callback"

      if (ce.product_interest) lead.financial.product_interest = ce.product_interest
      if (ce.loan_amount) lead.financial.loan_amount = ce.loan_amount
      if (ce.memory_summary) lead.ai_analysis.summary = ce.memory_summary
      if (ce.memory_facts) lead.ai_analysis.facts = ce.memory_facts
      if (ce.created_at && (!lead.created_at || new Date(ce.created_at) < new Date(lead.created_at))) {
        lead.created_at = ce.created_at
      }
    }

    // 2. Process Comm Log Alerts
    for (const r of alertsRes.rows) {
      const key = getLeadKey(r.lead_id, r.lead_phone)
      const lead = getOrCreateLeadRecord(key, r.lead_id, r.lead_name, r.lead_phone, r.lead_whatsapp, r.lead_status, r.city || r.lead_address)

      const isApplication = r.outcome === "application_submitted" || r.outcome === "link_shared" || r.outcome === "loan_confirmed"
      const isFrustration = /frustrated|angry|annoyed|complain/i.test(r.summary || "")
      const taskPriority: "critical" | "high" | "medium" | "low" = isFrustration ? "critical" : isApplication ? "medium" : "high"

      const taskType = isApplication ? "loan_application" : "escalation"
      const taskTitle = r.outcome === "application_submitted"
        ? "Application Submitted — Review Eligibility"
        : r.outcome === "link_shared"
        ? "Application Link Requested — Follow Up"
        : isFrustration
        ? "Customer Grievance Escalation"
        : "Human Assistance Requested"

      lead.tasks.push({
        id: `comm_${r.id}`,
        raw_id: String(r.id),
        type: taskType,
        title: taskTitle,
        status: "pending",
        due_at: null,
        created_at: r.created_at,
        source: "comm_log",
        source_id: String(r.id),
        notes: r.summary,
        channel: "voice",
        priority: taskPriority,
      })

      if (taskPriority === "critical") lead.priority = "critical"
      else if (lead.priority !== "critical" && taskPriority === "high") lead.priority = "high"

      if (lead.category !== "branch_visit" && lead.category !== "proposed_visit") {
        lead.category = isApplication ? "loan_application" : "escalation"
      }

      if (r.product_interest) lead.financial.product_interest = r.product_interest
      if (r.loan_amount) lead.financial.loan_amount = r.loan_amount
      if (r.monthly_income) lead.financial.monthly_income = r.monthly_income
      if (r.employment_type) lead.financial.employment_type = r.employment_type
      if (r.city) lead.financial.city = r.city
      if (r.memory_summary) lead.ai_analysis.summary = r.memory_summary
      if (r.memory_facts) lead.ai_analysis.facts = r.memory_facts
    }

    // 3. Process Loan Applications (Do NOT mark as confirmed loan; accurately classify as loan_application)
    for (const la of loanAppsRes.rows) {
      const key = getLeadKey(la.lead_id, la.lead_phone)
      const lead = getOrCreateLeadRecord(key, la.lead_id, la.lead_name, la.lead_phone, la.lead_whatsapp, la.loan_status, la.city || la.lead_address)

      const amt = Number(la.loan_amount || 0)
      const isHighValue = amt >= 5000000 // >= 50 Lakhs
      const appPriority: "critical" | "high" | "medium" | "low" = isHighValue ? "high" : "medium"

      lead.tasks.push({
        id: `app_${la.id}`,
        raw_id: String(la.id),
        type: "loan_application",
        title: `Loan Application Submitted (${la.product_interest || "Business Loan"})`,
        status: la.loan_status || "pending",
        due_at: null,
        created_at: la.submitted_at,
        source: "loan_application",
        source_id: String(la.id),
        channel: "online",
        priority: appPriority,
      })

      // Set lead priority only if higher
      if (appPriority === "high" && lead.priority !== "critical") lead.priority = "high"
      if (lead.category !== "branch_visit" && lead.category !== "proposed_visit" && lead.category !== "escalation") {
        lead.category = "loan_application"
      }

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

    // 4. Enrich Leads with Semantic Intelligence & Dynamic Next Actions
    const enrichedLeads = rawLeads.map(lead => {
      // Semantic Concern Extraction
      lead.concerns = extractStructuredConcerns(lead.ai_analysis.facts, lead.ai_analysis.summary || "", lead.tasks)

      // Dynamic Recommended Actions using Company Configuration
      const actions: string[] = []
      const hasApp = lead.tasks.some((t: any) => t.type === "loan_application")
      const hasBranchVisit = lead.tasks.some((t: any) => t.type === "branch_visit")
      const hasCallback = lead.tasks.some((t: any) => t.type === "callback")
      const hasProposedVisit = lead.tasks.some((t: any) => t.type === "proposed_visit")
      const hasEscalation = lead.tasks.some((t: any) => t.type === "escalation")

      if (hasApp) {
        actions.push(`Review KYC & Bank Statement PDF for eligibility check across ${COMPANY_CONFIG.partnerBanksCount}`)
        actions.push("Verify business vintage and GST filings")
        actions.push("Generate and issue Sanction Key Facts Statement (KFS)")
      } else if (hasBranchVisit) {
        actions.push(`Confirm Branch Manager availability at ${COMPANY_CONFIG.officeLocation}`)
        actions.push("Send WhatsApp location pin & physical file checklist (Aadhaar, PAN, Bank slips)")
        actions.push("Block in-person meeting slot")
      } else if (hasProposedVisit) {
        actions.push(`Follow up on WhatsApp with ${COMPANY_CONFIG.officeName} directions & hours (${COMPANY_CONFIG.operatingHours})`)
        actions.push("Lock in a specific appointment time slot with the customer")
      } else if (hasCallback) {
        const nextCb = lead.tasks.find((t: any) => t.type === "callback")
        actions.push(`Call customer at scheduled slot (${nextCb?.due_at ? new Date(nextCb.due_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }) : "As scheduled"})`)
        actions.push("Have bank comparison sheets ready")
      } else if (hasEscalation) {
        actions.push("Connect directly to resolve customer questions or grievance")
        actions.push("Review recent call recording & WhatsApp history for context before dialing")
      } else {
        actions.push("Connect to understand loan requirement and eligibility")
      }

      lead.recommended_actions = actions

      // Structured Summary
      const prod = (lead.financial.product_interest || "Business Loan").toUpperCase()
      const amtStr = lead.financial.loan_amount ? `₹${Number(lead.financial.loan_amount).toLocaleString("en-IN")}` : "Flexible requirement"
      const cityStr = lead.city || lead.financial.city ? ` in ${lead.city || lead.financial.city}` : ""
      const taskHighlight = lead.tasks[0]?.title || "Attention required"

      lead.summary = `${taskHighlight}: ${prod} (${amtStr})${cityStr}. ${lead.concerns.length > 0 ? `Concerns: ${lead.concerns.join(", ")}.` : ""}`
      lead.full_description = lead.ai_analysis.summary || lead.summary

      return lead
    })

    // Filter by Search Query
    let filtered = enrichedLeads
    if (searchQuery) {
      filtered = filtered.filter(l => {
        const nameMatch = (l.lead_name || "").toLowerCase().includes(searchQuery)
        const phoneMatch = (l.lead_phone || "").includes(searchQuery) || (l.lead_whatsapp || "").includes(searchQuery)
        const cityMatch = (l.city || "").toLowerCase().includes(searchQuery)
        const prodMatch = (l.financial.product_interest || "").toLowerCase().includes(searchQuery)
        const summaryMatch = (l.summary || "").toLowerCase().includes(searchQuery)
        const concernsMatch = l.concerns.some((c: string) => c.toLowerCase().includes(searchQuery))
        return nameMatch || phoneMatch || cityMatch || prodMatch || summaryMatch || concernsMatch
      })
    }

    // Filter by Category
    if (categoryFilter !== "all") {
      filtered = filtered.filter(l => {
        if (categoryFilter === "loan_confirmed" || categoryFilter === "loan_application") {
          return l.category === "loan_confirmed" || l.category === "loan_application" || l.tasks.some((t: any) => t.type === "loan_application" || t.type === "loan_confirmed")
        }
        if (categoryFilter === "branch_visit") {
          return l.category === "branch_visit" || l.category === "proposed_visit" || l.tasks.some((t: any) => t.type === "branch_visit" || t.type === "proposed_visit")
        }
        if (categoryFilter === "callback") {
          return l.category === "callback" || l.tasks.some((t: any) => t.type === "callback")
        }
        if (categoryFilter === "escalation") {
          return l.category === "escalation" || l.tasks.some((t: any) => t.type === "escalation")
        }
        if (categoryFilter === "interested_lead") {
          return l.category === "interested_lead" || l.tasks.some((t: any) => t.type === "interested_lead")
        }
        return true
      })
    }

    // Filter by Priority
    if (priorityFilter !== "all") {
      filtered = filtered.filter(l => l.priority === priorityFilter)
    }

    // Filter by Channel
    if (channelFilter !== "all") {
      filtered = filtered.filter(l => {
        if (channelFilter === "phone") return l.tasks.some((t: any) => t.channel === "phone" || t.channel === "in_person")
        if (channelFilter === "whatsapp") return l.tasks.some((t: any) => t.channel === "whatsapp" || t.channel === "whatsapp_text" || t.channel === "whatsapp_voice")
        return true
      })
    }

    // Default Sorting: Critical first, then High, then Medium, then Newest
    const pOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    filtered.sort((a, b) => {
      const pDiff = (pOrder[a.priority] ?? 2) - (pOrder[b.priority] ?? 2)
      if (pDiff !== 0) return pDiff
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    // Accurate Timezone-Consistent Dashboard Counters (Asia/Kolkata)
    const now = new Date()
    const todayYMD = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })

    function isTaskDueToday(t: any): boolean {
      if (!t.due_at) return false
      const d = new Date(t.due_at)
      if (isNaN(d.getTime())) return false
      return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === todayYMD
    }

    function isTaskOverdue(t: any): boolean {
      if (!t.due_at) return false
      const ts = new Date(t.due_at).getTime()
      if (isNaN(ts)) return false
      return ts < Date.now()
    }

    const totalPendingTasksCount = enrichedLeads.reduce((acc, l) => acc + l.tasks.length, 0)

    const counts = {
      all: enrichedLeads.length,
      pending_actions: totalPendingTasksCount,
      unique_leads: enrichedLeads.length,
      due_today: enrichedLeads.filter(l => l.tasks.some(isTaskDueToday) || l.category === "proposed_visit" || l.category === "escalation").length,
      overdue: enrichedLeads.filter(l => l.tasks.some(isTaskOverdue)).length,
      visits: enrichedLeads.filter(l => l.category === "branch_visit" || l.category === "proposed_visit" || l.tasks.some((t: any) => t.type === "branch_visit" || t.type === "proposed_visit")).length,
      confirmed_visits: enrichedLeads.filter(l => l.category === "branch_visit" || l.tasks.some((t: any) => t.type === "branch_visit")).length,
      proposed_visits: enrichedLeads.filter(l => l.category === "proposed_visit" || l.tasks.some((t: any) => t.type === "proposed_visit")).length,
      callbacks: enrichedLeads.filter(l => l.category === "callback" || l.tasks.some((t: any) => t.type === "callback")).length,
      applications: enrichedLeads.filter(l => l.category === "loan_application" || l.tasks.some((t: any) => t.type === "loan_application")).length,
      escalations: enrichedLeads.filter(l => l.category === "escalation" || l.tasks.some((t: any) => t.type === "escalation")).length,
      critical: enrichedLeads.filter(l => l.priority === "critical").length,
      high: enrichedLeads.filter(l => l.priority === "high").length,
    }

    // Server-level Pagination
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
    return NextResponse.json({ error: "Failed to load action items. " + (e?.message || "") }, { status: 500 })
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
    action?: string
    notes?: string
  }

  const targetIds: string[] = body.bulkIds && Array.isArray(body.bulkIds) && body.bulkIds.length > 0
    ? body.bulkIds.map(String).map(s => s.trim()).filter(Boolean)
    : [String(body.id || body.logId || "").trim()].filter(Boolean)

  const noteText = String(body.notes || "").trim()
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "id or bulkIds required" }, { status: 400 })
  }

  const resolutionResults: { id: string; success: boolean; type: string; error?: string; affectedCount?: number }[] = []

  try {
    await withTransaction(async (client) => {
      for (const targetId of targetIds) {
        // 1. Resolve Calendar Event (cal_<id>) - STRICTLY INDEPENDENT TASK RESOLUTION
        if (targetId.startsWith("cal_")) {
          const calId = targetId.replace(/^cal_/, "")
          const updateRes = await client.query(
            `UPDATE calendar_events
                SET status = 'completed',
                    notes = CASE WHEN $3 <> '' THEN COALESCE(notes || E'\n[Resolution Note]: ', '') || $3 ELSE notes END,
                    updated_at = now()
              WHERE id = $1
                AND status IN ('confirmed', 'needs_review', 'rescheduled')
                AND ($2::uuid IS NULL OR branch_id = $2::uuid)
              RETURNING id, lead_id, title`,
            [calId, branchId, noteText]
          )

          if (updateRes.rowCount === 0) {
            resolutionResults.push({ id: targetId, success: false, type: "calendar_event", error: "Already completed or not found" })
            continue
          }

          const row = updateRes.rows[0]
          if (row?.lead_id) {
            await client.query(
              `INSERT INTO comm_logs (lead_id, type, summary, outcome)
               VALUES ($1, 'system', $2, 'resolved')`,
              [row.lead_id, `Appointment resolved (${session.email || "Staff"}): ${row.title || "Calendar Task"}${noteText ? ` — Note: ${noteText}` : ""}`]
            )
          }

          await logAudit("calendar_event_resolved", session.email, {
            calId,
            leadId: row?.lead_id,
            resolutionNotes: noteText,
          })

          resolutionResults.push({ id: targetId, success: true, type: "calendar_event" })
        }
        // 2. Resolve Loan Application (app_<id>) - STRICTLY INDEPENDENT TASK RESOLUTION
        else if (targetId.startsWith("app_")) {
          const appId = targetId.replace(/^app_/, "")
          const updateRes = await client.query(
            `UPDATE loan_applications
                SET status = 'in_review',
                    remarks = CASE WHEN $3 <> '' THEN COALESCE(remarks || E'\n[Review Note]: ', '') || $3 ELSE remarks END,
                    last_edited_at = now()
              WHERE id = $1
                AND status IN ('pending', 'submitted')
                AND ($2::uuid IS NULL OR branch_id = $2::uuid)
              RETURNING id, lead_id, customer_name`,
            [appId, branchId, noteText]
          )

          if (updateRes.rowCount === 0) {
            resolutionResults.push({ id: targetId, success: false, type: "loan_application", error: "Already in review or not found" })
            continue
          }

          const row = updateRes.rows[0]
          if (row?.lead_id) {
            await client.query(
              `INSERT INTO comm_logs (lead_id, type, summary, outcome)
               VALUES ($1, 'system', $2, 'resolved')`,
              [row.lead_id, `Application marked in-review (${session.email || "Staff"})${noteText ? ` — Note: ${noteText}` : ""}`]
            )
          }

          await logAudit("loan_application_in_review", session.email, {
            appId,
            leadId: row?.lead_id,
            resolutionNotes: noteText,
          })

          resolutionResults.push({ id: targetId, success: true, type: "loan_application" })
        }
        // 3. Resolve Comm Log Alert (comm_<id>) - STRICTLY INDEPENDENT TASK RESOLUTION
        else if (targetId.startsWith("comm_")) {
          const commId = targetId.replace(/^comm_/, "")
          const updateRes = await client.query(
            `UPDATE comm_logs
                SET outcome = CASE WHEN outcome LIKE '%_resolved' THEN outcome ELSE outcome || '_resolved' END,
                    summary = CASE WHEN $2 <> '' THEN summary || ' | Resolved: ' || $2 ELSE summary END
              WHERE id = $1
                AND type = 'alert'
                AND outcome NOT LIKE '%_resolved'
              RETURNING id, lead_id, summary`,
            [commId, noteText]
          )

          if (updateRes.rowCount === 0) {
            resolutionResults.push({ id: targetId, success: false, type: "comm_log", error: "Already resolved or not found" })
            continue
          }

          const row = updateRes.rows[0]
          await logAudit("attention_item_resolved", session.email, {
            commId,
            leadId: row?.lead_id,
            resolutionNotes: noteText,
          })

          resolutionResults.push({ id: targetId, success: true, type: "comm_log" })
        }
        // 4. Resolve Consolidated Lead by Lead UUID (lead_<uuid>) - EXPLICIT FULL-LEAD RESOLUTION
        else if (targetId.startsWith("lead_")) {
          const leadId = targetId.replace(/^lead_/, "")
          let affected = 0

          const commUp = await client.query(
            `UPDATE comm_logs
                SET outcome = CASE WHEN outcome LIKE '%_resolved' THEN outcome ELSE outcome || '_resolved' END,
                    summary = CASE WHEN $2 <> '' THEN summary || ' | Resolved: ' || $2 ELSE summary END
              WHERE lead_id = $1
                AND type = 'alert'
                AND outcome NOT LIKE '%_resolved'`,
            [leadId, noteText]
          )
          affected += commUp.rowCount ?? 0

          const calUp = await client.query(
            `UPDATE calendar_events
                SET status = 'completed',
                    notes = CASE WHEN $2 <> '' THEN COALESCE(notes || E'\n[Resolution Note]: ', '') || $2 ELSE notes END,
                    updated_at = now()
              WHERE lead_id = $1
                AND status IN ('confirmed', 'needs_review', 'rescheduled')`,
            [leadId, noteText]
          )
          affected += calUp.rowCount ?? 0

          if (affected > 0) {
            await client.query(
              `INSERT INTO comm_logs (lead_id, type, summary, outcome)
               VALUES ($1, 'system', $2, 'resolved')`,
              [leadId, `All active action center items resolved (${session.email || "Staff"})${noteText ? ` — Note: ${noteText}` : ""}`]
            )
            await logAudit("lead_all_tasks_resolved", session.email, { leadId, affectedCount: affected, resolutionNotes: noteText })
            resolutionResults.push({ id: targetId, success: true, type: "lead", affectedCount: affected })
          } else {
            resolutionResults.push({ id: targetId, success: false, type: "lead", error: "No active tasks found for lead" })
          }
        }
      }
    })

    const successfulCount = resolutionResults.filter(r => r.success).length
    if (successfulCount === 0 && targetIds.length > 0) {
      return NextResponse.json({
        error: "None of the selected items could be resolved (they may have already been completed or not found).",
        results: resolutionResults,
      }, { status: 409 })
    }

    return NextResponse.json({
      ok: true,
      resolvedCount: successfulCount,
      totalCount: targetIds.length,
      results: resolutionResults,
    })
  } catch (e: any) {
    console.error("[ActionCenter] escalations POST transaction failed:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to resolve items due to a database transaction error." }, { status: 500 })
  }
}
