import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { checkWhatsAppHealth } from "@/lib/whatsapp"
import { checkInstagramHealth } from "@/lib/instagram"

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const { provider } = await req.json()
    if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400 })

    if (provider === "whatsapp") {
      const res = await checkWhatsAppHealth()
      return NextResponse.json(res)
    }

    if (provider === "instagram") {
      const res = await checkInstagramHealth()
      return NextResponse.json(res)
    }

    if (provider === "groq") {
      const key = process.env.GROQ_API_KEY
      if (!key) return NextResponse.json({ ok: false, message: "GROQ_API_KEY not set" })
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (res.ok) return NextResponse.json({ ok: true, message: "Connected to Groq Cloud AI API" })
      return NextResponse.json({ ok: false, message: `Groq API returned HTTP ${res.status}` })
    }

    if (provider === "sarvam") {
      const key = process.env.SARVAM_API_KEY
      if (!key) return NextResponse.json({ ok: false, message: "SARVAM_API_KEY not set" })
      return NextResponse.json({ ok: true, message: "Sarvam API Key configured" })
    }

    return NextResponse.json({ ok: false, message: "Unknown provider" })
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: e.message })
  }
}
