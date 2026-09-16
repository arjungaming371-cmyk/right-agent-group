import { NextRequest, NextResponse } from "next/server"
import { generateAndSendDigest } from "@/lib/digest"

export const dynamic = "force-dynamic"

// Dashboard-only trigger for the "Email me this report" button. Unlike
// /api/digest (used by the scheduled task, x-api-key protected and public
// at the middleware layer), this route is NOT in middleware's public list —
// it relies on the normal session cookie check, so no secret is ever
// exposed to browser JS.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const period = body?.period === "weekly" ? "weekly" : "daily"
  const days = period === "weekly" ? 7 : 1

  const result = await generateAndSendDigest(days)
  if (!result.ok) return NextResponse.json({ error: result.error, stats: result.stats }, { status: 502 })
  return NextResponse.json({ ok: true, period, stats: result.stats })
}
