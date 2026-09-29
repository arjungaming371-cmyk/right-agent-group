import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { synthesizePreview, VoiceProviderError, type VoiceProvider, type VoiceLanguage } from "@/lib/voice-catalog"

export const dynamic = "force-dynamic"

// Voice Studio audition — POST /api/voices/preview
//
//   { provider: "sarvam" | "cartesia", voiceId: string,
//     language: "english" | "hindi" | "telugu", text?: string }
//   → audio/wav (Content-Disposition inline)
//
// One-line synthesis so an operator can HEAR any preset or cloned voice in
// any of the three call languages before assigning it to an AI Employee.
// Nothing is persisted: the clip is generated on demand and streamed straight
// back (re-generating is cheaper than storing audio and keeps the DPDP
// surface small). Provider errors are surfaced as readable messages — a
// Bulbul speaker the account cannot use shows up as HTTP 400 with the
// speaker name in the text, which the UI turns into an "unavailable" badge.

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "branch_manager", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const provider = String(body?.provider || "") as VoiceProvider
    const voiceId = String(body?.voiceId || "").trim().slice(0, 120)
    const language = String(body?.language || "english") as VoiceLanguage
    const text = typeof body?.text === "string" ? body.text : undefined

    if (provider !== "sarvam" && provider !== "cartesia") {
      return NextResponse.json({ error: "provider must be sarvam or cartesia" }, { status: 400 })
    }
    if (!voiceId) return NextResponse.json({ error: "voiceId required" }, { status: 400 })
    if (!["english", "hindi", "telugu"].includes(language)) {
      return NextResponse.json({ error: "language must be english, hindi, or telugu" }, { status: 400 })
    }

    const audio = await synthesizePreview(provider, voiceId, language, text)
    logAudit("voice preview", session.email, { provider, voiceId, language })
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": audio.length.toString(),
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      },
    })
  } catch (e: unknown) {
    if (e instanceof VoiceProviderError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return NextResponse.json(
      { error: `Preview failed: ${e instanceof Error ? e.message : "unknown error"}` },
      { status: 502 }
    )
  }
}
