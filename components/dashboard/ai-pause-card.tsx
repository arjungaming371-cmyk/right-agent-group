"use client"
import { useCallback, useEffect, useState } from "react"
import { PauseCircle, PlayCircle } from "lucide-react"
import { useToast } from "../ui/toast"

// PAUSE AI — the kill-switch control card (Security view, admin/developer).
//
// Two independent toggles, global scope:
//   • Outbound AI calls      — manual dials, bulk campaigns, WhatsApp outbound
//   • Automated AI messages  — WhatsApp/Instagram auto-replies, follow-up
//                              templates, AI-decided application links
// Per-branch pauses can also be set (branchId + branchCalls/branchMessages).
//
// Enforcement lives server-side (lib/ai-pause.ts; pinned by
// scripts/test-product-upgrade.js) — this card only writes the flag and
// mirrors the state. Every change is audit-logged with the stated reason.

type PauseState = {
  calls: boolean
  messages: boolean
  branches: Record<string, { calls?: boolean; messages?: boolean }>
  reason: string | null
  updated_by: string | null
  updated_at: string | null
}

export default function AiPauseCard() {
  const toast = useToast()
  const [state, setState] = useState<PauseState | null>(null)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState<"calls" | "messages" | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai-pause")
      if (res.ok) {
        const d = await res.json()
        setState({
          calls: !!d.calls,
          messages: !!d.messages,
          branches: d.branches && typeof d.branches === "object" ? d.branches : {},
          reason: d.reason ?? null,
          updated_by: d.updated_by ?? null,
          updated_at: d.updated_at ?? null,
        })
      }
    } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  async function flip(kind: "calls" | "messages") {
    if (!state) return
    const pausing = !state[kind]
    const why = pausing && !reason.trim()
      ? window.prompt(`Reason for pausing ${kind === "calls" ? "outbound AI calls" : "automated AI messages"}? (recorded in the audit log)`) || ""
      : reason
    setSaving(kind)
    try {
      const res = await fetch("/api/ai-pause", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [kind]: pausing, reason: why }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(
          pausing
            ? `AI ${kind === "calls" ? "outbound calls" : "automated messages"} PAUSED — enforcement is active everywhere`
            : `AI ${kind === "calls" ? "outbound calls" : "automated messages"} resumed`
        )
        setReason(why)
        await load()
      } else {
        toast.error(d.error || "Could not change the pause state")
      }
    } catch {
      toast.error("Could not change the pause state")
    } finally {
      setSaving(null)
    }
  }

  async function pauseBranch(branchId: string, kind: "branchCalls" | "branchMessages", current: boolean) {
    try {
      const res = await fetch("/api/ai-pause", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, [kind]: !current, reason: reason || undefined }),
      })
      if (res.ok) {
        toast.success(!current ? "Branch paused" : "Branch resumed")
        await load()
      } else toast.error("Could not change the branch pause")
    } catch {
      toast.error("Could not change the branch pause")
    }
  }

  const anythingPaused = state && (state.calls || state.messages || Object.keys(state.branches).length > 0)

  return (
    <div style={{ background: "var(--bg-card)", border: `1px solid ${anythingPaused ? "rgba(220,38,38,0.4)" : "var(--border)"}`, borderRadius: 12 }}>
      <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Pause AI</span>
        {anythingPaused && (
          <span style={{ background: "rgba(220,38,38,0.14)", color: "#f87171", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700 }}>
            AI AUTOMATION PAUSED
          </span>
        )}
      </div>

      <div style={{ padding: "14px 24px" }}>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0 }}>
          Emergency stop for automation. Pausing never blocks human actions — your team can still call and message
          manually. Every change is audit-logged with who, when, why and scope.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {/* Outbound calls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--bg-secondary)", borderRadius: 10, padding: "12px 14px" }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Outbound AI calls</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                Manual dials, bulk campaigns, WhatsApp business-initiated calls
              </div>
              {state?.calls && (
                <div style={{ fontSize: 11, color: "#f87171", marginTop: 3 }}>
                  Paused{state.updated_by ? ` by ${state.updated_by}` : ""}{state.updated_at ? ` — ${new Date(state.updated_at).toLocaleString()}` : ""}
                </div>
              )}
            </div>
            <button
              onClick={() => flip("calls")}
              disabled={!state || saving === "calls"}
              className={state?.calls ? "btn-ghost" : "btn-primary"}
              style={{ height: 34, padding: "0 14px", fontSize: 12.5, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {state?.calls ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
              {state?.calls ? "Resume" : "Pause"}
            </button>
          </div>

          {/* Automated messages */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--bg-secondary)", borderRadius: 10, padding: "12px 14px" }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Automated AI messages</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                WhatsApp/Instagram auto-replies, follow-up templates, AI application links
              </div>
              {state?.messages && (
                <div style={{ fontSize: 11, color: "#f87171", marginTop: 3 }}>
                  Paused{state.updated_by ? ` by ${state.updated_by}` : ""}{state.updated_at ? ` — ${new Date(state.updated_at).toLocaleString()}` : ""}
                </div>
              )}
            </div>
            <button
              onClick={() => flip("messages")}
              disabled={!state || saving === "messages"}
              className={state?.messages ? "btn-ghost" : "btn-primary"}
              style={{ height: 34, padding: "0 14px", fontSize: 12.5, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {state?.messages ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
              {state?.messages ? "Resume" : "Pause"}
            </button>
          </div>

          {/* Reason */}
          <div>
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Reason (optional) — stored in the audit log when pausing"
              maxLength={300}
              style={{
                width: "100%", height: 34, borderRadius: 10, border: "1px solid var(--border)",
                background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 12.5, padding: "0 12px", outline: "none",
              }}
            />
          </div>

          {/* Per-branch pauses */}
          {state && Object.keys(state.branches).length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Branch-scoped pauses active: {Object.entries(state.branches).map(([id, s]) => {
                const parts = [s.calls ? "calls" : null, s.messages ? "messages" : null].filter(Boolean).join(" + ")
                return `${id.slice(0, 8)}… (${parts})`
              }).join(", ")}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
