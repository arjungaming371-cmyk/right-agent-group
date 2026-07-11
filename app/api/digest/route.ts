import { NextRequest, NextResponse } from "next/server"
import { generateAndSendDigest } from "@/lib/digest"

export const dynamic = "force-dynamic"

// Triggered by DIGEST.ps1 (scheduled) or the "Email me this report" button
// in the dashboard. Protected by the same internal service key used for
// the voicebot bridge — this sends real email, so it isn't public.
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-api-key")
  if (!key || key !== (process.env.WHATSAPP_SERVICE_KEY || "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const period = body?.period === "weekly" ? "weekly" : "daily"
  const days = period === "weekly" ? 7 : 1

  const result = await generateAndSendDigest(days)
  if (!result.ok) return NextResponse.json({ error: result.error, stats: result.stats }, { status: 502 })
  return NextResponse.json({ ok: true, period, stats: result.stats })
}
