import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { startCall, handleTurn } from "@/lib/voice-conversation"
import type { Language } from "@/lib/ollama"

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

function normalizeLanguage(input: any): Language {
  return input === "hindi" || input === "telugu" || input === "english" ? input : "english"
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
          const { data: newLead } = await db
            .from("leads")
            .insert({ name: `Caller ${digits.slice(-4)}`, phone, source: "inbound_call", status: "new" })
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
        .select("lead_id, language")
        .eq("twilio_call_sid", callSid)
        .single()

      const language = normalizeLanguage(body?.language || call?.language)
      const result = await handleTurn({
        leadId: call?.lead_id || "",
        callSid,
        speech,
        language,
        instructions: typeof body?.instructions === "string" ? body.instructions.slice(0, 1000) : undefined,
      })
      return NextResponse.json({ ...result, language })
    }

    return NextResponse.json({ error: "unknown event" }, { status: 400 })
  } catch (e: any) {
    console.error("turn api error:", e.message)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
