"use client"
import { useCallback, useEffect, useState, useMemo } from "react"
import {
  CheckCheck,
  MessageCircle,
  RefreshCw,
  BellRing,
  ExternalLink,
  Clock
} from "lucide-react"
import { SkeletonList } from "../ui/skeleton"
import { usePolling } from "@/lib/use-poll"

// UNIFIED HUMAN ATTENTION REQUIRED — authentic website CSS design

type AttentionCategory = "all" | "loan_confirmed" | "calendar" | "escalation"

export type AttentionItem = {
  id: string
  raw_id: string
  item_source: "comm_log" | "calendar_event" | "loan_application"
  category: "loan_confirmed" | "callback" | "branch_visit" | "document_deadline" | "reminder" | "escalation"
  lead_id: string | null
  lead_name: string | null
  lead_phone: string | null
  lead_whatsapp: string | null
  lead_status: string | null
  lead_address?: string | null
  summary: string | null
  quote?: string | null
  action?: string | null
  product_interest?: string | null
  loan_type?: string | null
  loan_amount?: number | string | null
  monthly_income?: number | string | null
  employment_type?: string | null
  city?: string | null
  call_duration?: number | null
  call_sentiment?: string | null
  call_language?: string | null
  next_action?: string | null
  memory_summary?: string | null
  full_description?: string | null
  event_at?: string | null
  location?: string | null
  channel?: string | null
  confidence?: string | null
  created_at: string
  priority: "critical" | "high" | "medium"
}

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  applied: "Applied",
  interested: "Interested",
  not_interested: "Not interested",
  callback: "Callback asked",
}

export default function AttentionView({ role }: { role: Role }) {
  const [items, setItems] = useState<AttentionItem[] | null>(null)
  const [activeTab, setActiveTab] = useState<AttentionCategory>("all")
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
      setError("Could not load action items.")
      setItems(items ?? [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])
  usePolling(load, 12000)

  async function resolve(item: AttentionItem) {
    setBusyId(item.id)
    try {
      const res = await fetch("/api/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          rawId: item.raw_id,
          itemSource: item.item_source,
        }),
      })
      if (res.ok) {
        setItems(prev => (prev ? prev.filter(i => i.id !== item.id) : prev))
      } else {
        setError("Could not resolve — it may already be handled.")
      }
    } catch {
      setError("Could not resolve. Please try again.")
    } finally {
      setBusyId(null)
    }
  }

  function openChat(leadId: string | null) {
    if (!leadId || typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent("rag:lead-focus", { detail: { leadId, view: "whatsapp" } }))
    window.dispatchEvent(new CustomEvent("rag:navigate", { detail: { view: "whatsapp" } }))
  }

  const counts = useMemo(() => {
    if (!items) return { all: 0, loans: 0, callbacks: 0, escalations: 0 }
    return {
      all: items.length,
      loans: items.filter(i => i.category === "loan_confirmed").length,
      callbacks: items.filter(i => i.category === "callback" || i.category === "branch_visit").length,
      escalations: items.filter(i => i.category === "escalation").length,
    }
  }, [items])

  const filteredItems = useMemo(() => {
    if (!items) return []
    if (activeTab === "all") return items
    if (activeTab === "loan_confirmed") return items.filter(i => i.category === "loan_confirmed")
    if (activeTab === "calendar") return items.filter(i => i.category === "callback" || i.category === "branch_visit")
    if (activeTab === "escalation") return items.filter(i => i.category === "escalation")
    return items
  }, [items, activeTab])

  return (
    <div className="mx-auto max-w-4xl pb-8">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-bold text-[var(--text-primary)]">
            <BellRing size={18} className="text-amber-400" />
            Human Attention Required
            {counts.all > 0 && (
              <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-[11px] font-bold text-amber-400">
                {counts.all} waiting
              </span>
            )}
          </h2>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Priya detected these customers need a person — frustration, a direct request, or an unsupported ask.
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-2 text-[12px]">
        <button
          onClick={() => setActiveTab("all")}
          className={`rounded-md px-3 py-1 font-semibold transition ${
            activeTab === "all"
              ? "bg-[var(--accent-blue)] text-white"
              : "text-[var(--text-secondary)] hover:bg-[var(--overlay-soft)]"
          }`}
        >
          All ({counts.all})
        </button>
        <button
          onClick={() => setActiveTab("loan_confirmed")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-semibold transition ${
            activeTab === "loan_confirmed"
              ? "bg-emerald-600 text-white"
              : "text-emerald-400 hover:bg-emerald-500/10"
          }`}
        >
          Confirmed Loans ({counts.loans})
        </button>
        <button
          onClick={() => setActiveTab("calendar")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-semibold transition ${
            activeTab === "calendar"
              ? "bg-blue-600 text-white"
              : "text-blue-400 hover:bg-blue-500/10"
          }`}
        >
          Callbacks & Visits ({counts.callbacks})
        </button>
        <button
          onClick={() => setActiveTab("escalation")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-semibold transition ${
            activeTab === "escalation"
              ? "bg-rose-600 text-white"
              : "text-rose-400 hover:bg-rose-500/10"
          }`}
        >
          Escalations ({counts.escalations})
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3.5 py-2 text-[12px] text-amber-300">
          {error}
        </div>
      )}

      {/* Main List */}
      {items === null ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
          <SkeletonList rows={3} />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-10 text-center">
          <CheckCheck size={28} className="mx-auto mb-3 text-[var(--accent-green)]" />
          <div className="text-[14px] font-semibold text-[var(--text-primary)]">Nothing needs a human right now</div>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-[var(--text-secondary)]">
            When Priya hears frustration, a request for a person, or a loan confirmation, the lead lands here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {filteredItems.map(item => {
            const isLoan = item.category === "loan_confirmed"
            const isCallback = item.category === "callback"
            const isVisit = item.category === "branch_visit"

            // Authentic badge styling exactly matching the website design
            let badgeText = "Needs a person"
            let badgeBg = "rgba(234,179,8,0.14)"
            let badgeColor = "var(--accent-yellow)"

            if (isLoan) {
              badgeText = "Loan Confirmed"
              badgeBg = "rgba(16,185,129,0.14)"
              badgeColor = "#10b981"
            } else if (isCallback) {
              badgeText = "Callback Scheduled"
              badgeBg = "rgba(59,130,246,0.14)"
              badgeColor = "var(--accent-blue)"
            } else if (isVisit) {
              badgeText = "Office Visit"
              badgeBg = "rgba(168,85,247,0.14)"
              badgeColor = "#a855f7"
            }

            const displayName = item.lead_name || item.lead_phone || "Unknown lead"
            const leadStatus = item.lead_status ? (LEAD_STATUS_LABEL[item.lead_status.toLowerCase()] || item.lead_status) : "Qualified"
            const loanAmtStr = item.loan_amount ? `₹${Number(item.loan_amount).toLocaleString("en-IN")}` : null
            const productStr = item.product_interest ? item.product_interest.toUpperCase() : null

            return (
              <li
                key={item.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 transition hover:border-[var(--border-hover)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {/* Header info line */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-bold text-[var(--text-primary)]">
                        {displayName}
                      </span>
                      {item.lead_phone && (
                        <span className="text-[12px] text-[var(--text-secondary)] font-mono">
                          {item.lead_phone}
                        </span>
                      )}
                      <span
                        className="rounded-md px-1.5 py-px text-[10.5px] font-semibold"
                        style={{ background: badgeBg, color: badgeColor }}
                      >
                        {badgeText}
                      </span>
                      <span className="rounded-md bg-[var(--overlay-soft)] px-1.5 py-px text-[10.5px] font-medium text-[var(--text-secondary)]">
                        Lead: {leadStatus}
                      </span>
                      {productStr && loanAmtStr && (
                        <span className="rounded-md bg-[var(--overlay-soft)] px-1.5 py-px text-[10.5px] font-medium text-emerald-400">
                          {productStr} • {loanAmtStr}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                        <Clock size={10.5} /> {timeAgo(item.created_at)}
                      </span>
                    </div>

                    {/* Full Comprehensive Lead Intelligence Briefing for Loan Officer */}
                    <div className="mt-2.5 rounded-lg bg-[var(--overlay-soft)] p-3 text-[12.5px] leading-relaxed border border-[var(--border)]">
                      <p className="text-[12.5px] text-[var(--text-primary)] leading-relaxed">
                        {item.full_description || item.summary || "Customer confirmed interest and requested loan advisor follow-up."}
                      </p>
                    </div>
                  </div>

                  {/* Actions matching website design */}
                  <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 pt-0.5">
                    {item.lead_id && (
                      <button
                        onClick={() => openChat(item.lead_id)}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition"
                      >
                        <MessageCircle size={13} /> Open chat
                      </button>
                    )}
                    <button
                      onClick={() => resolve(item)}
                      disabled={busyId === item.id}
                      className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-white disabled:opacity-50 transition"
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
        Resolved escalations stay on the lead's timeline for audit.
      </p>
    </div>
  )
}
