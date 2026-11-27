import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { pctOf } from "@/lib/maths"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "analytics", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // Branch-scoped users get their branch's numbers only — the analytics
  // view IS the branch P&L picture for decentralized operations.
  let branchId = sessionBranchId(session)

  // Date-range filter (?days=7|14|30, default 14 — the historical window).
  const daysRaw = Number(req.nextUrl.searchParams.get("days") || 14)
  const days = [7, 14, 30].includes(daysRaw) ? daysRaw : 14

  // Explicit branch filter for parents (admin/developer) — ?branch=<uuid> or
  // "all" to combine every branch. Branch-scoped roles can never widen.
  const branchParam = req.nextUrl.searchParams.get("branch")
  if (!branchId && (session.role === "admin" || session.role === "developer")) {
    if (branchParam && branchParam !== "all" && /^[0-9a-f-]{36}$/i.test(branchParam)) branchId = branchParam
    else if (branchParam === "all") branchId = null
  }

  const params = branchId ? [branchId] : []
  const queryParams = branchId ? [branchId, days] : [days]
  // B() wraps a predicate with the branch filter when one applies.
  const B = (col: string) => (branchId ? `${col} = $1` : "TRUE")
  const dayParam = branchId ? "$2" : "$1"

  try {
    const [callsByDay, funnel, languageSplit, sentiment, callsByHour, totals] = await Promise.all([
      query(
        `
        SELECT to_char(d.day, 'Mon DD') AS day, COALESCE(c.count, 0)::int AS count
        FROM generate_series(CURRENT_DATE - (${dayParam}::int - 1) * interval '1 day', CURRENT_DATE, interval '1 day') d(day)
        LEFT JOIN (
          SELECT date_trunc('day', created_at) AS day, count(*) AS count
          FROM voice_calls WHERE created_at > now() - (${dayParam}::int * interval '1 day') AND ${B("branch_id")}
          GROUP BY 1
        ) c ON c.day = d.day
        ORDER BY d.day
      `,
        queryParams
      ),
      query(
        `
        SELECT
          count(*) FILTER (WHERE status = 'new')       AS new,
          count(*) FILTER (WHERE status = 'contacted')  AS contacted,
          count(*) FILTER (WHERE (status IN ('qualified', 'interested', 'form_opened', 'approved', 'docs_pending', 'link_sent', 'sanctioned', 'disbursed') OR score >= 70))  AS qualified,
          (SELECT count(*) FROM loan_applications WHERE ${B("branch_id")})      AS applied
        FROM leads
        WHERE ${B("branch_id")} AND (is_social_prospect IS NOT TRUE)
      `,
        params
      ),
      query(
        `SELECT language, count(*)::int AS count FROM voice_calls WHERE ${B("branch_id")} AND created_at > now() - (${dayParam}::int * interval '1 day') GROUP BY language`,
        queryParams
      ),
      query(
        `SELECT sentiment, count(*)::int AS count FROM voice_calls WHERE sentiment IS NOT NULL AND ${B("branch_id")} AND created_at > now() - (${dayParam}::int * interval '1 day') GROUP BY sentiment`,
        queryParams
      ),
      query(
        `
        SELECT extract(hour from created_at)::int AS hour, count(*)::int AS count
        FROM voice_calls WHERE ${B("branch_id")} AND created_at > now() - (${dayParam}::int * interval '1 day') GROUP BY 1 ORDER BY 1
      `,
        queryParams
      ),
      query(
        `
        SELECT
          (SELECT count(*)::int FROM leads WHERE ${B("branch_id")} AND (is_social_prospect IS NOT TRUE))                                          AS total_leads,
          (SELECT count(*)::int FROM voice_calls WHERE ${B("branch_id")} AND created_at > now() - (${dayParam}::int * interval '1 day')) AS total_calls,
          (SELECT count(*)::int FROM whatsapp_messages WHERE ${B("branch_id")} AND created_at > now() - (${dayParam}::int * interval '1 day')) AS total_messages,
          (SELECT count(*)::int FROM leads WHERE ${B("branch_id")} AND (is_social_prospect IS NOT TRUE) AND (status IN ('qualified', 'interested', 'form_opened', 'approved', 'docs_pending', 'link_sent', 'sanctioned', 'disbursed') OR score >= 70)) AS qualified_leads,
          (SELECT COALESCE(avg(duration), 0)::int FROM voice_calls WHERE ${B("branch_id")} AND duration > 0 AND created_at > now() - (${dayParam}::int * interval '1 day')) AS avg_duration,
          (SELECT count(*)::int FROM voice_calls WHERE ${B("branch_id")} AND (duration > 0 OR outcome IN ('completed', 'answered', 'resolved')) AND created_at > now() - (${dayParam}::int * interval '1 day')) AS connected_calls,
          (SELECT count(*)::int FROM voice_calls WHERE ${B("branch_id")} AND (outcome IN ('resolved', 'completed', 'answered') OR status = 'completed') AND created_at > now() - (${dayParam}::int * interval '1 day')) AS resolved_calls,
          (SELECT count(*)::int FROM voice_calls WHERE ${B("branch_id")} AND outcome = 'needs_human' AND created_at > now() - (${dayParam}::int * interval '1 day')) AS needs_human,
          (SELECT count(*)::int FROM leads WHERE ${B("branch_id")} AND (is_social_prospect IS NOT TRUE) AND callback_at IS NOT NULL AND callback_at < now() + interval '1 day') AS followups_due,
          (SELECT count(*)::int FROM leads WHERE ${B("branch_id")} AND (is_social_prospect IS NOT TRUE) AND created_at > now() - (${dayParam}::int * interval '1 day'))             AS new_leads_7d,
          (SELECT count(*)::int FROM loan_applications WHERE ${B("branch_id")})                              AS applications,
          (SELECT count(*)::int FROM leads WHERE ${B("branch_id")} AND is_social_prospect = true)           AS instagram_prospects
      `,
        queryParams
      ),
    ])

    const t = totals.rows[0] as Record<string, any>
    const totalCalls = Number(t?.total_calls || 0)
    const connectedCalls = Number(t?.connected_calls || 0)
    const resolvedCalls = Number(t?.resolved_calls || 0)
    const totalLeads = Number(t?.total_leads || 0)
    const qualifiedLeads = Number(t?.qualified_leads || 0)
    const appliedLeads = Number(funnel.rows[0]?.applied || 0)

    // Derived rates are computed in code (lib/maths), never hand-divided at
    // the call site — empty databases show 0% instead of NaN/Infinity.
    const rates = {
      connectRate: pctOf(connectedCalls, totalCalls),          // % of dials that actually picked up
      resolutionRate: pctOf(resolvedCalls, totalCalls),        // % of calls that ended resolved/completed
      conversionRate: pctOf(qualifiedLeads, totalLeads),       // lead → qualified
      qualificationToApply: pctOf(qualifiedLeads, appliedLeads), // qualified → applied (funnel handoff)
    }

    return NextResponse.json({
      callsByDay: callsByDay.rows,
      funnel: funnel.rows[0],
      languageSplit: languageSplit.rows,
      sentiment: sentiment.rows,
      callsByHour: callsByHour.rows,
      totals: totals.rows[0],
      rates,
    })
  } catch (e: any) {
    return apiError(e)
  }
}
