import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { generateLeadSummary } from "@/lib/llm"
import { sendCallFollowUp, sendMissedCallFollowUp, branchWhatsAppCtx } from "@/lib/whatsapp"
import { refreshLeadScore } from "@/lib/scoring"
import { rateLimit, clientIp } from "@/lib/rate-limit"
import { runPostCallAnalysis } from "@/lib/lead-brain"
import { runCalendarExtractionForCall } from "@/lib/calendar-agent"
import { verifyTelephonyWebhookKey } from "@/lib/exotel-webhook-auth"
import { maybeRequeueMissed } from "@/lib/auto-retry"
import { stampQueueCallOutcome } from "@/lib/queue-outcome"
import { isAiPaused } from "@/lib/ai-pause"

export async function POST(req: NextRequest) {
  try {
    if (!verifyTelephonyWebhookKey(req)) {
      return new NextResponse("OK", { status: 200 }) // Fail silently to outside callers
    }

    if (!rateLimit(`call-status:${clientIp(req)}`, 60, 60000)) {
      return new NextResponse("OK", { status: 200 })
    }

    // Exotel sends JSON (StatusCallbackContentType=application/json);
    // form-encoded is kept as a fallback for older configurations.
    let callSid = "", callStatus = "", duration = 0
    let recordingUrl: string | null = null
    const contentType = req.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
      callSid      = String(body.CallSid ?? body.call_sid ?? body.CallUUID ?? body.call_uuid ?? body.callId ?? body.call_id ?? body.request_id ?? body.RequestUUID ?? "")
      callStatus   = String(body.Status ?? body.CallStatus ?? body.status ?? body.call_status ?? "").toLowerCase()
      duration     = parseInt(String(body.ConversationDuration ?? body.CallDuration ?? body.duration ?? body.call_duration ?? "0")) || 0
      recordingUrl = typeof body.RecordUrl === "string" ? body.RecordUrl : typeof body.record_url === "string" ? body.record_url : typeof body.RecordingUrl === "string" ? body.RecordingUrl : typeof body.recording_url === "string" ? body.recording_url : null
    } else {
      const fd = await req.formData()
      callSid      = ((fd.get("CallSid") || fd.get("CallUUID") || fd.get("call_uuid") || fd.get("callSid") || fd.get("callId") || fd.get("RequestUUID") || fd.get("request_id") || fd.get("request_uuid")) as string) ?? ""
      callStatus   = ((fd.get("CallStatus") || fd.get("Status") || fd.get("status") || fd.get("call_status")) as string ?? "").toLowerCase()
      duration     = parseInt(((fd.get("CallDuration") || fd.get("ConversationDuration") || fd.get("duration") || fd.get("call_duration") || "0") as string)) || 0
      recordingUrl = ((fd.get("RecordUrl") || fd.get("record_url") || fd.get("RecordingUrl") || fd.get("recording_url")) as string) || null
    }

    console.log(`Call: ${callSid} | Status: ${callStatus} | Duration: ${duration}s`)
    if (!callSid) return new NextResponse("OK", { status: 200 })

    const isCompleted = ["completed", "stopped", "stream-stopped", "hangup", "ended", "normal_clearing"].includes(callStatus)
    const isMissed = ["busy", "no-answer", "canceled", "rejected", "timeout"].includes(callStatus)
    const isFailed = ["failed", "error"].includes(callStatus)

    const finalStatus = isCompleted ? "completed" : isMissed ? (callStatus === "busy" ? "busy" : "no-answer") : isFailed ? "failed" : callStatus
    const outcomeMap: Record<string, string> = {
      completed: "resolved", busy: "missed", "no-answer": "missed", failed: "failed", canceled: "missed",
    }
    const outcome = outcomeMap[finalStatus] ?? (isCompleted ? "resolved" : isMissed ? "missed" : isFailed ? "failed" : "")

    // GREATEST: Exotel doesn't track "conversation" time inside a custom
    // Voicebot applet, so this webhook's own duration is usually 0 — a plain
    // overwrite here was stomping the accurate value our own voicebot
    // already reported via /api/calls/turn (observed live: real calls with
    // full conversations still showed 0:00 in Voice Logs).
    let call: Record<string, unknown> | undefined
    try {
      const res = await query(
        `UPDATE voice_calls
            SET status = CASE 
                  WHEN status = 'completed' THEN 'completed'
                  WHEN $2 != '' THEN $2 
                  WHEN duration > 0 THEN 'completed' 
                  ELSE status 
                END,
                outcome = CASE 
                  WHEN outcome = 'resolved' THEN 'resolved'
                  WHEN $3 != '' THEN $3 
                  WHEN status = 'completed' OR duration > 0 THEN 'resolved' 
                  ELSE outcome 
                END,
                duration = GREATEST(duration, $4),
                recording_url = COALESCE($5, recording_url),
                updated_at = now()
          WHERE twilio_call_sid = $1
          RETURNING *`,
        [callSid, finalStatus, outcome, duration, recordingUrl]
      )
      call = res.rows[0]
    } catch (callError) {
      console.error("update error:", callError instanceof Error ? callError.message : callError)
      return new NextResponse("OK", { status: 200 })
    }
    if (!call?.lead_id) return new NextResponse("OK", { status: 200 })
    const leadId = String(call.lead_id)

    // Bulk-dialer auto-retry (Feature 4 of the bulk plan): a queued call
    // that ended busy/no-answer with zero conversation time is pushed back
    // to pending (+2h by default, capped). Fire-and-forget — must never slow
    // or fail the webhook; the helper swallows its own errors.
    maybeRequeueMissed({ callSid, outcome, duration }).catch(() => {})

    // Queue outcome feedback (2026-10-01): stamp the REAL result onto the
    // outbound_queue row, so the Call Queue view + Campaign Radar can show
    // answered vs no-answer instead of counting every dialed row as
    // "completed". First terminal report wins (idempotent under Exotel's
    // webhook retries); fire-and-forget like the requeue above.
    stampQueueCallOutcome({ callSid, outcome, detail: callStatus }).catch(() => {})

    // Transcript arrives as jsonb (array) but tolerate the string form. The
    // previous inline JSON.parse threw on malformed strings and — being
    // inside the route's big try — silently skipped EVERYTHING below for
    // that call: sentiment, lead bump, WhatsApp follow-up and summary all
    // vanished with only a generic log line.
    const rawTranscript: unknown = call.transcript
    let transcript: { text?: unknown; role?: unknown }[] = []
    if (Array.isArray(rawTranscript)) {
      transcript = rawTranscript as { text?: unknown; role?: unknown }[]
    } else if (typeof rawTranscript === "string") {
      try {
        const parsed: unknown = JSON.parse(rawTranscript)
        if (Array.isArray(parsed)) transcript = parsed as { text?: unknown; role?: unknown }[]
      } catch {
        transcript = []
      }
    }
    const customerText = transcript
      .filter((t) => t.role === "customer" || t.role === "user")
      .map((t) => (typeof t.text === "string" ? t.text : ""))
      .join(" ")
      .toLowerCase()
      .replace(/no\s+(?:problem|issue|doubt|doubts|worries)/gi, "")

    const positiveWords = /\b(?:yes|interested|please|confirm|okay|ok|sure|good|great|sare|avunu|cheppandi|vasthanu|vacchi|teesukostha|apply)\b/i
    const negativeWords = /\b(?:not interested|dont call|do not call|never call|stop calling|wrong number|vaddu|waste)\b/i
    const sentiment = negativeWords.test(customerText) ? "Negative" : positiveWords.test(customerText) ? "Positive" : "Neutral"

    await db.from("voice_calls").update({ sentiment }).eq("twilio_call_sid", callSid)
    // FIX (2026-09-22): this update used to stomp ANY existing status — a
    // converted / docs_pending / do_not_call lead that received (or was
    // retried with) one more status callback got silently demoted back to
    // "contacted", and analytics/pipelines followed the wrong state. Only
    // the early pipeline stages may move: new → contacted → qualified.
    // Qualified+ statuses are only ever advanced elsewhere, never demoted here.
    await query(
      `UPDATE leads
          SET status = CASE WHEN $2 = 'Positive' THEN 'qualified' ELSE 'contacted' END,
              updated_at = now()
        WHERE id = $1
          AND (status = 'new' OR (status = 'contacted' AND $2 = 'Positive'))`,
      [leadId, sentiment]
    ).catch(() => {})
    refreshLeadScore(leadId, sentiment).catch(() => {})

    // ---- WhatsApp auto-follow-up (once per call) ----
    // Skipped entirely if a call already sent the full application-link
    // message mid-call (handleTurn sets followup_sent=true when that happens)
    // — nobody should get two WhatsApp messages for one call.
    // "failed" outcomes are skipped too: usually a bad/invalid number, not a
    // real miss worth following up on.
    // RACE GATE (2026-09 fix): Meta/Exotel retry webhooks concurrently, and
    // two retries could both read followup_sent=false and both send. The
    // conditional UPDATE claims the follow-up atomically — only the retry
    // that flips the flag gets to send.
    // AI KILL SWITCH: the "messages" toggle suppresses this automated send
    // (followup_sent stays unclaimed; agents can still message manually).
    if (!call.followup_sent && !(await isAiPaused("messages", typeof call.branch_id === "string" ? call.branch_id : null))) {
      let claimWon = false
      try {
        const claim = await query(
          `UPDATE voice_calls SET followup_sent = true WHERE twilio_call_sid = $1 AND (followup_sent IS NOT TRUE) RETURNING 1`,
          [callSid]
        )
        claimWon = (claim.rowCount || 0) > 0
      } catch (claimError) {
        console.error("followup claim error:", claimError instanceof Error ? claimError.message : claimError)
      }
      if (claimWon) {
        const { data: lead } = await db.from("leads").select("name, phone, whatsapp_number").eq("id", leadId).single()
        const target = lead?.whatsapp_number || lead?.phone
        // Per-branch WhatsApp: the follow-up goes from the BRANCH's WABA
        // number (and passes the branch quota gate), or the company number.
        const waBranch = await branchWhatsAppCtx(typeof call.branch_id === "string" ? call.branch_id : null)

        if (target && outcome === "resolved" && transcript.length > 0) {
          const { createOneTimeFormToken, sendApplicationLink } = await import("@/lib/whatsapp")
          const token = await createOneTimeFormToken(leadId)
          const result = await sendApplicationLink(target, lead?.name || "there", token, waBranch)
          if (!result.ok) {
            await sendCallFollowUp(target, lead?.name || "there", waBranch)
          }
          const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://13.201.0.111.sslip.io").replace(/\/$/, "")
          await db.from("comm_logs").insert({
            lead_id: leadId,
            type: "whatsapp",
            summary: result.ok
              ? `Bank application link sent on WhatsApp to ${target}: ${appUrl}/l/${token}`
              : `Post-call WhatsApp send attempted (${result.error})`,
            outcome: result.ok ? "sent" : "failed",
          })
          // Alert: Lead confirmed loan interest on call — flag in Human Attention queue
          await db.from("comm_logs").insert({
            lead_id: leadId,
            type: "alert",
            summary: `🟢 LOAN CONFORMED ON CALL — Caller confirmed loan interest during call. Application link sent on WhatsApp. Follow up for documentation & bank processing.`,
            outcome: "loan_confirmed",
          }).catch(() => {})
        } else if (target && outcome === "missed") {
          const result = await sendMissedCallFollowUp(target, lead?.name || "there", waBranch)
          await db.from("comm_logs").insert({
            lead_id: call.lead_id,
            type: "whatsapp",
            summary: result.ok ? "Missed-call WhatsApp follow-up sent" : `Missed-call WhatsApp follow-up failed: ${result.error}`,
            outcome: result.ok ? "sent" : "failed",
          })
        }
      }
    }

    if ((finalStatus === "completed" || transcript.length > 0) && transcript.length > 0 && !call.ai_summary) {
      const transcriptText = transcript
        .map((t) => `${t.role === "ai" ? "Priya" : "Customer"}: ${typeof t.text === "string" ? t.text : ""}`)
        .join("\n")
      try {
        const summary = await generateLeadSummary(transcriptText)
        await db.from("voice_calls").update({ ai_summary: summary }).eq("twilio_call_sid", callSid)
      } catch (e) { console.error("summary error:", e) }

      await db.from("comm_logs").insert({
        lead_id: call.lead_id,
        type: "call",
        summary: `AI call completed (${duration}s). Sentiment: ${sentiment}. ${transcript.length} exchanges.`,
        outcome,
      })

      // Lead Brain: background structured-memory extraction. Fire-and-forget —
      // never awaited, never allowed to affect this webhook's response.
      runPostCallAnalysis(callSid)

      // Calendar Agent: extract appointments, callbacks & branch visits into calendar_events
      runCalendarExtractionForCall(callSid)
    }

    return new NextResponse("OK", { status: 200 })
  } catch (e) {
    console.error("Unexpected:", e)
    return new NextResponse("OK", { status: 200 })
  }
}
