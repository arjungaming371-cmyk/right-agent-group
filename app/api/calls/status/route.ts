import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { generateLeadSummary } from "@/lib/llm"
import { sendCallFollowUp, sendMissedCallFollowUp } from "@/lib/whatsapp"
import { refreshLeadScore } from "@/lib/scoring"
import { rateLimit, clientIp } from "@/lib/rate-limit"
import { runPostCallAnalysis } from "@/lib/lead-brain"

export async function POST(req: NextRequest) {
  try {
    if (!rateLimit(`call-status:${clientIp(req)}`, 60, 60000)) {
      return new NextResponse("OK", { status: 200 })
    }

    // Exotel sends JSON (StatusCallbackContentType=application/json);
    // form-encoded is kept as a fallback for older configurations.
    let callSid = "", callStatus = "", duration = 0
    let recordingUrl: string | null = null
    const contentType = req.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      const body: any = await req.json().catch(() => ({}))
      callSid      = body.CallSid ?? body.call_sid ?? ""
      callStatus   = (body.Status ?? body.CallStatus ?? body.status ?? "").toLowerCase()
      duration     = parseInt(String(body.ConversationDuration ?? body.CallDuration ?? body.duration ?? "0")) || 0
      recordingUrl = body.RecordingUrl ?? body.recording_url ?? null
    } else {
      const fd = await req.formData()
      callSid      = (fd.get("CallSid") as string) ?? ""
      callStatus   = ((fd.get("CallStatus") as string) ?? "").toLowerCase()
      duration     = parseInt((fd.get("CallDuration") as string) ?? "0") || 0
      recordingUrl = fd.get("RecordingUrl") as string | null
    }

    console.log(`Call: ${callSid} | Status: ${callStatus} | Duration: ${duration}s`)
    if (!callSid) return new NextResponse("OK", { status: 200 })

    const outcomeMap: Record<string, string> = {
      completed: "resolved", busy: "missed", "no-answer": "missed", failed: "failed", canceled: "missed",
    }
    const outcome = outcomeMap[callStatus] ?? callStatus

    // GREATEST: Exotel doesn't track "conversation" time inside a custom
    // Voicebot applet, so this webhook's own duration is usually 0 — a plain
    // overwrite here was stomping the accurate value our own voicebot
    // already reported via /api/calls/turn (observed live: real calls with
    // full conversations still showed 0:00 in Voice Logs).
    let call: any
    try {
      const res = await query(
        `UPDATE voice_calls
            SET status = $2, outcome = $3, duration = GREATEST(duration, $4), recording_url = COALESCE($5, recording_url)
          WHERE twilio_call_sid = $1
          RETURNING *`,
        [callSid, callStatus, outcome, duration, recordingUrl]
      )
      call = res.rows[0]
    } catch (callError: any) {
      console.error("update error:", callError.message)
      return new NextResponse("OK", { status: 200 })
    }
    if (!call?.lead_id) return new NextResponse("OK", { status: 200 })

    const transcript = Array.isArray(call.transcript) ? call.transcript
      : (typeof call.transcript === "string" ? JSON.parse(call.transcript) : [])
    const allText = transcript.map((t: any) => t.text ?? "").join(" ").toLowerCase()

    const positiveWords = /yes\b|interested|please|confirm|okay|ok\b|sure|good|great/
    const negativeWords = /\bno\b|not interested|busy|later|cancel|dont|nope/
    const sentiment = negativeWords.test(allText) ? "Negative" : positiveWords.test(allText) ? "Positive" : "Neutral"

    await db.from("voice_calls").update({ sentiment }).eq("twilio_call_sid", callSid)
    await db.from("leads").update({
      status: sentiment === "Positive" ? "qualified" : "contacted",
      updated_at: new Date().toISOString(),
    }).eq("id", call.lead_id)
    refreshLeadScore(call.lead_id, sentiment).catch(() => {})

    // ---- WhatsApp auto-follow-up (once per call) ----
    // Skipped entirely if a call already sent the full application-link
    // message mid-call (handleTurn sets followup_sent=true when that happens)
    // — nobody should get two WhatsApp messages for one call.
    // "failed" outcomes are skipped too: usually a bad/invalid number, not a
    // real miss worth following up on.
    if (!call.followup_sent) {
      const { data: lead } = await db.from("leads").select("name, phone, whatsapp_number").eq("id", call.lead_id).single()
      const target = lead?.whatsapp_number || lead?.phone

      if (target && outcome === "resolved" && transcript.length > 0) {
        const result = await sendCallFollowUp(target, lead?.name || "there")
        await db.from("voice_calls").update({ followup_sent: true }).eq("twilio_call_sid", callSid)
        await db.from("comm_logs").insert({
          lead_id: call.lead_id,
          type: "whatsapp",
          summary: result.ok ? "Post-call WhatsApp follow-up sent" : `Post-call WhatsApp follow-up failed: ${result.error}`,
          outcome: result.ok ? "sent" : "failed",
        })
      } else if (target && outcome === "missed") {
        const result = await sendMissedCallFollowUp(target, lead?.name || "there")
        await db.from("voice_calls").update({ followup_sent: true }).eq("twilio_call_sid", callSid)
        await db.from("comm_logs").insert({
          lead_id: call.lead_id,
          type: "whatsapp",
          summary: result.ok ? "Missed-call WhatsApp follow-up sent" : `Missed-call WhatsApp follow-up failed: ${result.error}`,
          outcome: result.ok ? "sent" : "failed",
        })
      }
    }

    if (callStatus === "completed" && transcript.length > 0) {
      const transcriptText = transcript.map((t: any) => `${t.role === "ai" ? "Priya" : "Customer"}: ${t.text}`).join("\n")
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
    }

    return new NextResponse("OK", { status: 200 })
  } catch (e) {
    console.error("Unexpected:", e)
    return new NextResponse("OK", { status: 200 })
  }
}
