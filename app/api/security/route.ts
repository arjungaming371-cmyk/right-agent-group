import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { isMailConfigured } from "@/lib/mail"
import { buildComprehensiveDescription } from "@/lib/escalations-helper"

export const dynamic = "force-dynamic"

// FIXED: table is audit_logs (plural) with columns action/performed_by/metadata
// — the old code queried a non-existent audit_log table, so the audit trail
// never recorded or displayed anything.

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "security", ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: settings } = await db.from("security_settings").select("key, enabled")
  const { data: logs } = await db.from("audit_logs").select("*").order("created_at", { ascending: false })

  // The full-access role's own actions are hidden from OTHER people viewing
  // this page — not from that account's own view of its own history. Without
  // the session.role check below, an account holding this role would find
  // its entire audit trail wiped from its own Security page too.
  let filteredLogs = logs ?? []
  if (session.role !== "developer") {
    const devRows = await query(`SELECT lower(email) AS email FROM allowed_emails WHERE role = 'developer'`)
    const devEmails = new Set(devRows.rows.map((r: any) => r.email))
    filteredLogs = filteredLogs.filter((l: any) => !devEmails.has(String(l.performed_by || "").toLowerCase()))
  }

  // Batch hydrate lead & event details for rich human-readable audit viewing
  const calIds: string[] = []
  const commIds: string[] = []
  const appIds: string[] = []
  const leadIds: string[] = []

  for (const log of filteredLogs) {
    let meta = log.metadata
    if (typeof meta === "string") {
      try { meta = JSON.parse(meta) } catch { meta = {} }
    }
    if (!meta || typeof meta !== "object") continue
    if (meta.calId && !meta.leadName) calIds.push(meta.calId)
    if ((meta.commId || meta.logId) && !meta.leadName) commIds.push(String(meta.commId || meta.logId))
    if ((meta.appId || meta.loanAppId) && !meta.leadName) appIds.push(String(meta.appId || meta.loanAppId))
    if (meta.leadId && !meta.leadName) leadIds.push(String(meta.leadId))
  }

  const [calRows, commRows, appRows, leadRows] = await Promise.all([
    calIds.length > 0
      ? query(
          `SELECT e.id, e.title, e.event_type, e.event_at, e.location, e.raw_quote, e.notes,
                  l.id AS lead_id, l.name AS lead_name, l.phone AS lead_phone, l.product_interest, l.loan_amount, l.address AS lead_address,
                  lm.summary AS memory_summary
             FROM calendar_events e
             LEFT JOIN leads l ON l.id = e.lead_id
             LEFT JOIN lead_memory lm ON lm.lead_id = l.id
            WHERE e.id = ANY($1::uuid[])`,
          [calIds]
        ).catch(() => ({ rows: [] as any[] }))
      : { rows: [] as any[] },
    commIds.length > 0
      ? query(
          `SELECT c.id, c.summary, c.outcome, c.lead_id,
                  l.name AS lead_name, l.phone AS lead_phone, l.product_interest, l.loan_amount, l.address AS lead_address,
                  lm.summary AS memory_summary
             FROM comm_logs c
             LEFT JOIN leads l ON l.id = c.lead_id
             LEFT JOIN lead_memory lm ON lm.lead_id = l.id
            WHERE c.id::text = ANY($1::text[])`,
          [commIds]
        ).catch(() => ({ rows: [] as any[] }))
      : { rows: [] as any[] },
    appIds.length > 0
      ? query(
          `SELECT a.id, a.customer_name, a.phone, a.loan_type, a.loan_amount, a.employment_type, a.monthly_income, a.city,
                  l.id AS lead_id, l.name AS lead_name, l.phone AS lead_phone, lm.summary AS memory_summary
             FROM loan_applications a
             LEFT JOIN leads l ON l.id = a.lead_id
             LEFT JOIN lead_memory lm ON lm.lead_id = l.id
            WHERE a.id = ANY($1::uuid[])`,
          [appIds]
        ).catch(() => ({ rows: [] as any[] }))
      : { rows: [] as any[] },
    leadIds.length > 0
      ? query(
          `SELECT l.id, l.name, l.phone, l.product_interest, l.loan_amount, l.address, lm.summary AS memory_summary
             FROM leads l
             LEFT JOIN lead_memory lm ON lm.lead_id = l.id
            WHERE l.id = ANY($1::uuid[])`,
          [leadIds]
        ).catch(() => ({ rows: [] as any[] }))
      : { rows: [] as any[] },
  ])

  const calMap = new Map(calRows.rows.map((r: any) => [String(r.id), r]))
  const commMap = new Map(commRows.rows.map((r: any) => [String(r.id), r]))
  const appMap = new Map(appRows.rows.map((r: any) => [String(r.id), r]))
  const leadMap = new Map(leadRows.rows.map((r: any) => [String(r.id), r]))

  const enrichedLogs = filteredLogs.map((log: any) => {
    let meta = log.metadata
    if (typeof meta === "string") {
      try { meta = JSON.parse(meta) } catch { meta = {} }
    }
    if (!meta || typeof meta !== "object") return log

    const enrichedMeta = { ...meta }

    if (meta.calId && calMap.has(String(meta.calId))) {
      const c = calMap.get(String(meta.calId))
      enrichedMeta.leadId = enrichedMeta.leadId || c.lead_id
      enrichedMeta.leadName = enrichedMeta.leadName || c.lead_name
      enrichedMeta.leadPhone = enrichedMeta.leadPhone || c.lead_phone
      enrichedMeta.productInterest = enrichedMeta.productInterest || c.product_interest || "Loan"
      enrichedMeta.loanAmount = enrichedMeta.loanAmount || c.loan_amount
      enrichedMeta.location = enrichedMeta.location || c.location || c.lead_address
      enrichedMeta.eventAt = enrichedMeta.eventAt || c.event_at
      enrichedMeta.category = enrichedMeta.category || (c.event_type === "branch_visit" ? "Office Visit" : "Callback")
      if (!enrichedMeta.fullDescription) {
        enrichedMeta.fullDescription = buildComprehensiveDescription({
          category: c.event_type,
          memory_summary: c.memory_summary,
          quote: c.raw_quote || c.notes,
          notes: c.notes,
          location: c.location,
          product_interest: c.product_interest,
          loan_amount: c.loan_amount,
          lead_address: c.lead_address,
        }) || c.title
      }
      enrichedMeta.resolutionNotes = enrichedMeta.resolutionNotes || meta.notes
    } else if ((meta.commId || meta.logId) && commMap.has(String(meta.commId || meta.logId))) {
      const cm = commMap.get(String(meta.commId || meta.logId))
      enrichedMeta.leadId = enrichedMeta.leadId || cm.lead_id
      enrichedMeta.leadName = enrichedMeta.leadName || cm.lead_name
      enrichedMeta.leadPhone = enrichedMeta.leadPhone || cm.lead_phone
      enrichedMeta.productInterest = enrichedMeta.productInterest || cm.product_interest || "Loan"
      enrichedMeta.loanAmount = enrichedMeta.loanAmount || cm.loan_amount
      enrichedMeta.location = enrichedMeta.location || cm.lead_address
      enrichedMeta.category = enrichedMeta.category || (cm.outcome?.includes("loan_confirmed") ? "Loan Confirmed" : "Escalation")
      if (!enrichedMeta.fullDescription) {
        enrichedMeta.fullDescription = buildComprehensiveDescription({
          category: cm.outcome,
          memory_summary: cm.memory_summary,
          quote: cm.summary,
          product_interest: cm.product_interest,
          loan_amount: cm.loan_amount,
          lead_address: cm.lead_address,
        }) || cm.summary
      }
      enrichedMeta.resolutionNotes = enrichedMeta.resolutionNotes || meta.notes
    } else if ((meta.appId || meta.loanAppId) && appMap.has(String(meta.appId || meta.loanAppId))) {
      const a = appMap.get(String(meta.appId || meta.loanAppId))
      enrichedMeta.leadId = enrichedMeta.leadId || a.lead_id
      enrichedMeta.leadName = enrichedMeta.leadName || a.customer_name || a.lead_name
      enrichedMeta.leadPhone = enrichedMeta.leadPhone || a.phone || a.lead_phone
      enrichedMeta.productInterest = enrichedMeta.productInterest || a.loan_type || "Loan"
      enrichedMeta.loanAmount = enrichedMeta.loanAmount || a.loan_amount
      enrichedMeta.category = "Loan Application"
      if (!enrichedMeta.fullDescription) {
        enrichedMeta.fullDescription = `Loan application submitted for ${a.loan_type || "loan"} of ₹${Number(a.loan_amount || 0).toLocaleString("en-IN")}${a.city ? ` in ${a.city}` : ""}. Monthly income: ₹${Number(a.monthly_income || 0).toLocaleString("en-IN")} (${a.employment_type || "salaried"}).`
      }
      enrichedMeta.resolutionNotes = enrichedMeta.resolutionNotes || meta.notes
    } else if (meta.leadId && leadMap.has(String(meta.leadId))) {
      const l = leadMap.get(String(meta.leadId))
      enrichedMeta.leadName = enrichedMeta.leadName || l.name
      enrichedMeta.leadPhone = enrichedMeta.leadPhone || l.phone
      enrichedMeta.productInterest = enrichedMeta.productInterest || l.product_interest
      enrichedMeta.loanAmount = enrichedMeta.loanAmount || l.loan_amount
      enrichedMeta.location = enrichedMeta.location || l.address
      if (!enrichedMeta.fullDescription && l.memory_summary) {
        enrichedMeta.fullDescription = l.memory_summary
      }
    }

    return { ...log, metadata: enrichedMeta }
  })

  return NextResponse.json({ settings: settings ?? [], logs: enrichedLogs })
}

export async function PATCH(req: NextRequest) {
  const session = await requireModuleOrRole(req, "security", ["admin"])

  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { key, enabled } = await req.json()
  if (typeof key !== "string" || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "key (string) and enabled (boolean) required" }, { status: 400 })
  }

  // 2FA requires at least one delivery channel (SMTP email or WhatsApp) so
  // the admin is not locked out at next sign-in.
  const mailConfigured = isMailConfigured()
  const adminPhone = process.env.ADMIN_PHONE || "+916301689511"
  const waConfigured = Boolean(process.env.WHATSAPP_TOKEN && adminPhone)
  if (key === "two_factor_auth" && enabled && !mailConfigured && !waConfigured) {
    return NextResponse.json(
      { error: "Configure SMTP (email) or WhatsApp before enabling Two-Factor Authentication — otherwise the login OTP cannot be delivered." },
      { status: 400 }
    )
  }
  await db.from("security_settings").update({ enabled, updated_at: new Date().toISOString() }).eq("key", key)
  await db
    .from("audit_logs")
    .insert({
      action: `${key} ${enabled ? "enabled" : "disabled"}`,
      performed_by: session?.email || "dashboard",
      metadata: { source: "dashboard" },
    })
    .catch(() => {})
  return NextResponse.json({ ok: true })
}
