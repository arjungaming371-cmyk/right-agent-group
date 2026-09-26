import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { startCall, handleTurn, handleTurnStream, correctLastSpokenReply } from "@/lib/voice-conversation"
import { detectLanguage, type Language } from "@/lib/llm"
import { PHONE_MATCH_SQL } from "@/lib/phone"
import { resolveBranchByCallerId, recordUsage, getBranchVoice } from "@/lib/branches"
import { verifyServiceKey } from "@/lib/service-key"

export const dynamic = "force-dynamic"

// Internal bridge for server/voicebot-server.js (Exotel WebSocket voicebot).
// Protected by the shared service key — NOT for public use.
//
//  { event: "start", callSid, from, to }
//     → resolves lead + language + BRANCH (outbound: by the voice_calls row
//       created when the call was placed; inbound: by the CALLED number —
//       the branch's DLT-approved ExoPhone — then by matching the caller's
//       phone, creating a new lead if unknown), returns Priya's greeting.
//
//  { event: "turn", callSid, speech }
//     → runs one conversation turn, returns { text, hangup }.
//
//  { event: "spoken", callSid, text }
//     → rewrites the LAST ai entry in the transcript to what the caller
//       actually heard. Sent by the voicebot when a barge-in cut a reply
//       short, so getHistory() stops feeding the model words it never spoke.
//
//  { event: "end", callSid, duration }
//     → records real call duration when the WebSocket stream stops. Exotel's
//       status webhook doesn't fire for inbound voicebot calls, so without
//       this every inbound call showed 0:00 in Voice Logs.

// Telugu is the business's home market and the default first language —
// Priya opens in Telugu and switches when the caller speaks something else.
function normalizeLanguage(input: unknown): Language {
  return input === "hindi" || input === "telugu" || input === "english" ? input : "telugu"
}

// Mid-call language switching. STT runs in auto-detect mode, so the script of
// the transcript tells us what the caller actually spoke: one Telugu or
// Devanagari character is strong evidence (Whisper writes those scripts only
// when it heard that language). Switching to ENGLISH needs a real sentence —
// short fillers like "ok", "yes" appear inside Telugu/Hindi conversations all
// the time and must not flip the call.
function resolveSpokenLanguage(speech: string, current: Language): Language {
  const text = speech.toLowerCase()
  // Explicit keyword shift requests
  if (/\b(telugu|telgu|tenglish|telegu)\b|తెలుగు|telugulo|telugula/i.test(text)) return "telugu"
  if (/\b(hindi|hinglish|hind)\b|हिंदी|हिन्दी|hindimein|hindime/i.test(text)) return "hindi"
  if (/\b(english|eng|inglish)\b|englishlo|englishmein/i.test(text)) return "english"

  const detected = detectLanguage(speech)
  if (detected === current) return current
  if (detected === "english" && speech.trim().split(/\s+/).length < 3) return current
  return detected
}

// Wire format from server/voicebot-server.js + server/whatsapp-calls.js.
// Everything optional: the bridge only sets what the event needs.
type TurnBody = {
  event?: unknown
  callSid?: unknown
  from?: unknown
  to?: unknown
  To?: unknown
  branchId?: unknown
  source?: unknown
  speech?: unknown
  language?: unknown
  stream?: unknown
  instructions?: unknown
  text?: unknown
  duration?: unknown
}

type TurnStreamEvent = { type: "sentence" | "done"; text?: string; language?: Language; hangup?: boolean }

export async function POST(req: NextRequest) {
  // FIX (2026-09-20): constant-time compare via the shared helper (was !==).
  if (!verifyServiceKey(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: TurnBody
  try {
    body = (await req.json()) as TurnBody
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const event = body?.event
  const callSid = String(body?.callSid || "")
  if (!callSid) return NextResponse.json({ error: "callSid required" }, { status: 400 })

  try {
    if (event === "start") {
      // 1) Outbound call? The outbound route already stored sid → lead + language
      //    (+ branch_id when the caller worked from a branch context).
      const { data: existing } = await db
        .from("voice_calls")
        .select("lead_id, language, direction, branch_id")
        .eq("twilio_call_sid", callSid)
        .single()

      let leadId: string = existing?.lead_id || ""
      let language = normalizeLanguage(existing?.language)
      let direction: "inbound" | "outbound" = existing?.direction === "inbound" ? "inbound" : "outbound"
      let branchId: string | null = existing?.branch_id || null
      // WhatsApp voice calls (wacall-* sids) arrive with the branch ALREADY
      // resolved at the webhook — metadata.phone_number_id → branch — and
      // carried here. resolveBranchByCallerId below only knows ExoPhones, so
      // this passthrough is what gives WhatsApp calls their branch context.
      const bodyBranchId = typeof body?.branchId === "string" && body.branchId ? body.branchId : null

      // 2) Inbound call? The CALLED number (the branch's DLT ExoPhone) decides
      //    which branch serves it; then match the caller's number to a lead, or
      //    create one under that branch.
      if (!leadId && body?.from) {
        direction = "inbound"
        // Multi-branch routing: WhatsApp calls carry the branch from the
        // webhook (phone_number_id match); Exotel calls fall back to the
        // CALLED ExoPhone. Everything else → null (HQ / env-level account).
        if (!branchId) {
          branchId = bodyBranchId
        }
        if (!branchId) {
          const branch = await resolveBranchByCallerId(
            String(body?.to || body?.To || process.env.EXOTEL_CALLER_ID || "")
          )
          branchId = branch?.id || null
        }
        const digits = String(body.from).replace(/\D/g, "")
        const phone = digits.length === 10 ? `+91${digits}` : `+${digits}`
        // Match on the last 10 digits, not exact string — a manually added
        // lead may be stored as "9908838090" while the caller ID arrives as
        // "+919908838090"; exact match would create a duplicate lead.
        const found = await query(
          `SELECT id, language FROM leads WHERE ${PHONE_MATCH_SQL} LIMIT 1`,
          [digits.slice(-10)]
        )
        const lead = found.rows[0]
        if (lead) {
          leadId = lead.id
          if (lead.language) language = normalizeLanguage(lead.language)
        } else {
          // language telugu explicitly — belt-and-braces with the DB column
          // default (also telugu since the Tenglish-first change), so an old
          // database that predates the migration still behaves correctly.
          // Source: "whatsapp_call" for WhatsApp voice calls (analytics can
          // distinguish them from Exotel inbound_call rows).
          const source = typeof body?.source === "string" && body.source ? body.source.slice(0, 40) : "inbound_call"
          const { data: newLead } = await db
            .from("leads")
            .insert({ name: `Caller ${digits.slice(-4)}`, phone, source, status: "new", language: "telugu", branch_id: branchId })
            .select()
            .single()
          leadId = newLead?.id || ""
        }
        // record the inbound call row
        await db.from("voice_calls").upsert(
          { twilio_call_sid: callSid, lead_id: leadId || null, direction: "inbound", status: "in-progress", language, phone, branch_id: branchId },
          { onConflict: "twilio_call_sid" }
        )
      }

      const greeting = await startCall(leadId, callSid, language, direction)
      // The branch's primary AI Employee's voice — the voicebot uses it for
      // every synthesis on this call (null = deployment default voice).
      const voice = await getBranchVoice(branchId)
      return NextResponse.json({ text: greeting, language, leadId, branchId, voice, hangup: false })
    }

    if (event === "turn") {
      const speech = String(body?.speech || "").slice(0, 4000)
      if (!speech) return NextResponse.json({ error: "speech required" }, { status: 400 })

      const { data: call } = await db
        .from("voice_calls")
        .select("lead_id, language, phone, instructions, direction, branch_id")
        .eq("twilio_call_sid", callSid)
        .single()

      // Prefer call row's language if already recorded/switched (prevents stale client state from reverting)
      const current = normalizeLanguage(call?.language || body?.language)
      const language = resolveSpokenLanguage(speech, current)
      if (language !== current) {
        // Persist the switch — on the call row (so later turns and history stay
        // consistent) AND on the lead (so their NEXT call greets them right).
        // Logged, not silently swallowed: a failed persist made Priya flip
        // back to the old language on the very next turn with no trace.
        db.from("voice_calls").update({ language }).eq("twilio_call_sid", callSid).catch((e) =>
          console.error("language switch persist (call row) failed:", e instanceof Error ? e.message : e))
        if (call?.lead_id) db.from("leads").update({ language }).eq("id", call.lead_id).catch((e) =>
          console.error("language switch persist (lead) failed:", e instanceof Error ? e.message : e))
      }

      const turnOpts = {
        leadId: call?.lead_id || "",
        callSid,
        speech,
        language,
        callerPhone: call?.phone || undefined,
        direction: call?.direction === "inbound" ? ("inbound" as const) : ("outbound" as const),
        // The Exotel voicebot bridge never sends instructions (it only knows
        // the call SID) — body?.instructions is really only exercised by
        // direct API testing. The real path is the DB column set at call
        // creation time from the dashboard's "What should Priya talk about?"
        // field (app/api/calls POST).
        instructions: (typeof body?.instructions === "string" ? body.instructions.slice(0, 1000) : undefined) || call?.instructions || undefined,
        branchId: call?.branch_id || null,
      }

      // STREAMING MODE (body.stream === true): NDJSON, one object per line.
      //   {"type":"sentence","text":"...","language":"..."} — speak this NOW
      //   {"type":"done","language","hangup"} — turn finished
      // The voicebot starts TTS on sentence 1 while the model is still
      // writing sentence 2 — this is what makes Priya feel instant instead
      // of "think for 8 seconds, then talk".
      if (body?.stream === true) {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            // closed-guard: if the voicebot disconnects mid-turn, enqueue on a
            // closed controller THROWS — and that throw inside the catch's
            // own emit would escalate into an unhandled rejection. Latch and
            // emit no-op instead.
            let closed = false
            const emit = (obj: TurnStreamEvent) => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
              } catch {
                closed = true
              }
            }
            try {
              const result = await handleTurnStream(turnOpts, (sentence) => emit({ type: "sentence", text: sentence, language }))
              emit({ type: "done", language, hangup: result.hangup })
            } catch (e) {
              console.error("turn stream error:", e instanceof Error ? e.message : e)
              emit({ type: "done", language, hangup: false })
            }
            try { controller.close() } catch {}
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
      const ended = await query(
        `UPDATE voice_calls
            SET duration = GREATEST(duration, $2),
                status = CASE WHEN status IN ('initiated', 'in-progress') THEN 'completed' ELSE status END,
                updated_at = now()
          WHERE twilio_call_sid = $1
          RETURNING branch_id`,
        [callSid, duration]
      )
      // Per-branch billing meter: real talk-time + one completed call.
      const branchId = ended.rows[0]?.branch_id
      if (branchId) {
        recordUsage(branchId, "call_seconds", duration)
      }
      return NextResponse.json({ ok: true })
    }

    if (event === "spoken") {
      // Empty text is a meaningful value here (the caller cut in before Priya
      // got a word out), so check the TYPE, not truthiness.
      if (typeof body?.text !== "string") {
        return NextResponse.json({ error: "text required" }, { status: 400 })
      }
      const corrected = await correctLastSpokenReply(callSid, body.text.slice(0, 4000))
      // corrected:false is a normal 200, not an error — "nothing to correct"
      // happens legitimately when the socket dropped before the app wrote the
      // row, and the voicebot has nothing useful to do with a 4xx.
      return NextResponse.json({ ok: true, corrected })
    }

    return NextResponse.json({ error: "unknown event" }, { status: 400 })
  } catch (e) {
    console.error("turn api error:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
