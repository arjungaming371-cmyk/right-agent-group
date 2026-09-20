import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { generateAndSendDigest } from "@/lib/digest"
import { safeEqual } from "@/lib/security"

export const dynamic = "force-dynamic"

// Triggered by DIGEST.ps1 (scheduled) or the "Email me this report" button
// in the dashboard. Protected by the same internal service key used for
// the voicebot bridge — this sends real email, so it isn't public.
export async function POST(req: NextRequest) {
  // timing-safe compare (2026-09 hardening): the service key is a bearer
  // credential; a plain === leaks its bytes one microsecond at a time.
  const key = req.headers.get("x-api-key") || ""
  const expected = process.env.WHATSAPP_SERVICE_KEY || ""
  if (!expected || !safeEqual(key, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const period = body?.period === "weekly" ? "weekly" : "daily"
  const days = period === "weekly" ? 7 : 1

  // 2026-09 fix (double-send): BOTH the in-app cron (lib/scheduler.ts, 08:00)
  // and DIGEST.ps1 Task Scheduler (also 08:00) can trigger this route, so a
  // Windows on-prem deployment received the digest TWICE every day. A
  // DB-backed sent-log keyed by period+date makes it once-per-day no matter
  // how many schedulers fire — the INSERT claims the slot atomically across
  // processes. The manual "Email me this report" button (/api/digest/send)
  // deliberately bypasses this: admins may always force a re-send.
  const sentKey = `digest:${period}:${new Date().toISOString().slice(0, 10)}`
  const claim = await query(
    `INSERT INTO form_configs (id, config, updated_at)
     VALUES ($1, '{}'::jsonb, now())
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [sentKey]
  )
  if ((claim.rowCount || 0) === 0) {
    return NextResponse.json({ ok: true, period, skipped: "digest already sent today" })
  }
  // Housekeeping: prune sent-log rows older than 60 days.
  query(`DELETE FROM form_configs WHERE id LIKE 'digest:%' AND updated_at < now() - interval '60 days'`).catch(() => {})

  const result = await generateAndSendDigest(days)
  if (!result.ok) return NextResponse.json({ error: result.error, stats: result.stats }, { status: 502 })
  return NextResponse.json({ ok: true, period, stats: result.stats })
}
