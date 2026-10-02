"use client"
import { useCallback, useEffect, useState } from "react"
import { Phone, CheckCheck, CheckCircle2, MessageCircle, RefreshCw, BellRing, ExternalLink, Clock } from "lucide-react"
import { SkeletonList } from "../ui/skeleton"
import { usePolling } from "@/lib/use-poll"

// HUMAN ATTENTION REQUIRED — the queue behind the "Needs Human" nav item.
//
// Rows come from the escalation signals every channel already writes
// (frustration / "talk to a human" / operator requests — lib/frustration.ts).
// Quick actions: call the lead (existing /api/calls/dial), open the WhatsApp
// inbox for them, or mark the escalation resolved once a human handled it.

type Escalation = {
  id: string
  lead_id: string | null
  summary: string | null
  created_at: string
  lead_name: string | null
  lead_phone: string | null
  lead_whatsapp: string | null
  lead_status: string | null
}

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// The five escalation writers (lib/frustration.ts) stamp a structured prefix
// into comm_logs.summary:
//   "⚠️ FRUSTRATED CALLER — said: \"…\" — consider a human callback"
//   "📞 ASKED FOR A HUMAN — said: \"…\" — call them back directly"
//   "📞 ASKED FOR A HUMAN — said: \"…\" — reply to them directly on this chat"
//   "⚠️ FRUSTRATED WHATSAPP CHAT — said: \"…\" — consider a human reply"
//   "⚠️ FRUSTRATED INSTAGRAM DM — said: \"…\" — consider a human reply"
// The old view glued quote + recommendation into one italic line and showed a
// generic "needs a person" chip on every row. Parse the structure once so the
// queue can surface reason / what the customer said / suggested next step.
function parseEscalationSummary(raw: string | null): {
  reason: string
  askedForHuman: boolean
  channel: string | null
  quote: string
  action: string | null
} {
  const s = raw || ""
  const askedForHuman = s.includes("ASKED FOR A HUMAN")
  let reason = "Needs a person"
  if (s.includes("FRUSTRATED CALLER")) reason = "Frustrated on a call"
  else if (s.includes("FRUSTRATED WHATSAPP")) reason = "Frustrated on WhatsApp"
  else if (s.includes("FRUSTRATED INSTAGRAM")) reason = "Frustrated on Instagram"
  else if (askedForHuman) reason = "Asked for a human"

  let channel: string | null = null
  if (s.includes("CALLER")) channel = "call"
  else if (s.includes("WHATSAPP")) channel = "whatsapp"
  else if (s.includes("INSTAGRAM")) channel = "instagram"

  const saidIdx = s.indexOf('said: "')
  let quote = ""
  let action: string | null = null
  if (saidIdx >= 0) {
    const after = s.slice(saidIdx + 7)
    const closeIdx = after.indexOf('"')
    quote = (closeIdx >= 0 ? after.slice(0, closeIdx) : after).trim()
    if (closeIdx >= 0) {
      const tail = after.slice(closeIdx + 1).trim()
      const dashIdx = tail.lastIndexOf(" — ")
      action = (dashIdx >= 0 ? tail.slice(dashIdx + 3) : tail).replace(/^-+\s*/, "").trim() || null
    }
  } else {
    // Legacy/unknown format — fall back to the old strip-the-prefix display.
    quote = s.replace(/^.*?:\s*/, "").slice(0, 220)
  }
  return { reason, askedForHuman, channel, quote, action }
}

const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", applied: "Applied",
  interested: "Interested", not_interested: "Not interested", callback: "Callback asked",
}

export default function AttentionView({ role }: { role: Role }) {
  const [items, setItems] = useState<Escalation[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch("/api/escalations")
      if (!res.ok) throw new Error("failed")
      const d = await res.json()
      setItems(Array.isArray(d.items) ? d.items : [])
    } catch {
      setError("Could not load escalations. Please try again.")
      setItems(items ?? [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  // Escalations are time-critical — a customer asking for a person ages badly
  // if the owner has to remember to hit Refresh. Same 15s cadence as Leads.
  usePolling(load, 15000)

  async function resolve(id: string) {
    setBusyId(id)
    try {
      const res = await fetch("/api/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId: id }),
      })
      if (res.ok) {
        setItems(prev => (prev ? prev.filter(i => i.id !== id) : prev))
      } else {
        setError("Could not resolve — it may already be handled.")
      }
    } catch {
      setError("Could not resolve. Please try again.")
    } finally {
      setBusyId(null)
    }
  }

  async function callLead(leadId: string | null) {
    if (!leadId) return
    setBusyId(leadId)
    try {
      const res = await fetch("/api/calls/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, channel: "auto" }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) setError(d.error || "Call could not be placed.")
    } catch {
      setError("Call could not be placed.")
    } finally {
      setBusyId(null)
    }
  }

  function openChat(leadId: string | null) {
    if (!leadId || typeof window === "undefined") return
    // The WhatsApp view reads a lead-focus handoff, same as other views.
    window.dispatchEvent(new CustomEvent("rag:lead-focus", { detail: { leadId, view: "whatsapp" } }))
    window.dispatchEvent(new CustomEvent("rag:navigate", { detail: { view: "whatsapp" } }))
  }

  const canCall = role === "admin" || role === "agent" || role === "branch_manager" || role === "developer"

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-[var(--text-primary)]">
            <span className="flex items-center gap-2">
              <BellRing size={16} className="text-[var(--accent-yellow)]" />
              Human Attention Required
            </span>
            {items && items.length > 0 && (
              <span className="rounded-full bg-[rgba(234,179,8,0.14)] px-2 py-0.5 text-[11px] font-bold text-[var(--accent-yellow)]">
                {items.length} waiting
              </span>
            )}
          </h2>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Priya detected these customers need a person — frustration, a direct request, or an unsupported ask.
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh escalations"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-[rgba(234,179,8,0.35)] bg-[rgba(234,179,8,0.08)] px-3 py-2 text-[12.5px] text-[var(--accent-yellow)]">
          {error}
        </div>
      )}

      {items === null ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <SkeletonList rows={5} />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-10 text-center">
          <CheckCheck size={28} className="mx-auto mb-3 text-[var(--accent-green)]" />
          <div className="text-[14px] font-semibold text-[var(--text-primary)]">Nothing needs a human right now</div>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-[var(--text-secondary)]">
            When Priya hears frustration, a request for a person, or a question she is not allowed to answer, the
            conversation lands here with the reason and the customer's details.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map(item => {
            const esc = parseEscalationSummary(item.summary)
            return (
            <li key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-bold text-[var(--text-primary)]">
                      {item.lead_name || item.lead_phone || "Unknown lead"}
                    </span>
                    {item.lead_phone && (
                      <span className="text-[12px] text-[var(--text-secondary)]">{item.lead_phone}</span>
                    )}
                    <span
                      className="rounded-md px-1.5 py-px text-[10.5px] font-semibold"
                      style={{
                        background: esc.askedForHuman ? "rgba(59,130,246,0.14)" : "rgba(234,179,8,0.14)",
                        color: esc.askedForHuman ? "var(--accent-blue)" : "var(--accent-yellow)",
                      }}
                    >
                      {esc.reason}
                    </span>
                    {item.lead_status && (
                      <span className="rounded-md bg-[var(--overlay-soft)] px-1.5 py-px text-[10.5px] font-medium text-[var(--text-secondary)]">
                        Lead: {LEAD_STATUS_LABEL[item.lead_status.toLowerCase()] || item.lead_status}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                      <Clock size={10.5} /> {timeAgo(item.created_at)}
                    </span>
                  </div>
                  {esc.quote && (
                    <p className="mt-1.5 rounded-lg bg-[var(--overlay-soft)] px-2.5 py-1.5 text-[12.5px] italic text-[var(--text-secondary)]">
                      “{esc.quote.slice(0, 220)}”
                    </p>
                  )}
                  {esc.action && (
                    <p className="mt-1.5 flex items-start gap-1 text-[11.5px] text-[var(--text-muted)]">
                      <CheckCircle2 size={12} className="mt-px flex-shrink-0 text-[var(--accent-green)]" />
                      <span>Suggested next step: {esc.action}</span>
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
                  {canCall && item.lead_id && (
                    <button
                      onClick={() => callLead(item.lead_id)}
                      disabled={busyId === item.id || busyId === item.lead_id}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                    >
                      <Phone size={13} /> Call
                    </button>
                  )}
                  {item.lead_id && (
                    <button
                      onClick={() => openChat(item.lead_id)}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <MessageCircle size={13} /> Open chat
                    </button>
                  )}
                  <button
                    onClick={() => resolve(item.id)}
                    disabled={busyId === item.id}
                    className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-white disabled:opacity-50"
                    style={{ background: "var(--gradient-brand)" }}
                  >
                    <CheckCheck size={13} /> Mark resolved
                  </button>
                </div>
              </div>
            </li>
            )
          })}
        </ul>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
        <ExternalLink size={12} />
        Resolved escalations stay in the Communication Log for audit.
      </p>
    </div>
  )
}
