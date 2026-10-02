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
  // B() wraps a predicate with the branch filter when one applies.
  const B = (col: string) => (branchId ? `${col} = $1` : "TRUE")

  try {
    const [callsByDay, funnel, languageSplit, sentiment, callsByHour, totals] = await Promise.all([
      query(
        `
        SELECT to_char(d.day, 'Mon DD') AS day, COALESCE(c.count, 0)::int AS count
        FROM generate_series(CURRENT_DATE - ($2::int - 1) * interval '1 day', CURRENT_DATE, interval '1 day') d(day)
        LEFT JOIN (
          SELECT date_trunc('day', created_at) AS day, count(*) AS count
          FROM voice_calls WHERE created_at > now() - ($2::int * interval '1 day') AND ${B("branch_id")}
          GROUP BY 1
        ) c ON c.day = d.day
        ORDER BY d.day
      `,
        branchId ? [branchId, days] : [days]
      ),
      query(
        `
        SELECT
          count(*) FILTER (WHERE status = 'new')       AS new,
          count(*) FILTER (WHERE status = 'contacted')  AS contacted,
          count(*) FILTER (WHERE status = 'qualified')  AS qualified,
          (SELECT count(*) FROM loan_applications WHERE ${B("branch_id")})      AS applied
        FROM leads
        WHERE ${B("branch_id")}
      `,
        params
      ),
      query(`SELECT language, count(*)::int AS count FROM voice_calls WHERE ${B("branch_id")} GROUP BY language`, params),
      query(`SELECT sentiment, count(*)::int AS count FROM voice_calls WHERE sentiment IS NOT NULL AND ${B("branch_id")} GROUP BY sentiment`, params),
      query(
        `
        SELECT extract(hour from created_at)::int AS hour, count(*)::int AS count
        FROM voice_calls WHERE ${B("branch_id")} GROUP BY 1 ORDER BY 1
      `,
        params
      ),
      query(
        `
        SELECT
          (SELECT count(*) FROM leads WHERE ${B("branch_id")})                                          AS total_leads,
          (SELECT count(*) FROM voice_calls WHERE ${B("branch_id")})                                    AS total_calls,
          (SELECT count(*) FROM whatsapp_messages WHERE ${B("branch_id")})                              AS total_messages,
          (SELECT count(*) FROM leads WHERE ${B("branch_id")} AND status = 'qualified')                 AS qualified_leads,
          (SELECT COALESCE(avg(duration), 0)::int FROM voice_calls WHERE ${B("branch_id")} AND duration > 0) AS avg_duration,
          (SELECT count(*) FROM voice_calls WHERE ${B("branch_id")} AND duration > 0)                   AS connected_calls,
          (SELECT count(*) FROM voice_calls WHERE ${B("branch_id")} AND (outcome = 'resolved' OR status = 'completed')) AS resolved_calls,
          (SELECT count(*) FROM voice_calls WHERE ${B("branch_id")} AND outcome = 'needs_human')         AS needs_human,
          (SELECT count(*) FROM leads WHERE ${B("branch_id")} AND callback_at IS NOT NULL AND callback_at < now() + interval '1 day') AS followups_due,
          (SELECT count(*) FROM leads WHERE ${B("branch_id")} AND created_at > now() - interval '7 days')             AS new_leads_7d,
          (SELECT count(*) FROM loan_applications WHERE ${B("branch_id")})                              AS applications
      `,
        params
      ),
    ])

    const t = totals.rows[0] as Record<string, number>
    // Derived rates are computed in code (lib/maths), never hand-divided at
    // the call site — empty databases show 0% instead of NaN/Infinity.
    const rates = {
      connectRate: pctOf(t.connected_calls, t.total_calls),          // % of dials that actually picked up
      resolutionRate: pctOf(t.resolved_calls, t.total_calls),        // % of calls that ended resolved/completed
      conversionRate: pctOf(t.qualified_leads, t.total_leads),       // lead → qualified
      qualificationToApply: pctOf(t.qualified_leads, funnel.rows[0].applied), // qualified → applied (funnel handoff)
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
