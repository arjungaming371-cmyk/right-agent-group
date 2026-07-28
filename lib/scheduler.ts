// In-app background scheduler — runs inside the Next.js server process itself
// (via instrumentation.ts), so it works on any platform the app is deployed
// to, not just Windows. Previously the daily digest ONLY ran via
// DIGEST.ps1 -Install, which registers a Windows Task Scheduler job — that
// silently does nothing on a non-Windows deployment. This does not replace
// DIGEST.ps1 (still fine for the Windows on-premise deployment); it makes
// the automation portable everywhere else too.
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

// Lead Brain: catches WhatsApp threads that went idle 10+ minutes ago and
// runs the same background structured-memory extraction that calls get.
// Cheap no-op tick when nothing's idle (the scan-idle query itself finds 0
// rows), so a 5-minute interval is safe to leave running always.
async function runLeadBrainScan() {
  const appUrl = process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000"
  const apiKey = process.env.WHATSAPP_SERVICE_KEY
  if (!apiKey) return // same silent-skip as digest when unconfigured — never crash the scheduler
  try {
    const res = await fetch(`${appUrl}/api/lead-brain/scan-idle`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    if (data.scanned > 0) console.log(`[scheduler] lead brain: analyzed ${data.scanned} idle WhatsApp thread(s)`)
  } catch (e: any) {
    console.error("[scheduler] lead brain scan failed:", e.message)
  }
}

// Prompt Tuner: samples recent call transcripts weekly and proposes script
// improvements when the same friction repeats. Always lands as "pending" —
// never touches ai_scripts without an admin approving it on the dashboard.
async function runPromptTunerScan() {
  const appUrl = process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000"
  const apiKey = process.env.WHATSAPP_SERVICE_KEY
  if (!apiKey) return
  try {
    const res = await fetch(`${appUrl}/api/prompt-tuner/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    if (data.generated > 0) console.log(`[scheduler] prompt tuner: ${data.generated} new suggestion(s) awaiting review`)
  } catch (e: any) {
    console.error("[scheduler] prompt tuner scan failed:", e.message)
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
  // Lead Brain idle-WhatsApp scan, every 5 minutes.
  cron.schedule("*/5 * * * *", () => runLeadBrainScan())
  // Prompt Tuner, Sunday 09:00 server time — quiet day, after the week's calls have accumulated.
  cron.schedule("0 9 * * 0", () => runPromptTunerScan())

  console.log("[scheduler] in-app cron started — daily digest 08:00, weekly digest Mon 08:00, lead brain scan every 5m, prompt tuner Sun 09:00 (server time)")
}
