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
  } catch (e) {
    console.error(`[scheduler] ${period} digest failed:`, e instanceof Error ? e.message : String(e))
  }
}

// Lead Brain: catches WhatsApp threads that went idle 10+ minutes ago and
// runs the same background structured-memory extraction that calls get.
// Cheap no-op tick when nothing's idle (the scan-idle query itself finds 0
// rows), so a 5-minute interval is safe to leave running always.
let leadBrainScanRunning = false
async function runLeadBrainScan() {
  // FIX (2026-09-20): if one scan takes longer than the 5-minute interval
  // (large idle backlog, slow Groq), overlapping scans processed the same
  // threads twice — duplicate analysis calls, duplicate tokens. Skip the tick
  // while the previous one is still running instead of overlapping.
  if (leadBrainScanRunning) {
    console.warn("[scheduler] lead brain scan still running — skipping this tick")
    return
  }
  leadBrainScanRunning = true
  try {
    await runLeadBrainScanInner()
  } finally {
    leadBrainScanRunning = false
  }
}

async function runLeadBrainScanInner() {
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
  } catch (e) {
    console.error("[scheduler] lead brain scan failed:", e instanceof Error ? e.message : String(e))
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
  } catch (e) {
    console.error("[scheduler] prompt tuner scan failed:", e instanceof Error ? e.message : String(e))
  }
}

// Instagram Comment Scanner: guarantees comments get automated replies across
// ALL posts (current and upcoming), even if Meta webhook delivery is delayed
// or filtered. Uses comments_count tracking to only query posts with new activity.
let igCommentScanRunning = false
const lastCommentCounts = new Map<string, number>()

async function runInstagramCommentScan() {
  if (igCommentScanRunning) return
  igCommentScanRunning = true
  try {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN
    const accountId = process.env.INSTAGRAM_ACCOUNT_ID || "me"
    if (!token) return

    const appUrl = process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000"
    const isIgLogin = token.startsWith("IG")
    const base = isIgLogin ? "https://graph.instagram.com/v21.0" : "https://graph.facebook.com/v21.0"
    const target = isIgLogin ? "me" : accountId

    // Scan up to 50 posts (covers all existing media and any new/upcoming posts)
    const mediaRes = await fetch(`${base}/${target}/media?fields=id,comments_count&limit=50&access_token=${token}`, {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!mediaRes || !mediaRes.ok) return
    const mediaData = await mediaRes.json().catch(() => null)
    const mediaList = mediaData?.data || []

    for (const m of mediaList) {
      if (!m.id) continue
      const currentCount = Number(m.comments_count || 0)
      if (currentCount <= 0) continue

      // Only inspect comments if comment count changed (saves API calls & rate limits)
      const lastCount = lastCommentCounts.get(m.id)
      if (lastCount !== undefined && lastCount === currentCount) continue

      const commRes = await fetch(`${base}/${m.id}/comments?fields=id,text,username,from,timestamp&limit=25&access_token=${token}`, {
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null)
      if (!commRes || !commRes.ok) continue
      const commData = await commRes.json().catch(() => null)
      const comments = commData?.data || []

      for (const c of comments) {
        if (!c.id || !c.text) continue
        const senderId = c.from?.id || ""
        const username = (c.from?.username || c.username || "").toLowerCase()
        if (senderId === accountId) continue

        await fetch(`${appUrl}/api/instagram`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            object: "instagram",
            entry: [
              {
                id: accountId,
                time: Date.now(),
                changes: [
                  {
                    field: "comments",
                    value: {
                      id: c.id,
                      text: c.text,
                      from: c.from || { id: c.id, username: c.username || "instagram_user" },
                      media: { id: m.id },
                    },
                  },
                ],
              },
            ],
          }),
        }).catch(() => null)
      }

      // Record updated count for this post
      lastCommentCounts.set(m.id, currentCount)
    }
  } catch (e) {
    console.error("[scheduler] instagram comment scan failed:", e instanceof Error ? e.message : e)
  } finally {
    igCommentScanRunning = false
  }
}

// Instagram Direct Message Scanner:
// Fetches latest conversations and inbound messages every 15s to guarantee
// automated replies even if Meta webhooks are blocked, delayed, or in development mode.
let igDMScanRunning = false
async function runInstagramDMScan() {
  if (igDMScanRunning) return
  igDMScanRunning = true
  try {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN
    const accountId = process.env.INSTAGRAM_ACCOUNT_ID || "28501470066151828"
    if (!token) return

    const appUrl = process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000"
    const isIgLogin = token.startsWith("IG")
    const base = isIgLogin ? "https://graph.instagram.com/v21.0" : "https://graph.facebook.com/v21.0"
    const target = isIgLogin ? "me" : accountId

    const convRes = await fetch(
      `${base}/${target}/conversations?fields=messages.limit(5){id,created_time,from,to,message}&limit=10&access_token=${token}`,
      { signal: AbortSignal.timeout(10_000) }
    ).catch(() => null)
    if (!convRes || !convRes.ok) return
    const convData = await convRes.json().catch(() => null)
    const convList = convData?.data || []

    const { query } = await import("@/lib/db")

    for (const conv of convList) {
      const messages = conv.messages?.data || []
      for (const m of messages) {
        if (!m.id || !m.message) continue
        const senderId = m.from?.id || ""
        const senderUsername = (m.from?.username || "").toLowerCase()

        // Skip our own outbound messages
        if (senderId === accountId || senderUsername === "arjungaming371") continue

        // Check if message is within the last 48 hours to avoid re-triggering ancient messages
        const msgTime = new Date(m.created_time).getTime()
        if (isNaN(msgTime) || Date.now() - msgTime > 48 * 3600 * 1000) continue

        // Check if message already exists in DB
        const existing = await query(
          `SELECT 1 FROM instagram_messages WHERE ig_message_id = $1 LIMIT 1`,
          [m.id]
        )
        if (existing.rows.length > 0) continue

        // Dispatch inbound DM to /api/instagram
        await fetch(`${appUrl}/api/instagram`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            object: "instagram",
            entry: [
              {
                id: accountId,
                time: Date.now(),
                messaging: [
                  {
                    sender: { id: senderId, username: senderUsername },
                    recipient: { id: accountId },
                    timestamp: msgTime,
                    message: {
                      mid: m.id,
                      text: m.message,
                    },
                  },
                ],
              },
            ],
          }),
        }).catch(() => null)
      }
    }
  } catch (e) {
    console.error("[scheduler] instagram DM scan failed:", e instanceof Error ? e.message : e)
  } finally {
    igDMScanRunning = false
  }
}

// Calendar Agent: scans unprocessed voice calls periodically to detect appointments
let calendarScanRunning = false
async function runCalendarAgentScan() {
  if (calendarScanRunning) return
  calendarScanRunning = true
  try {
    const { scanVoiceCalls } = await import("@/lib/calendar-agent")
    const res = await scanVoiceCalls({ limit: 15, dryRun: false })
    if (res.scanned > 0) {
      console.log(`[scheduler] calendar agent: scanned ${res.scanned} call(s), discovered ${res.discovered.length} event(s) (${res.confirmed} confirmed, ${res.needsReview} review)`)
    }
  } catch (e) {
    console.error("[scheduler] calendar agent scan failed:", e instanceof Error ? e.message : String(e))
  } finally {
    calendarScanRunning = false
  }
}

// Automated Due Callbacks Runner: dials scheduled callbacks whose scheduled_at time has arrived
let dueCallbacksRunning = false
async function runDueCallbacksTick() {
  if (dueCallbacksRunning) return
  dueCallbacksRunning = true
  try {
    const { isWithinCallingWindow } = await import("@/lib/compliance")
    if (!(await isWithinCallingWindow())) return

    const { isAiPaused } = await import("@/lib/ai-pause")
    if (await isAiPaused("calls")) return

    const { query, db } = await import("@/lib/db")
    const { placeOutboundCall } = await import("@/lib/outbound-dial")
    const { normalizePhone } = await import("@/lib/phone")
    const { renderInstructionsForLead } = await import("@/lib/script-studio")

    // Claim up to 2 due callbacks atomically
    const claimRes = await query(
      `UPDATE outbound_queue
       SET status = 'dialing', claimed_at = now()
       WHERE id IN (
         SELECT id FROM outbound_queue
         WHERE status = 'pending' AND scheduled_at <= now()
         ORDER BY priority DESC, scheduled_at ASC
         LIMIT 2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, lead_id, phone, name, language, product_interest, notes, branch_id, channel, talking_points`
    )

    for (const item of claimRes.rows) {
      try {
        const phone = normalizePhone(item.phone)
        if (!phone) {
          await db.from("outbound_queue").update({ status: "failed", outcome: "failed", outcome_detail: "invalid phone" }).eq("id", item.id)
          continue
        }

        const requested = item.channel === "whatsapp_voice" ? "whatsapp" : item.channel === "phone" ? "phone" : "auto"
        const instructions = renderInstructionsForLead(item.talking_points || item.notes || null, item, null)

        const placed = await placeOutboundCall({
          phone,
          leadId: item.lead_id || null,
          language: item.language || "telugu",
          requested,
          branchId: item.branch_id || null,
          instructions,
        })

        await db.from("outbound_queue")
          .update({ status: "called", call_sid: placed.callSid, called_at: new Date().toISOString() })
          .eq("id", item.id)

        console.log(`[scheduler] Auto-dialed due callback for ${item.name || phone} via ${placed.channel}`)
      } catch (dialErr: any) {
        console.error(`[scheduler] Due callback dial error for ${item.phone}:`, dialErr?.message || dialErr)
        await db.from("outbound_queue")
          .update({ status: "failed", outcome: "failed", outcome_detail: String(dialErr?.message || dialErr).slice(0, 300) })
          .eq("id", item.id)
      }
    }
  } catch (err: any) {
    console.error("[scheduler] runDueCallbacksTick error:", err?.message || err)
  } finally {
    dueCallbacksRunning = false
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
  // Calendar Agent periodic background scan, every 15 minutes.
  cron.schedule("*/15 * * * *", () => runCalendarAgentScan())

  // Automated Due Callback Runner: checks every 30s to dial scheduled callbacks on time
  setInterval(() => {
    runDueCallbacksTick().catch(() => {})
  }, 30_000)

  // Automated Instagram comment poller: runs every 20s to catch new comments
  setInterval(() => {
    runInstagramCommentScan().catch(() => {})
  }, 20_000)

  // Automated Instagram DM poller: runs every 15s to catch new direct messages
  setInterval(() => {
    runInstagramDMScan().catch(() => {})
  }, 15_000)

  console.log("[scheduler] in-app cron started — due callbacks every 30s, daily digest 08:00, weekly digest Mon 08:00, lead brain scan every 5m, prompt tuner Sun 09:00, calendar agent scan every 15m, ig comment scan every 20s, ig DM scan every 15s")
}
