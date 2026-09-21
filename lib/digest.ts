// AI performance digest — one email, sent daily or weekly, summarizing
// what happened across calls + WhatsApp. All the numbers come straight from
// SQL (fast, exact); a single Groq call turns them into a short written
// highlight paragraph. Nothing here blocks a live call or chat — this is
// only ever invoked by a scheduled job or a manual dashboard button.

import { query } from "./db"
import { isMailConfigured, sendMail } from "./mail"
import { chatWithSystemPrompt } from "./llm"
import { escapeHtml } from "./utils"

type DigestStats = {
  periodLabel: string
  totalCalls: number
  callsResolved: number
  callsMissed: number
  callsFailed: number
  avgDuration: number
  sentiment: { positive: number; neutral: number; negative: number; frustrated: number }
  newLeads: number
  qualifiedLeads: number
  waInbound: number
  waOutbound: number
  needsHuman: { leadName: string; summary: string; createdAt: string }[]
  negativeSummaries: string[]
}

async function collectStats(days: number): Promise<DigestStats> {
  const periodLabel = days === 1 ? "Last 24 hours" : `Last ${days} days`

  // `days` is parameterized ($1 * interval '1 day') rather than interpolated
  // — today it is only ever the literal 1 or 7 from two routes, but one
  // refactor away from SQLi is one too many.
  const calls = await query(
    `SELECT outcome, sentiment, duration FROM voice_calls WHERE created_at > now() - ($1 * interval '1 day')`,
    [days]
  )
  const totalCalls = calls.rows.length
  const callsResolved = calls.rows.filter((c: any) => c.outcome === "resolved").length
  const callsMissed = calls.rows.filter((c: any) => c.outcome === "missed").length
  const callsFailed = calls.rows.filter((c: any) => c.outcome === "failed").length
  const avgDuration = totalCalls
    ? Math.round(calls.rows.reduce((s: number, c: any) => s + (c.duration || 0), 0) / totalCalls)
    : 0
  const sentiment = {
    positive: calls.rows.filter((c: any) => c.sentiment === "Positive").length,
    neutral: calls.rows.filter((c: any) => c.sentiment === "Neutral").length,
    negative: calls.rows.filter((c: any) => c.sentiment === "Negative").length,
    frustrated: calls.rows.filter((c: any) => c.sentiment === "Frustrated").length,
  }

  const leadsRes = await query(
    `SELECT
       count(*) FILTER (WHERE created_at > now() - ($1 * interval '1 day')) AS new_leads,
       count(*) FILTER (WHERE status = 'qualified' AND updated_at > now() - ($1 * interval '1 day')) AS qualified
     FROM leads`,
    [days]
  )
  const newLeads = Number(leadsRes.rows[0]?.new_leads || 0)
  const qualifiedLeads = Number(leadsRes.rows[0]?.qualified || 0)

  const waRes = await query(
    `SELECT
       count(*) FILTER (WHERE direction = 'inbound')  AS wa_in,
       count(*) FILTER (WHERE direction = 'outbound') AS wa_out
     FROM whatsapp_messages WHERE created_at > now() - ($1 * interval '1 day')`,
    [days]
  )
  const waInbound = Number(waRes.rows[0]?.wa_in || 0)
  const waOutbound = Number(waRes.rows[0]?.wa_out || 0)

  const alertsRes = await query(
    `SELECT cl.summary, cl.created_at, l.name AS lead_name
     FROM comm_logs cl LEFT JOIN leads l ON l.id = cl.lead_id
     WHERE cl.type = 'alert' AND cl.outcome = 'needs_human' AND cl.created_at > now() - ($1 * interval '1 day')
     ORDER BY cl.created_at DESC LIMIT 10`,
    [days]
  )
  const needsHuman = alertsRes.rows.map((r: any) => ({
    leadName: r.lead_name || "Unknown lead",
    summary: r.summary,
    createdAt: r.created_at,
  }))

  const negRes = await query(
    `SELECT ai_summary FROM voice_calls
     WHERE sentiment IN ('Negative', 'Frustrated') AND ai_summary IS NOT NULL
       AND created_at > now() - ($1 * interval '1 day')
     ORDER BY created_at DESC LIMIT 8`,
    [days]
  )
  const negativeSummaries = negRes.rows.map((r: any) => r.ai_summary).filter(Boolean)

  return {
    periodLabel, totalCalls, callsResolved, callsMissed, callsFailed, avgDuration,
    sentiment, newLeads, qualifiedLeads, waInbound, waOutbound, needsHuman, negativeSummaries,
  }
}

async function writeHighlights(stats: DigestStats): Promise<string> {
  if (stats.totalCalls === 0 && stats.newLeads === 0 && stats.waInbound === 0) {
    return "No call or WhatsApp activity in this period."
  }
  try {
    const prompt = `You write a short, plain-English performance highlight for a loan business owner. 2-4 sentences, no headers, no bullet points, no markdown.

Stats for ${stats.periodLabel}:
- ${stats.totalCalls} calls (${stats.callsResolved} completed, ${stats.callsMissed} missed, ${stats.callsFailed} failed)
- Sentiment: ${stats.sentiment.positive} positive, ${stats.sentiment.neutral} neutral, ${stats.sentiment.negative} negative, ${stats.sentiment.frustrated} frustrated
- ${stats.newLeads} new leads, ${stats.qualifiedLeads} qualified
- ${stats.waInbound} inbound WhatsApp messages, ${stats.waOutbound} sent
- ${stats.needsHuman.length} calls/chats flagged as needing a human

Recent negative-call summaries (for spotting common objections, don't quote them verbatim):
${stats.negativeSummaries.slice(0, 5).join("\n") || "(none)"}

Write the highlight now — mention what went well, and call out any objection pattern you notice if there is one.`

    const text = await chatWithSystemPrompt(
      [{ role: "user", content: prompt }],
      "You write short, plain-English business performance highlights. No markdown, no headers.",
      { numPredict: 200, timeoutMs: 30000 }
    )
    return text.trim() || "Summary unavailable this period."
  } catch (e: any) {
    console.error("digest highlight generation error:", e.message)
    return "Summary unavailable — the AI engine could not be reached."
  }
}

function statRow(label: string, value: string | number) {
  return `<tr><td style="padding:8px 0;font-size:13px;color:#6b7280">${label}</td><td style="padding:8px 0;font-size:14px;font-weight:700;color:#171a24;text-align:right">${value}</td></tr>`
}

export async function generateAndSendDigest(days: number): Promise<{ ok: boolean; error?: string; stats?: DigestStats }> {
  const stats = await collectStats(days)
  const highlights = await writeHighlights(stats)

  const to = process.env.ADMIN_EMAIL || ""
  if (!to || !isMailConfigured()) {
    return { ok: false, error: "SMTP or ADMIN_EMAIL not configured", stats }
  }

  // leadName and summary include caller/lead-controlled text — escaped so a
  // lead named "<a href=...>" renders as text in the admin's inbox, not markup.
  const needsHumanHtml = stats.needsHuman.length
    ? stats.needsHuman.map((n) => `<li style="margin-bottom:6px"><strong>${escapeHtml(n.leadName)}</strong> — ${escapeHtml(n.summary)}</li>`).join("")
    : `<li style="color:#9ca3af">None — nobody needed escalation this period.</li>`

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  <div style="background:linear-gradient(135deg,#8b7cff,#5b7cfa 45%,#38bdf8);border-radius:12px 12px 0 0;padding:24px">
    <div style="font-size:20px;font-weight:700;color:#fff">${stats.periodLabel} — Performance Digest</div>
    <div style="font-size:13px;color:#eef1ff;margin-top:4px">Right Agent Group · Operations Console</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
    <p style="font-size:14px;line-height:1.6;margin:0 0 20px">${escapeHtml(highlights)}</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      ${statRow("Total calls", stats.totalCalls)}
      ${statRow("Completed", stats.callsResolved)}
      ${statRow("Missed", stats.callsMissed)}
      ${statRow("Avg. call duration", `${Math.floor(stats.avgDuration / 60)}m ${stats.avgDuration % 60}s`)}
      ${statRow("New leads", stats.newLeads)}
      ${statRow("Qualified leads", stats.qualifiedLeads)}
      ${statRow("WhatsApp received", stats.waInbound)}
      ${statRow("WhatsApp sent", stats.waOutbound)}
    </table>

    <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:8px">Needs a human follow-up</div>
    <ul style="font-size:13px;line-height:1.6;color:#4b5563;margin:0;padding-left:18px">${needsHumanHtml}</ul>
  </div>
</div>`

  // FIX (2026-09-20): idempotency. The digest can be triggered twice for the
  // same period — the in-app scheduler fires at 08:00 AND the Windows
  // Task Scheduler job (DIGEST.ps1) fires at 08:00 on the on-prem deployment,
  // plus /api/digest/send lets a user click "send now". Claim the period key
  // atomically first so the admin gets ONE email per period. Legacy DBs
  // without the digest_sent_log table (pre-migration) keep the old behaviour.
  const periodKind = days >= 7 ? "weekly" : "daily"
  const now = new Date()
  const periodKey = `${periodKind}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  try {
    const claim = await query(
      `INSERT INTO digest_sent_log (period_key, recipient) VALUES ($1, $2) ON CONFLICT (period_key) DO NOTHING`,
      [periodKey, to]
    )
    if ((claim.rowCount || 0) === 0) {
      return { ok: false, error: `digest for ${periodKey} was already sent`, stats }
    }
  } catch (e: any) {
    if (e?.code !== "42703") throw e // table missing → legacy behaviour
  }

  const result = await sendMail({ to, subject: `${stats.periodLabel} Digest — ${stats.totalCalls} calls, ${stats.qualifiedLeads} qualified`, html })
  return { ok: result.ok, error: result.error, stats }
}
