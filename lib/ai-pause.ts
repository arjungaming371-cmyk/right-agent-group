import { query } from "@/lib/db"

// ============================================================
// AI KILL SWITCH — one store, two scopes, every automation obeys it.
//
// Stored as a single JSONB row in form_configs (id = 'ai_pause'), the same
// generic config store roles/forms already use. Absent row = everything
// RUNNING (fail-open for automation, fail-closed only in the sense that a
// DB error while SETTING the switch never silently flips it).
//
// Shape:
// {
//   calls:    { paused: false },
//   messages: { paused: false },
//   branches: { "<branchId>": { calls: true, messages: false } },
//   reason: "investigating a complaint",   // optional, free text
//   updated_by: "admin@x.com",
//   updated_at: "2026-10-03T..."
// }
//
// Scope resolution for a call/message originating from branch B:
//   paused = branches[B]?.<kind> === true  ||  global.<kind>.paused === true
// (branch pause is evaluated FIRST so a global resume never silently
//  re-enables a branch an admin paused on purpose.)
//
// Consumers (keep this list in sync — pinned by scripts/test-product-upgrade.js):
//   • lib/outbound-dial.ts          placeOutboundCall  (both channels, one chokepoint)
//   • app/api/calls/dial/route.ts   manual dial entry   (early 503)
//   • app/api/outbound/process      campaign start      (paused response)
//   • lib/whatsapp-call-finalize.ts post-call templates  (messages)
//   • app/api/calls/status/route.ts Exotel post-call templates (messages)
//   • lib/voice-conversation.ts     AI-decided application link (messages)
//   • app/api/whatsapp/route.ts     inbound auto-reply (messages)
//   • app/api/instagram/route.ts    comment auto-reply (messages)
// ============================================================

export type AiPauseKind = "calls" | "messages"

export type AiPauseState = {
  calls: { paused: boolean }
  messages: { paused: boolean }
  branches: Record<string, { calls?: boolean; messages?: boolean }>
  reason?: string
  updated_by?: string
  updated_at?: string
}

const EMPTY: AiPauseState = {
  calls: { paused: false },
  messages: { paused: false },
  branches: {},
}

const ROW_ID = "ai_pause"
const CACHE_MS = 8_000 // admins expect near-instant effect; calls are not free-form
let cache: { at: number; state: AiPauseState } | null = null

function sanitize(raw: any): AiPauseState {
  const state: AiPauseState = {
    calls: { paused: raw?.calls?.paused === true },
    messages: { paused: raw?.messages?.paused === true },
    branches: {},
  }
  if (raw?.branches && typeof raw.branches === "object") {
    for (const [branchId, scope] of Object.entries(raw.branches)) {
      if (typeof branchId !== "string" || !branchId || typeof scope !== "object" || !scope) continue
      state.branches[branchId] = {
        calls: (scope as any)?.calls === true,
        messages: (scope as any)?.messages === true,
      }
    }
  }
  if (typeof raw?.reason === "string" && raw.reason.trim()) state.reason = raw.reason.trim().slice(0, 300)
  if (typeof raw?.updated_by === "string") state.updated_by = raw.updated_by.slice(0, 200)
  if (typeof raw?.updated_at === "string") state.updated_at = raw.updated_at
  return state
}

export async function getAiPauseState(): Promise<AiPauseState> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.state
  try {
    const res = await query(`SELECT config FROM form_configs WHERE id = $1 LIMIT 1`, [ROW_ID])
    const state = sanitize(res.rows[0]?.config)
    cache = { at: now, state }
    return state
  } catch (e: any) {
    // DB down: keep the last known state (≤8s old) so a transient blip
    // cannot un-pause automation; with no cache at all, default to RUNNING
    // (calls keep working — compliance/DND checks still guard each dial).
    if (cache) return cache.state
    console.error("ai-pause read failed, assuming RUNNING:", e?.message)
    return EMPTY
  }
}

export function invalidateAiPauseCache() {
  cache = null
}

/** Branch-aware check used by every enforcement point. */
export async function isAiPaused(kind: AiPauseKind, branchId?: string | null): Promise<boolean> {
  const state = await getAiPauseState()
  if (branchId && state.branches[branchId]?.[kind] === true) return true
  return state[kind].paused
}

/** Operator-facing sentence used in API errors and toasts. */
export function aiPauseMessage(kind: AiPauseKind): string {
  const what = kind === "calls" ? "outbound AI calls" : "automated AI messages"
  return `AI automation is PAUSED by an administrator — ${what} are stopped. Resume it in the dashboard: Security → Pause AI.`
}

/** Admin write path — merges a patch over the stored state. */
export async function setAiPauseState(
  patch: {
    calls?: { paused: boolean }
    messages?: { paused: boolean }
    branchCalls?: { branchId: string; paused: boolean } | null
    branchMessages?: { branchId: string; paused: boolean } | null
    reason?: string
  },
  updatedBy: string
): Promise<AiPauseState> {
  const current = await getAiPauseState()
  const next: AiPauseState = {
    calls: { paused: patch.calls?.paused ?? current.calls.paused },
    messages: { paused: patch.messages?.paused ?? current.messages.paused },
    branches: { ...current.branches },
    reason: patch.reason !== undefined ? (patch.reason || undefined) : current.reason,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  }
  if (patch.branchCalls) {
    if (patch.branchCalls.paused) next.branches[patch.branchCalls.branchId] = {
      ...next.branches[patch.branchCalls.branchId],
      calls: true,
    }
    else delete next.branches[patch.branchCalls.branchId]?.calls
  }
  if (patch.branchMessages) {
    if (patch.branchMessages.paused) next.branches[patch.branchMessages.branchId] = {
      ...next.branches[patch.branchMessages.branchId],
      messages: true,
    }
    else delete next.branches[patch.branchMessages.branchId]?.messages
  }
  // Drop empty branch entries so the store stays readable.
  for (const k of Object.keys(next.branches)) {
    if (!next.branches[k]?.calls && !next.branches[k]?.messages) delete next.branches[k]
  }

  await query(
    `INSERT INTO form_configs (id, config, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET config = $2, updated_at = now()`,
    [ROW_ID, JSON.stringify(next)]
  )
  invalidateAiPauseCache()
  return next
}
