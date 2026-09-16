import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // Branch-scoped users get their branch's numbers only — the analytics
  // view IS the branch P&L picture for decentralized operations.
  const branchId = sessionBranchId(session)
  const params = branchId ? [branchId] : []
  // B() wraps a predicate with the branch filter when one applies.
  const B = (col: string) => (branchId ? `${col} = $1` : "TRUE")

  try {
    const [callsByDay, funnel, languageSplit, sentiment, callsByHour, totals] = await Promise.all([
      query(
        `
        SELECT to_char(d.day, 'Mon DD') AS day, COALESCE(c.count, 0)::int AS count
        FROM generate_series(CURRENT_DATE - interval '13 days', CURRENT_DATE, interval '1 day') d(day)
        LEFT JOIN (
          SELECT date_trunc('day', created_at) AS day, count(*) AS count
          FROM voice_calls WHERE created_at > now() - interval '14 days' AND ${B("branch_id")}
          GROUP BY 1
        ) c ON c.day = d.day
        ORDER BY d.day
      `,
        params
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
          (SELECT COALESCE(avg(duration), 0)::int FROM voice_calls WHERE ${B("branch_id")} AND duration > 0) AS avg_duration
      `,
        params
      ),
    ])

    return NextResponse.json({
      callsByDay: callsByDay.rows,
      funnel: funnel.rows[0],
      languageSplit: languageSplit.rows,
      sentiment: sentiment.rows,
      callsByHour: callsByHour.rows,
      totals: totals.rows[0],
    })
  } catch (e: any) {
    return apiError(e)
  }
}
