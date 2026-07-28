import { NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const [callsByDay, funnel, languageSplit, sentiment, callsByHour, totals] = await Promise.all([
      query(`
        SELECT to_char(d.day, 'Mon DD') AS day, COALESCE(c.count, 0)::int AS count
        FROM generate_series(CURRENT_DATE - interval '13 days', CURRENT_DATE, interval '1 day') d(day)
        LEFT JOIN (
          SELECT date_trunc('day', created_at) AS day, count(*) AS count
          FROM voice_calls WHERE created_at > now() - interval '14 days'
          GROUP BY 1
        ) c ON c.day = d.day
        ORDER BY d.day
      `),
      query(`
        SELECT
          count(*) FILTER (WHERE status = 'new')       AS new,
          count(*) FILTER (WHERE status = 'contacted')  AS contacted,
          count(*) FILTER (WHERE status = 'qualified')  AS qualified,
          (SELECT count(*) FROM loan_applications)      AS applied
        FROM leads
      `),
      query(`SELECT language, count(*)::int AS count FROM voice_calls GROUP BY language`),
      query(`SELECT sentiment, count(*)::int AS count FROM voice_calls WHERE sentiment IS NOT NULL GROUP BY sentiment`),
      query(`
        SELECT extract(hour from created_at)::int AS hour, count(*)::int AS count
        FROM voice_calls GROUP BY 1 ORDER BY 1
      `),
      query(`
        SELECT
          (SELECT count(*) FROM leads)                                          AS total_leads,
          (SELECT count(*) FROM voice_calls)                                    AS total_calls,
          (SELECT count(*) FROM whatsapp_messages)                              AS total_messages,
          (SELECT count(*) FROM leads WHERE status = 'qualified')               AS qualified_leads,
          (SELECT COALESCE(avg(duration), 0)::int FROM voice_calls WHERE duration > 0) AS avg_duration
      `),
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
