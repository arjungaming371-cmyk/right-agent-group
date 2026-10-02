import { NextRequest, NextResponse } from "next/server"
import { requireRole, getLiveSession } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { getAiPauseState, setAiPauseState, type AiPauseState } from "@/lib/ai-pause"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// AI KILL SWITCH — read + control.
//
//   GET   → any authenticated dashboard user: the pause state (the shell
//           renders a prominent "AI AUTOMATION PAUSED" banner from it).
//   PATCH → admin ONLY: flip the global toggles or a branch's scope.
//           Every change is audit-logged (who, when, why, scope).
//
// Body (PATCH):
//   { calls?: boolean, messages?: boolean,             // global toggles
//     branchId?: string, branchCalls?: boolean,        // per-branch toggles
//     branchMessages?: boolean,
//     reason?: string }                                // free text, audited

export async function GET(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const state = await getAiPauseState()
  return NextResponse.json({
    calls: state.calls.paused,
    messages: state.messages.paused,
    branches: state.branches,
    reason: state.reason ?? null,
    updated_by: state.updated_by ?? null,
    updated_at: state.updated_at ?? null,
  })
}

export async function PATCH(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const calls = typeof body.calls === "boolean" ? { paused: body.calls } : undefined
  const messages = typeof body.messages === "boolean" ? { paused: body.messages } : undefined
  const branchId = typeof body.branchId === "string" && body.branchId ? body.branchId : null
  const branchCalls = typeof body.branchCalls === "boolean" && branchId ? { branchId, paused: body.branchCalls } : null
  const branchMessages = typeof body.branchMessages === "boolean" && branchId ? { branchId, paused: body.branchMessages } : null
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : undefined

  const next: AiPauseState = await setAiPauseState({ calls, messages, branchCalls, branchMessages, reason }, session.email)

  // Audit: the kill switch is the single most sensitive control in the
  // product — every flip is recorded with actor, scope and stated reason.
  logAudit("ai pause changed", session.email, {
    calls: next.calls.paused,
    messages: next.messages.paused,
    branchId: branchId ?? undefined,
    branchCalls: body.branchCalls,
    branchMessages: body.branchMessages,
    reason: next.reason,
  })

  return NextResponse.json({
    calls: next.calls.paused,
    messages: next.messages.paused,
    branches: next.branches,
    reason: next.reason ?? null,
    updated_by: next.updated_by ?? null,
    updated_at: next.updated_at ?? null,
  })
}
