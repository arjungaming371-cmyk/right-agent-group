import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { startCall, handleTurn, handleTurnStream } from "@/lib/voice-conversation"
import { detectLanguage, type Language } from "@/lib/ollama"

export const dynamic = "force-dynamic"

// Internal bridge for server/voicebot-server.js (Exotel WebSocket voicebot).
// Protected by the shared service key — NOT for public use.
//
//  { event: "start", callSid, from }
//     → resolves lead + language (outbound: by the voice_calls row created
//       when the call was placed; inbound: by matching the caller's phone,
//       creating a new lead if unknown), returns Priya's greeting.
//
//  { event: "turn", callSid, speech }
//     → runs one conversation turn, returns { text, hangup }.
//
//  { event: "end", callSid, duration }
//     → records real call duration when the WebSocket stream stops. Exotel's
//       status webhook doesn't fire for inbound voicebot calls, so without
//       this every inbound call showed 0:00 in Voice Logs.

// Telugu is the business's home market and the default first language —
// Priya opens in Telugu and switches when the caller speaks something else.
function normalizeLanguage(input: any): Language {
  return input === "hindi" || input === "telugu" || input === "english" ? input : "telugu"
}

// Mid-call language switching. STT runs in auto-detect mode, so the script of
// the transcript tells us what the caller actually spoke: one Telugu or
// Devanagari character is strong evidence (Whisper writes those scripts only
// when it heard that language). Switching to ENGLISH needs a real sentence —
// short fillers like "ok", "yes" appear inside Telugu/Hindi conversations all
// the time and must not flip the call.
function resolveSpokenLanguage(speech: string, current: Language): Language {
  const detected = detectLanguage(speech)
  if (detected === current) return current
  if (detected === "english" && speech.trim().split(/\s+/).length < 3) return current
  return detected
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-api-key")
  if (!key || key !== (process.env.WHATSAPP_SERVICE_KEY || "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const event = body?.event
  const callSid = String(body?.callSid || "")
  if (!callSid) return NextResponse.json({ error: "callSid required" }, { status: 400 })

  try {
    if (event === "start") {
      // 1) Outbound call? The outbound route already stored sid → lead + language.
      const { data: existing } = await db
        .from("voice_calls")
        .select("lead_id, language, direction")
        .eq("twilio_call_sid", callSid)
        .single()

      let leadId: string = existing?.lead_id || ""
      let language = normalizeLanguage(existing?.language)
      let direction: "inbound" | "outbound" = existing?.direction === "inbound" ? "inbound" : "outbound"

      // 2) Inbound call? Match the caller's number to a lead, or create one.
      if (!leadId && body?.from) {
        direction = "inbound"
        const digits = String(body.from).replace(/\D/g, "")
        const phone = digits.length === 10 ? `+91${digits}` : `+${digits}`
        const { data: lead } = await db.from("leads").select("id, language").eq("phone", phone).single()
        if (lead) {
          leadId = lead.id
          if (lead.language) language = normalizeLanguage(lead.language)
        } else {
          // language telugu explicitly — belt-and-braces with the DB column
          // default (also telugu since the Tenglish-first change), so an old
          // database that predates the migration still behaves correctly.
          const { data: newLead } = await db
            .from("leads")
            .insert({ name: `Caller ${digits.slice(-4)}`, phone, source: "inbound_call", status: "new", language: "telugu" })
            .select()
            .single()
          leadId = newLead?.id || ""
        }
        // record the inbound call row
        await db.from("voice_calls").upsert(
          { twilio_call_sid: callSid, lead_id: leadId || null, direction: "inbound", status: "in-progress", language, phone },
          { onConflict: "twilio_call_sid" }
        )
      }

      const greeting = await startCall(leadId, callSid, language, direction)
      return NextResponse.json({ text: greeting, language, leadId, hangup: false })
    }

    if (event === "turn") {
      const speech = String(body?.speech || "").slice(0, 4000)
      if (!speech) return NextResponse.json({ error: "speech required" }, { status: 400 })

      const { data: call } = await db
        .from("voice_calls")
        .select("lead_id, language, phone")
        .eq("twilio_call_sid", callSid)
        .single()

      const current = normalizeLanguage(body?.language || call?.language)
      const language = resolveSpokenLanguage(speech, current)
      if (language !== current) {
        // Persist the switch — on the call row (so later turns and history stay
        // consistent) AND on the lead (so their NEXT call greets them right).
        db.from("voice_calls").update({ language }).eq("twilio_call_sid", callSid).catch(() => {})
        if (call?.lead_id) db.from("leads").update({ language }).eq("id", call.lead_id).catch(() => {})
      }

      const turnOpts = {
        leadId: call?.lead_id || "",
        callSid,
        speech,
        language,
        callerPhone: call?.phone || undefined,
        instructions: typeof body?.instructions === "string" ? body.instructions.slice(0, 1000) : undefined,
      }

      // STREAMING MODE (body.stream === true): NDJSON, one object per line.
      //   {"type":"sentence","text":"..."}   — speak this NOW
      //   {"type":"done","language","hangup"} — turn finished
      // The voicebot starts TTS on sentence 1 while the model is still
      // writing sentence 2 — this is what makes Priya feel instant instead
      // of "think for 8 seconds, then talk".
      if (body?.stream === true) {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const emit = (obj: any) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
            try {
              const result = await handleTurnStream(turnOpts, (sentence) => emit({ type: "sentence", text: sentence }))
              emit({ type: "done", language, hangup: result.hangup })
            } catch (e: any) {
              console.error("turn stream error:", e.message)
              emit({ type: "done", language, hangup: false })
            }
            controller.close()
          },
        })
        return new NextResponse(stream, {
          headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
        })
      }

      const result = await handleTurn(turnOpts)
      return NextResponse.json({ ...result, language })
    }

    if (event === "end") {
      const duration = Math.max(0, Math.min(24 * 3600, parseInt(String(body?.duration ?? "0")) || 0))
      // GREATEST: never shrink a duration the Exotel status webhook already
      // wrote; only fill it in when nothing else did (inbound voicebot calls).
      await query(
        `UPDATE voice_calls
            SET duration = GREATEST(duration, $2),
                status = CASE WHEN status IN ('initiated', 'in-progress') THEN 'completed' ELSE status END,
                updated_at = now()
          WHERE twilio_call_sid = $1`,
        [callSid, duration]
      )
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "unknown event" }, { status: 400 })
  } catch (e: any) {
    console.error("turn api error:", e.message)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
