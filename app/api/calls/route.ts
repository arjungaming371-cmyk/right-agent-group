import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { makeCall } from "@/lib/exotel"
import { requireRole } from "@/lib/auth"
import { checkCallCompliance } from "@/lib/compliance"

export async function GET() {
  const { data, error } = await db
    .from("voice_calls")
    .select("*, leads(name, phone)")
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  if (!(await requireRole(req, ["admin", "agent"]))) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { leadId, phone, language, instructions } = await req.json()
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 })
  const compliance = await checkCallCompliance({ leadId, phone })
  if (!compliance.allowed) {
    return NextResponse.json({ error: compliance.reason }, { status: 403 })
  }
  try {
    // Warm up Ollama BEFORE the call starts (so it's ready when caller picks up).
    // Loopback — never route this through the public tunnel.
    const internal = process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000"
    fetch(`${internal}/api/warmup`, { method: "POST" }).catch(() => {})

    const call = await makeCall(phone, leadId ?? "", language ?? "english", instructions)
    await db.from("voice_calls").insert({
      lead_id: leadId ?? null,
      twilio_call_sid: call.sid,
      direction: "outbound",
      status: "initiated",
      language: language ?? "english",
      phone,
    })
    if (leadId) {
      await db.from("comm_logs").insert({
        lead_id: leadId,
        type: "call",
        summary: instructions ? `Outbound AI call initiated to ${phone} — "${instructions}"` : `Outbound AI call initiated to ${phone}`,
        outcome: "pending",
      })
    }
    return NextResponse.json({ callSid: call.sid, status: call.status })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
