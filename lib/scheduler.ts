// In-app background scheduler — runs inside the Next.js server process itself
// (via instrumentation.ts), so it works on any platform: local dev, a Linux
// GPU box, or a Kaggle session. Previously the daily digest ONLY ran via
// DIGEST.ps1 -Install, which registers a Windows Task Scheduler job — that
// silently does nothing on Linux, which is exactly where this app runs on
// Kaggle. This does not replace DIGEST.ps1 (still fine for a Windows-only
// deployment); it makes the automation portable everywhere else too.
//
// Deliberately NOT here: outbound call campaigns. Auto-dialing real phone
// numbers on a schedule spends real money and reaches real people without a
// human in the loop for that specific batch — that stays a manual dashboard
// action (Upload & Data -> batch controls), never automatic.

import cron from "node-cron"

let started = false

async function runDigest(period: "daily" | "weekly") {
  const appUrl = process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000"
  const apiKey = process.env.WHATSAPP_SERVICE_KEY
  if (!apiKey) {
    console.error(`[scheduler] ${period} digest skipped: WHATSAPP_SERVICE_KEY not set`)
    return
  }
  try {
    const res = await fetch(`${appUrl}/api/digest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ period }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    console.log(`[scheduler] ${period} digest sent — ${data.stats?.totalCalls ?? "?"} calls, ${data.stats?.qualifiedLeads ?? "?"} qualified`)
  } catch (e: any) {
    console.error(`[scheduler] ${period} digest failed:`, e.message)
  }
}

export function startScheduler() {
  // instrumentation.ts's register() can fire more than once in dev under
  // Next.js hot-reload — guard so we never register the same cron job twice.
  if (started) return
  started = true

  // Daily digest at 8:00 AM server time.
  cron.schedule("0 8 * * *", () => runDigest("daily"))
  // Weekly digest Monday 8:00 AM server time.
  cron.schedule("0 8 * * 1", () => runDigest("weekly"))

  console.log("[scheduler] in-app cron started — daily digest 08:00, weekly digest Mon 08:00 (server time)")
}
