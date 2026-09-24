// Post-call finalization for WHATSAPP voice calls.
//
// Exotel calls finish through /api/calls/status (Exotel's status webhook):
// sentiment, lead status bump, WhatsApp follow-up templates, AI summary,
// comm_logs, Lead Brain analysis. A WhatsApp call has no Exotel webhook —
// Meta delivers a "terminate" event on the calls field instead, and
// app/api/whatsapp hands it here. The routine mirrors the Exotel flow so a
// WhatsApp call produces the SAME follow-ups, logs and analytics as a phone
// call — one funnel, two networks.
//
// The voicebot itself (server/whatsapp-calls.js) has already reported the
// real duration via /api/calls/turn event=end by the time this runs; the
// voice_calls row may not exist at all when the call was never answered
// (no session → no turns → no row), which this handles.

import { db, query } from "@/lib/db"
import { generateLeadSummary } from "@/lib/llm"
import { sendCallFollowUp, sendMissedCallFollowUp, branchWhatsAppCtx } from "@/lib/whatsapp"
import { refreshLeadScore } from "@/lib/scoring"
import { runPostCallAnalysis } from "@/lib/lead-brain"

export type WhatsAppCallOutcome = "resolved" | "missed" | "rejected" | "failed"

/**
 * Internal sid for a WhatsApp voice call — the same wacall-<call_id> form
 * the voicebot uses on /api/calls/turn, so voice_calls rows, Voice Logs and
 * this finalizer all key off one id.
 */
export function callSidFor(callId: string): string {
  return `wacall-${callId}`
}

/** Map Meta's terminate status to the funnel outcome vocabulary. */
export function mapCallOutcome(status?: string | null): WhatsAppCallOutcome {
  const s = String(status || "").toLowerCase()
  if (s === "completed") return "resolved"
  if (s === "rejected") return "rejected"
  if (s === "failed") return "failed"
  // unanswered, busy, canceled, anything unknown — treat as a real miss
  return "missed"
}

export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r}s`
  return `${m}m ${String(r).padStart(2, "0")}s`
}

/**
 * Finalize one WhatsApp call. Safe to call more than once: the call-history
 * row is deduped by wa_message_id (Meta retries webhooks) and the follow-up
 * is claimed atomically on the voice_calls row.
 *
 * @param callSid  the internal sid (wacall-<call_id>) the voicebot used
 * @param callId   the raw Meta call id (dedupe key for the chat row)
 * @param from     the caller's WhatsApp id (E.164 digits) — lead matching
 * @param outcome  mapped terminate status
 */
// Transcript turn shape stored in voice_calls.transcript (jsonb array).
type TranscriptTurn = { role?: unknown; text?: unknown }

type VoiceCallRow = {
  lead_id: string | null
  duration: unknown
  branch_id: string | null
  transcript: unknown
  followup_sent: boolean | null
  ai_summary: string | null
}

export async function finalizeWhatsAppCall(opts: {
  callSid: string
  callId: string
  from: string
  outcome: WhatsAppCallOutcome
  branchIdFromWebhook?: string | null
}): Promise<void> {
  const { callSid, callId, from, outcome } = opts
  if (!callId || !from) return

  // ---- 1. The call's own row (turn start created it for ANSWERED calls) ----
  let call: VoiceCallRow | null = null
  try {
    const res = await query(
      `SELECT lead_id, duration, branch_id, transcript, followup_sent, ai_summary
         FROM voice_calls WHERE twilio_call_sid = $1 LIMIT 1`,
      [callSid]
    )
    call = (res.rows[0] as VoiceCallRow) || null
  } catch (e) {
    console.error("wa finalize: voice_calls lookup failed:", e instanceof Error ? e.message : e)
  }

  // ---- 2. Resolve the lead (answered: from the call row; missed: by phone) ----
  let leadId: string | null = call?.lead_id || null
  const digits = String(from).replace(/\D/g, "")
  const last10 = digits.slice(-10)
  if (!leadId && last10.length === 10) {
    try {
      const found = await query(
        `SELECT id FROM leads WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1 LIMIT 1`,
        [last10]
      )
      leadId = found.rows[0]?.id || null
      if (!leadId) {
        // Missed call from a number we've never seen: create the lead — the
        // missed-call follow-up (and the agent's callback) needs a lead row.
        const created = await db
          .from("leads")
          .insert({
            name: `WA caller ${last10.slice(-4)}`,
            phone: `+${digits}`,
            whatsapp_number: `+${digits}`,
            source: "whatsapp_call",
            status: "new",
            branch_id: opts.branchIdFromWebhook || call?.branch_id || null,
          })
          .select()
          .single()
        leadId = created?.data?.id || null
      }
    } catch (e) {
      console.error("wa finalize: lead resolve failed:", e instanceof Error ? e.message : e)
    }
  }

  // ---- 3. Call-history bubble in the WhatsApp chat (dedupe = Meta retries) ----
  // Answered calls → status 'logged' (do NOT bump the unread badge — real
  // WhatsApp doesn't either). Missed/rejected/failed → 'received' so the
  // chat list shows the badge, exactly like a missed call on the real app.
  const duration = Number(call?.duration || 0)
  const answered = outcome === "resolved" && duration > 0
  const bubbleContent = answered
    ? `📞 Voice call · ${formatCallDuration(duration)}`
    : outcome === "rejected"
      ? "📞 Declined voice call"
      : outcome === "failed"
        ? "📞 Voice call failed"
        : "📞 Missed voice call"
  const waCallRowId = `wacall-${callId}`
  try {
    const claim = await query(
      `INSERT INTO whatsapp_messages
         (wa_message_id, lead_id, phone_number, direction, content, status, msg_type, branch_id)
       VALUES ($1, $2, $3, 'inbound', $4, $5, 'call', $6)
       ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING`,
      [waCallRowId, leadId, `+${digits}`, bubbleContent, answered ? "logged" : "received", call?.branch_id || opts.branchIdFromWebhook || null]
    )
    // A duplicate bubble means this call was already finalized — stop here
    // so Meta webhook retries can't double-send follow-up templates.
    if ((claim.rowCount || 0) === 0) return
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: unknown }).code === "42703") {
      // Pre-rich-chat DB (no msg_type column) — insert the plain row.
      await query(
        `INSERT INTO whatsapp_messages
           (wa_message_id, lead_id, phone_number, direction, content, status)
         VALUES ($1, $2, $3, 'inbound', $4, $5)
         ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING`,
        [waCallRowId, leadId, `+${digits}`, bubbleContent, answered ? "logged" : "received"]
      ).catch(() => {})
    } else {
      console.error("wa finalize: bubble insert failed:", e instanceof Error ? e.message : e)
    }
  }

  if (!leadId) return

  // ---- 4. Transcript sentiment + lead status (same rules as Exotel) ----
  const transcript = Array.isArray(call?.transcript) ? (call.transcript as TranscriptTurn[]) : []
  const allText = transcript.map((t) => (typeof t.text === "string" ? t.text : "")).join(" ").toLowerCase()
  const positiveWords = /yes\b|interested|please|confirm|okay|ok\b|sure|good|great/
  const negativeWords = /\bno\b|not interested|busy|later|cancel|dont|nope/
  const sentiment = !answered
    ? "Neutral"
    : negativeWords.test(allText)
      ? "Negative"
      : positiveWords.test(allText)
        ? "Positive"
        : "Neutral"

  if (answered) {
    try {
      await db.from("voice_calls").update({ sentiment }).eq("twilio_call_sid", callSid)
    } catch {}
    // Early-stage pipeline bump only — never demote qualified+ leads.
    await query(
      `UPDATE leads
          SET status = CASE WHEN $2 = 'Positive' THEN 'qualified' ELSE 'contacted' END,
              updated_at = now()
        WHERE id = $1
          AND (status = 'new' OR (status = 'contacted' AND $2 = 'Positive'))`,
      [leadId, sentiment]
    ).catch(() => {})
    refreshLeadScore(leadId, sentiment).catch(() => {})
  }

  // ---- 5. WhatsApp auto-follow-up (once per call) ----
  // Same rules as the Exotel status webhook: completed-with-conversation →
  // call_followup; missed/busy → missed_call_followup; failed → nothing.
  // The claim is conditional on the SAME followup_sent flag the Exotel path
  // uses, so both networks share one guard.
  if (!call?.followup_sent && outcome !== "failed") {
    let claimWon = false
    if (call) {
      try {
        const claim = await query(
          `UPDATE voice_calls SET followup_sent = true WHERE twilio_call_sid = $1 AND (followup_sent IS NOT TRUE) RETURNING 1`,
          [callSid]
        )
        claimWon = (claim.rowCount || 0) > 0
      } catch (e) {
        console.error("wa finalize: followup claim error:", e instanceof Error ? e.message : e)
      }
    } else {
      // No voice_calls row (never answered): the bubble-row dedupe above is
      // the only guard, and it already won (we'd have returned otherwise).
      claimWon = true
    }
    if (claimWon) {
      const { data: lead } = await db.from("leads").select("name, phone, whatsapp_number").eq("id", leadId).single()
      const target = lead?.whatsapp_number || lead?.phone || `+${digits}`
      const waBranch = await branchWhatsAppCtx(call?.branch_id || opts.branchIdFromWebhook || null)
      if (outcome === "resolved" && transcript.length > 0) {
        const result = await sendCallFollowUp(target, lead?.name || "there", waBranch)
        await db.from("comm_logs").insert({
          lead_id: leadId,
          type: "whatsapp",
          summary: result.ok ? "Post-call WhatsApp follow-up sent (WhatsApp voice call)" : `Post-call WhatsApp follow-up failed: ${result.error}`,
          outcome: result.ok ? "sent" : "failed",
        }).catch(() => {})
      } else if (outcome === "missed") {
        const result = await sendMissedCallFollowUp(target, lead?.name || "there", waBranch)
        await db.from("comm_logs").insert({
          lead_id: leadId,
          type: "whatsapp",
          summary: result.ok ? "Missed WhatsApp call follow-up sent" : `Missed WhatsApp call follow-up failed: ${result.error}`,
          outcome: result.ok ? "sent" : "failed",
        }).catch(() => {})
      }
    }
  }

  // ---- 6. Summary + comm_logs + Lead Brain (completed calls only) ----
  if (answered && transcript.length > 0) {
    const transcriptText = transcript
      .map((t) => `${t.role === "ai" ? "Priya" : "Customer"}: ${typeof t.text === "string" ? t.text : ""}`)
      .join("\n")
    try {
      const summary = await generateLeadSummary(transcriptText)
      await db.from("voice_calls").update({ ai_summary: summary }).eq("twilio_call_sid", callSid)
    } catch (e) {
      console.error("wa finalize: summary error:", e)
    }

    await db.from("comm_logs").insert({
      lead_id: leadId,
      type: "call",
      summary: `AI WhatsApp call completed (${duration}s). Sentiment: ${sentiment}. ${transcript.length} exchanges.`,
      outcome,
    }).catch(() => {})

    // Lead Brain analysis — synchronous fire-and-forget (it spins its own
    // async body), never allowed to affect this webhook's response.
    runPostCallAnalysis(callSid)
  }
}
