import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { runPromptTuner } from "@/lib/prompt-tuner"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// POST — "Generate Suggestions Now" button in the Script Manager. A real
// (awaited) Groq call, admin-only, not on any hot path — same shape as
// app/api/leads/[id]/memory/reanalyze.
export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const result = await runPromptTuner()
  logAudit("prompt tuner run manually", session.email, result)
  return NextResponse.json({ ok: true, ...result })
}
