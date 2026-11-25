"use client"
import { useCallback, useEffect, useState, useMemo } from "react"
import {
  Phone,
  CheckCheck,
  CheckCircle2,
  MessageCircle,
  RefreshCw,
  BellRing,
  ExternalLink,
  Clock,
  Sparkles,
  CalendarClock,
  Building2,
  AlertTriangle,
  FileCheck,
  TrendingUp,
  MapPin,
  Banknote,
  ArrowRight,
  Filter,
  UserCheck,
  Info,
  ChevronDown,
  ChevronUp
} from "lucide-react"
import { SkeletonList } from "../ui/skeleton"
import { usePolling } from "@/lib/use-poll"

// UNIFIED HUMAN ACTION CENTER
// Consolidates:
// 1. Confirmed Loan Applicants (hot leads who agreed to loan on call or submitted application)
// 2. Scheduled Callbacks & Office Visits (from autonomous calendar agent)
// 3. Customer Escalations & Frustration Flags

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

function formatEventTiming(isoDate?: string | null): { text: string; isOverdue: boolean; isToday: boolean; badge: string } {
  if (!isoDate) return { text: "No date set", isOverdue: false, isToday: false, badge: "Pending" }
  const d = new Date(isoDate)
  if (isNaN(d.getTime())) return { text: "Invalid date", isOverdue: false, isToday: false, badge: "Pending" }

  const now = new Date()
  const diffMinutes = Math.round((d.getTime() - now.getTime()) / 60000)
  const isToday = d.toDateString() === now.toDateString()
  const isOverdue = diffMinutes < 0

  const timeStr = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
  const dateStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })

  if (isOverdue) {
    const overdueMins = Math.abs(diffMinutes)
    const overdueLabel = overdueMins > 60 ? `${Math.floor(overdueMins / 60)}h ago` : `${overdueMins}m ago`
    return {
      text: `${isToday ? "Today" : dateStr} at ${timeStr}`,
      isOverdue: true,
      isToday,
      badge: `Overdue (${overdueLabel})`
    }
  }

  if (isToday) {
    if (diffMinutes <= 60) {
      return { text: `Today at ${timeStr}`, isOverdue: false, isToday: true, badge: `Due in ${diffMinutes}m` }
    }
    return { text: `Today at ${timeStr}`, isOverdue: false, isToday: true, badge: `Today ${timeStr}` }
  }

  return { text: `${dateStr} at ${timeStr}`, isOverdue: false, isToday: false, badge: `${dateStr}` }
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
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch("/api/escalations")
      if (!res.ok) throw new Error("failed")
      const d = await res.json()
      setItems(Array.isArray(d.items) ? d.items : [])
    } catch {
      setError("Could not load action items. Please try again.")
      setItems(items ?? [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  // Real-time polling every 12 seconds
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
    <div className="mx-auto max-w-5xl pb-10">
      {/* Header & Stats Banner */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-2.5 text-[18px] font-bold text-[var(--text-primary)]">
            <span className="flex items-center gap-2">
              <BellRing size={20} className="text-amber-400" />
              Human Action Center
            </span>
            {counts.all > 0 && (
              <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-[11.5px] font-bold text-amber-400">
                {counts.all} active tasks
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
            Full lead intelligence for confirmed loan applicants, scheduled callbacks, office visits & escalations.
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh action items"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div
          onClick={() => setActiveTab("loan_confirmed")}
          className={`cursor-pointer rounded-xl border p-4 transition ${
            activeTab === "loan_confirmed"
              ? "border-emerald-500/60 bg-emerald-500/10 shadow-sm ring-1 ring-emerald-500/20"
              : "border-[var(--border)] bg-[var(--bg-card)] hover:border-emerald-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-emerald-400 flex items-center gap-1.5">
              <Sparkles size={15} /> Confirmed Loans
            </span>
            <span className="text-[20px] font-bold text-[var(--text-primary)]">{counts.loans}</span>
          </div>
          <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">Agreed on call or submitted application — ready to close</p>
        </div>

        <div
          onClick={() => setActiveTab("calendar")}
          className={`cursor-pointer rounded-xl border p-4 transition ${
            activeTab === "calendar"
              ? "border-blue-500/60 bg-blue-500/10 shadow-sm ring-1 ring-blue-500/20"
              : "border-[var(--border)] bg-[var(--bg-card)] hover:border-blue-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-blue-400 flex items-center gap-1.5">
              <CalendarClock size={15} /> Callbacks & Visits
            </span>
            <span className="text-[20px] font-bold text-[var(--text-primary)]">{counts.callbacks}</span>
          </div>
          <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">Scheduled phone callbacks & office appointments</p>
        </div>

        <div
          onClick={() => setActiveTab("escalation")}
          className={`cursor-pointer rounded-xl border p-4 transition ${
            activeTab === "escalation"
              ? "border-rose-500/60 bg-rose-500/10 shadow-sm ring-1 ring-rose-500/20"
              : "border-[var(--border)] bg-[var(--bg-card)] hover:border-rose-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-rose-400 flex items-center gap-1.5">
              <AlertTriangle size={15} /> Escalations
            </span>
            <span className="text-[20px] font-bold text-[var(--text-primary)]">{counts.escalations}</span>
          </div>
          <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">Callers who asked for a human or had frustration</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-2.5">
        <button
          onClick={() => setActiveTab("all")}
          className={`rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition ${
            activeTab === "all"
              ? "bg-[var(--accent-blue)] text-white shadow-sm"
              : "text-[var(--text-secondary)] hover:bg-[var(--overlay-soft)]"
          }`}
        >
          All Items ({counts.all})
        </button>
        <button
          onClick={() => setActiveTab("loan_confirmed")}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition ${
            activeTab === "loan_confirmed"
              ? "bg-emerald-600 text-white shadow-sm"
              : "text-emerald-400 hover:bg-emerald-500/10"
          }`}
        >
          <Sparkles size={13} /> Confirmed Loans ({counts.loans})
        </button>
        <button
          onClick={() => setActiveTab("calendar")}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition ${
            activeTab === "calendar"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-blue-400 hover:bg-blue-500/10"
          }`}
        >
          <CalendarClock size={13} /> Callbacks & Visits ({counts.callbacks})
        </button>
        <button
          onClick={() => setActiveTab("escalation")}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition ${
            activeTab === "escalation"
              ? "bg-rose-600 text-white shadow-sm"
              : "text-rose-400 hover:bg-rose-500/10"
          }`}
        >
          <AlertTriangle size={13} /> Escalations ({counts.escalations})
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-300">
          {error}
        </div>
      )}

      {/* Main List */}
      {items === null ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <SkeletonList rows={5} />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-12 text-center">
          <CheckCheck size={32} className="mx-auto mb-3 text-emerald-400" />
          <div className="text-[14.5px] font-semibold text-[var(--text-primary)]">
            {activeTab === "all"
              ? "All clear — zero pending human tasks!"
              : activeTab === "loan_confirmed"
              ? "No pending confirmed loans right now."
              : activeTab === "calendar"
              ? "No scheduled callbacks or visits pending."
              : "No active escalations."}
          </div>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-[var(--text-secondary)]">
            When Priya confirms a loan with a customer, schedules a callback, or detects escalation, it will appear here automatically with full customer details.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {filteredItems.map(item => {
            const isLoan = item.category === "loan_confirmed"
            const isVisit = item.category === "branch_visit"
            const isCallback = item.category === "callback"
            const isEscalation = item.category === "escalation"
            const timing = item.event_at ? formatEventTiming(item.event_at) : null
            const callDurStr = formatDuration(item.call_duration)
            const isExpanded = expandedId === item.id

            const displayName = item.full_spoken_name || item.lead_name || "Unknown Lead"
            const product = item.product_interest ? item.product_interest.toUpperCase() : "LOAN"
            const amount = item.loan_amount ? `₹${Number(item.loan_amount).toLocaleString("en-IN")}` : null

            return (
              <li
                key={item.id}
                className={`rounded-xl border p-4 sm:p-5 transition ${
                  isLoan
                    ? "border-emerald-500/40 bg-[var(--bg-card)] shadow-sm hover:border-emerald-500/70"
                    : timing?.isOverdue
                    ? "border-rose-500/40 bg-[var(--bg-card)]"
                    : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
                }`}
              >
                {/* Row 1: Lead Identity & Header Status */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15.5px] font-bold text-[var(--text-primary)] tracking-tight">
                        {displayName}
                      </span>
                      {item.lead_name && item.full_spoken_name && item.lead_name !== item.full_spoken_name && (
                        <span className="text-[12px] text-[var(--text-muted)]">({item.lead_name})</span>
                      )}
                      {item.lead_phone && (
                        <span className="text-[12.5px] font-mono font-medium text-[var(--text-secondary)]">
                          {item.lead_phone}
                        </span>
                      )}

                      {/* Prominent Category Badge */}
                      {isLoan && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/35 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                          <Sparkles size={11} /> LOAN CONFORMED
                        </span>
                      )}
                      {isCallback && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-[11px] font-bold ${
                            timing?.isOverdue
                              ? "bg-rose-500/15 border border-rose-500/35 text-rose-400"
                              : "bg-blue-500/15 border border-blue-500/35 text-blue-400"
                          }`}
                        >
                          <CalendarClock size={11} /> {timing?.badge || "CALLBACK"}
                        </span>
                      )}
                      {isVisit && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/15 border border-purple-500/35 px-2.5 py-0.5 text-[11px] font-bold text-purple-400">
                          <Building2 size={11} /> OFFICE VISIT
                        </span>
                      )}
                      {isEscalation && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 border border-amber-500/35 px-2.5 py-0.5 text-[11px] font-bold text-amber-400">
                          <AlertTriangle size={11} /> ESCALATION
                        </span>
                      )}

                      {/* Lead Status */}
                      {item.lead_status && (
                        <span className="rounded-md bg-[var(--overlay-soft)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--text-secondary)]">
                          Status: {LEAD_STATUS_LABEL[item.lead_status.toLowerCase()] || item.lead_status}
                        </span>
                      )}

                      <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] ml-auto">
                        <Clock size={11} /> {timeAgo(item.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Actions Header */}
                  <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                    {canCall && item.lead_id && (
                      <button
                        onClick={() => callLead(item.lead_id)}
                        disabled={busyId === item.id || busyId === item.lead_id}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] disabled:opacity-50 transition"
                      >
                        <Phone size={13} /> Call
                      </button>
                    )}
                    {item.lead_id && (
                      <button
                        onClick={() => openChat(item.lead_id)}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition"
                      >
                        <MessageCircle size={13} /> WhatsApp
                      </button>
                    )}
                    <button
                      onClick={() => resolve(item)}
                      disabled={busyId === item.id}
                      className="flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[12px] font-semibold text-white shadow-sm disabled:opacity-50 transition"
                      style={{
                        background: isLoan
                          ? "linear-gradient(135deg, #059669 0%, #10b981 100%)"
                          : "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)"
                      }}
                    >
                      <CheckCheck size={13} />
                      {isLoan ? "Mark Processed" : "Mark Handled"}
                    </button>
                  </div>
                </div>

                {/* Row 2: Comprehensive Specification Badges Grid */}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-[12px]">
                  {/* Loan Spec */}
                  <div className="rounded-lg bg-[var(--overlay-soft)] p-2.5 border border-[var(--border)]">
                    <span className="text-[10.5px] uppercase font-bold text-[var(--text-muted)] flex items-center gap-1">
                      <Banknote size={12} className="text-emerald-400" /> Loan Requirement
                    </span>
                    <div className="mt-1 font-semibold text-[var(--text-primary)] truncate">
                      {product} {amount ? `• ${amount}` : ""}
                    </div>
                  </div>

                  {/* Location Spec */}
                  <div className="rounded-lg bg-[var(--overlay-soft)] p-2.5 border border-[var(--border)]">
                    <span className="text-[10.5px] uppercase font-bold text-[var(--text-muted)] flex items-center gap-1">
                      <MapPin size={12} className="text-blue-400" /> Location / City
                    </span>
                    <div className="mt-1 font-semibold text-[var(--text-primary)] truncate">
                      {item.lead_address || item.city || item.location || "Hyderabad"}
                    </div>
                  </div>

                  {/* Call Intel */}
                  <div className="rounded-lg bg-[var(--overlay-soft)] p-2.5 border border-[var(--border)]">
                    <span className="text-[10.5px] uppercase font-bold text-[var(--text-muted)] flex items-center gap-1">
                      <Phone size={12} className="text-purple-400" /> Call Intel
                    </span>
                    <div className="mt-1 font-semibold text-[var(--text-primary)] truncate">
                      {callDurStr ? `${callDurStr}` : "Direct Contact"}
                      {item.call_language ? ` • ${item.call_language.toUpperCase()}` : ""}
                    </div>
                  </div>

                  {/* Profile / Income */}
                  <div className="rounded-lg bg-[var(--overlay-soft)] p-2.5 border border-[var(--border)]">
                    <span className="text-[10.5px] uppercase font-bold text-[var(--text-muted)] flex items-center gap-1">
                      <UserCheck size={12} className="text-amber-400" /> Employment / Income
                    </span>
                    <div className="mt-1 font-semibold text-[var(--text-primary)] truncate">
                      {item.employment_type || (isLoan ? "Student / Salaried" : "Direct Lead")}
                      {item.monthly_income ? ` • ₹${Number(item.monthly_income).toLocaleString("en-IN")}` : ""}
                    </div>
                  </div>
                </div>

                {/* Row 3: FULL COMPREHENSIVE LEAD DESCRIPTION PANEL */}
                <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-3 sm:p-3.5">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-emerald-400 mb-1">
                    <span className="flex items-center gap-1.5">
                      <Info size={13} /> Full Lead Intelligence & Situation
                    </span>
                    {timing?.text && (
                      <span className="text-[var(--text-muted)] font-normal normal-case">
                        Scheduled: {timing.text}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] leading-relaxed text-[var(--text-primary)] font-normal">
                    {item.full_description || item.summary || "Customer confirmed interest and requested loan advisor follow-up."}
                  </p>
                </div>

                {/* Row 4: Suggested Next Step / Action */}
                <div className="mt-2.5 flex items-center justify-between text-[11.5px] text-[var(--text-muted)] px-1">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                    <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                    <span>
                      Suggested Next Step: {item.next_action || "Call customer to verify KYC documents, confirm college/company admission, and submit file to partner banks."}
                    </span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-6 flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
        <ExternalLink size={12} />
        Items marked processed or handled are safely archived and remain on the lead's history for full audit trail.
      </p>
    </div>
  )
}
