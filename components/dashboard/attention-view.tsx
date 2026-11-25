"use client"
import { useCallback, useEffect, useState, useMemo } from "react"
import {
  Phone,
  CheckCheck,
  CheckCircle2,
  MessageCircle,
  RefreshCw,
  BellRing,
  Clock,
  Sparkles,
  CalendarClock,
  Building2,
  AlertTriangle,
  MapPin,
  Banknote,
  Info
} from "lucide-react"
import { SkeletonList } from "../ui/skeleton"
import { usePolling } from "@/lib/use-poll"

// UNIFIED HUMAN ACTION CENTER (Compact & Streamlined)

type AttentionCategory = "all" | "loan_confirmed" | "calendar" | "escalation"

export type AttentionItem = {
  id: string
  raw_id: string
  item_source: "comm_log" | "calendar_event" | "loan_application"
  category: "loan_confirmed" | "callback" | "branch_visit" | "document_deadline" | "reminder" | "escalation"
  lead_id: string | null
  lead_name: string | null
  full_spoken_name?: string | null
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

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return ""
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function formatEventTiming(isoDate?: string | null): { text: string; isOverdue: boolean; badge: string } {
  if (!isoDate) return { text: "", isOverdue: false, badge: "" }
  const d = new Date(isoDate)
  if (isNaN(d.getTime())) return { text: "", isOverdue: false, badge: "" }

  const now = new Date()
  const diffMinutes = Math.round((d.getTime() - now.getTime()) / 60000)
  const isToday = d.toDateString() === now.toDateString()
  const isOverdue = diffMinutes < 0

  const timeStr = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
  const dateStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })

  if (isOverdue) {
    const overdueMins = Math.abs(diffMinutes)
    const label = overdueMins > 60 ? `${Math.floor(overdueMins / 60)}h overdue` : `${overdueMins}m overdue`
    return { text: `${isToday ? "Today" : dateStr} at ${timeStr}`, isOverdue: true, badge: label }
  }

  if (isToday) {
    return { text: `Today at ${timeStr}`, isOverdue: false, badge: diffMinutes <= 60 ? `Due in ${diffMinutes}m` : `Today ${timeStr}` }
  }

  return { text: `${dateStr} at ${timeStr}`, isOverdue: false, badge: dateStr }
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
    window.dispatchEvent(new CustomEvent("rag:lead-focus", { detail: { leadId, view: "whatsapp" } }))
    window.dispatchEvent(new CustomEvent("rag:navigate", { detail: { view: "whatsapp" } }))
  }

  const counts = useMemo(() => {
    if (!items) return { all: 0, loans: 0, callbacks: 0, escalations: 0 }
    return {
      all: items.length,
      loans: items.filter(i => i.category === "loan_confirmed").length,
      callbacks: items.filter(i => i.category === "callback" || i.category === "branch_visit" || i.category === "document_deadline" || i.category === "reminder").length,
      escalations: items.filter(i => i.category === "escalation").length,
    }
  }, [items])

  const filteredItems = useMemo(() => {
    if (!items) return []
    if (activeTab === "all") return items
    if (activeTab === "loan_confirmed") return items.filter(i => i.category === "loan_confirmed")
    if (activeTab === "calendar") return items.filter(i => i.category === "callback" || i.category === "branch_visit" || i.category === "document_deadline" || i.category === "reminder")
    if (activeTab === "escalation") return items.filter(i => i.category === "escalation")
    return items
  }, [items, activeTab])

  const canCall = role === "admin" || role === "agent" || role === "branch_manager" || role === "developer"

  return (
    <div className="mx-auto max-w-4xl pb-8">
      {/* Header */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-bold text-[var(--text-primary)]">
            <BellRing size={16} className="text-amber-400" />
            Human Attention Required
            {counts.all > 0 && (
              <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[11px] font-bold text-amber-400">
                {counts.all} waiting
              </span>
            )}
          </h2>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Confirmed loan leads, scheduled callbacks, and customer escalations.
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh"
          className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="mb-3.5 flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] pb-2 text-[11.5px]">
        <button
          onClick={() => setActiveTab("all")}
          className={`rounded-md px-2.5 py-1 font-semibold transition ${
            activeTab === "all"
              ? "bg-[var(--accent-blue)] text-white"
              : "text-[var(--text-secondary)] hover:bg-[var(--overlay-soft)]"
          }`}
        >
          All ({counts.all})
        </button>
        <button
          onClick={() => setActiveTab("loan_confirmed")}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
            activeTab === "loan_confirmed"
              ? "bg-emerald-600 text-white"
              : "text-emerald-400 hover:bg-emerald-500/10"
          }`}
        >
          <Sparkles size={11.5} /> Confirmed Loans ({counts.loans})
        </button>
        <button
          onClick={() => setActiveTab("calendar")}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
            activeTab === "calendar"
              ? "bg-blue-600 text-white"
              : "text-blue-400 hover:bg-blue-500/10"
          }`}
        >
          <CalendarClock size={11.5} /> Callbacks & Visits ({counts.callbacks})
        </button>
        <button
          onClick={() => setActiveTab("escalation")}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
            activeTab === "escalation"
              ? "bg-rose-600 text-white"
              : "text-rose-400 hover:bg-rose-500/10"
          }`}
        >
          <AlertTriangle size={11.5} /> Escalations ({counts.escalations})
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-300">
          {error}
        </div>
      )}

      {/* Main List */}
      {items === null ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <SkeletonList rows={3} />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center">
          <CheckCheck size={26} className="mx-auto mb-2 text-emerald-400" />
          <div className="text-[13px] font-semibold text-[var(--text-primary)]">All caught up! Zero pending tasks</div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filteredItems.map(item => {
            const isLoan = item.category === "loan_confirmed"
            const isVisit = item.category === "branch_visit"
            const isCallback = item.category === "callback"
            const isEscalation = item.category === "escalation"
            const timing = item.event_at ? formatEventTiming(item.event_at) : null
            const callDurStr = formatDuration(item.call_duration)

            const displayName = item.full_spoken_name || item.lead_name || "Unknown Lead"
            const product = item.product_interest ? item.product_interest.toUpperCase() : "LOAN"
            const amount = item.loan_amount ? `₹${Number(item.loan_amount).toLocaleString("en-IN")}` : null
            const location = item.lead_address || item.city || item.location

            return (
              <li
                key={item.id}
                className={`rounded-lg border p-3 sm:p-3.5 transition ${
                  isLoan
                    ? "border-emerald-500/35 bg-[var(--bg-card)] hover:border-emerald-500/60"
                    : timing?.isOverdue
                    ? "border-rose-500/35 bg-[var(--bg-card)]"
                    : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
                }`}
              >
                {/* Header Line */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-bold text-[var(--text-primary)]">
                      {displayName}
                    </span>
                    {item.lead_name && item.full_spoken_name && item.lead_name !== item.full_spoken_name && (
                      <span className="text-[11.5px] text-[var(--text-muted)]">({item.lead_name})</span>
                    )}
                    {item.lead_phone && (
                      <span className="text-[12px] font-mono text-[var(--text-secondary)]">
                        {item.lead_phone}
                      </span>
                    )}

                    {/* Compact Category Badge */}
                    {isLoan && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10.5px] font-bold text-emerald-400">
                        <Sparkles size={10} /> LOAN CONFIRMED
                      </span>
                    )}
                    {isCallback && (
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-bold ${
                          timing?.isOverdue
                            ? "bg-rose-500/15 border border-rose-500/30 text-rose-400"
                            : "bg-blue-500/15 border border-blue-500/30 text-blue-400"
                        }`}
                      >
                        <CalendarClock size={10} /> {timing?.badge || "CALLBACK"}
                      </span>
                    )}
                    {isVisit && (
                      <span className="inline-flex items-center gap-1 rounded bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[10.5px] font-bold text-purple-400">
                        <Building2 size={10} /> OFFICE VISIT
                      </span>
                    )}
                    {isEscalation && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-400">
                        <AlertTriangle size={10} /> ESCALATION
                      </span>
                    )}

                    {/* Key Inline Spec Badges */}
                    {amount && (
                      <span className="rounded bg-[var(--overlay-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                        {product} • {amount}
                      </span>
                    )}
                    {location && (
                      <span className="text-[11px] text-[var(--text-secondary)] flex items-center gap-0.5">
                        <MapPin size={10.5} className="text-blue-400" /> {location}
                      </span>
                    )}
                    {callDurStr && (
                      <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-0.5">
                        <Phone size={10.5} className="text-purple-400" /> {callDurStr}
                        {item.call_language ? ` (${item.call_language.slice(0, 2).toUpperCase()})` : ""}
                      </span>
                    )}

                    <span className="flex items-center gap-1 text-[10.5px] text-[var(--text-muted)] ml-auto sm:ml-0">
                      <Clock size={10} /> {timeAgo(item.created_at)}
                    </span>
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    {canCall && item.lead_id && (
                      <button
                        onClick={() => callLead(item.lead_id)}
                        disabled={busyId === item.id || busyId === item.lead_id}
                        className="flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] disabled:opacity-50 transition"
                      >
                        <Phone size={11} /> Call
                      </button>
                    )}
                    {item.lead_id && (
                      <button
                        onClick={() => openChat(item.lead_id)}
                        className="flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition"
                      >
                        <MessageCircle size={11} /> WhatsApp
                      </button>
                    )}
                    <button
                      onClick={() => resolve(item)}
                      disabled={busyId === item.id}
                      className="flex h-7 items-center gap-1 rounded-md px-2.5 text-[11.5px] font-semibold text-white shadow-sm disabled:opacity-50 transition"
                      style={{
                        background: isLoan
                          ? "linear-gradient(135deg, #059669 0%, #10b981 100%)"
                          : "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)"
                      }}
                    >
                      <CheckCheck size={11.5} />
                      {isLoan ? "Mark Processed" : "Mark Handled"}
                    </button>
                  </div>
                </div>

                {/* Compact Description (1-2 clear lines) */}
                <div className="mt-2 text-[12px] leading-snug text-[var(--text-secondary)]">
                  {item.full_description || item.summary}
                </div>

                {/* Subtext: Timing or Next Step */}
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-muted)]">
                  {timing?.text && (
                    <span className="flex items-center gap-1 text-blue-400 font-medium">
                      <Clock size={11} /> Scheduled: {timing.text}
                    </span>
                  )}
                  {item.next_action && (
                    <span className="flex items-center gap-1 text-emerald-400/90 font-medium truncate">
                      <CheckCircle2 size={11} /> Next: {item.next_action}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
