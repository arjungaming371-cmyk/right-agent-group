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
  Filter
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
  lead_phone: string | null
  lead_whatsapp: string | null
  lead_status: string | null
  summary: string | null
  quote?: string | null
  action?: string | null
  loan_type?: string | null
  loan_amount?: number | string | null
  monthly_income?: number | string | null
  employment_type?: string | null
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

function parseEscalationReason(summary: string | null): { reason: string; quote: string; action: string | null } {
  const s = summary || ""
  let reason = "Needs a person"
  if (s.includes("FRUSTRATED CALLER")) reason = "Frustrated on a call"
  else if (s.includes("FRUSTRATED WHATSAPP")) reason = "Frustrated on WhatsApp"
  else if (s.includes("FRUSTRATED INSTAGRAM")) reason = "Frustrated on Instagram"
  else if (s.includes("ASKED FOR A HUMAN")) reason = "Asked for human agent"

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
    quote = s.replace(/^[🟢⚠️📞]\s*[^—]+—\s*/, "").trim()
  }

  return { reason, quote, action }
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
          <h2 className="flex flex-wrap items-center gap-2.5 text-[17px] font-bold text-[var(--text-primary)]">
            <span className="flex items-center gap-2">
              <BellRing size={18} className="text-amber-400" />
              Human Action Center
            </span>
            {counts.all > 0 && (
              <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-[11.5px] font-bold text-amber-400">
                {counts.all} waiting
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
            All leads requiring human follow-up: confirmed loan applicants, scheduled callbacks, office visits & escalations.
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
          className={`cursor-pointer rounded-xl border p-3.5 transition ${
            activeTab === "loan_confirmed"
              ? "border-emerald-500/50 bg-emerald-500/10 shadow-sm"
              : "border-[var(--border)] bg-[var(--bg-card)] hover:border-emerald-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-emerald-400 flex items-center gap-1.5">
              <Sparkles size={14} /> Confirmed Loans
            </span>
            <span className="text-[18px] font-bold text-[var(--text-primary)]">{counts.loans}</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Agreed on call or submitted form — ready to process</p>
        </div>

        <div
          onClick={() => setActiveTab("calendar")}
          className={`cursor-pointer rounded-xl border p-3.5 transition ${
            activeTab === "calendar"
              ? "border-blue-500/50 bg-blue-500/10 shadow-sm"
              : "border-[var(--border)] bg-[var(--bg-card)] hover:border-blue-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-blue-400 flex items-center gap-1.5">
              <CalendarClock size={14} /> Callbacks & Visits
            </span>
            <span className="text-[18px] font-bold text-[var(--text-primary)]">{counts.callbacks}</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Scheduled phone callbacks & office appointments</p>
        </div>

        <div
          onClick={() => setActiveTab("escalation")}
          className={`cursor-pointer rounded-xl border p-3.5 transition ${
            activeTab === "escalation"
              ? "border-rose-500/50 bg-rose-500/10 shadow-sm"
              : "border-[var(--border)] bg-[var(--bg-card)] hover:border-rose-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-rose-400 flex items-center gap-1.5">
              <AlertTriangle size={14} /> Escalations
            </span>
            <span className="text-[18px] font-bold text-[var(--text-primary)]">{counts.escalations}</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Callers who asked for a human or had frustration</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-2.5">
        <button
          onClick={() => setActiveTab("all")}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
            activeTab === "all"
              ? "bg-[var(--accent-blue)] text-white shadow-sm"
              : "text-[var(--text-secondary)] hover:bg-[var(--overlay-soft)]"
          }`}
        >
          All Items ({counts.all})
        </button>
        <button
          onClick={() => setActiveTab("loan_confirmed")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
            activeTab === "loan_confirmed"
              ? "bg-emerald-600 text-white shadow-sm"
              : "text-emerald-400 hover:bg-emerald-500/10"
          }`}
        >
          <Sparkles size={13} /> Confirmed Loans ({counts.loans})
        </button>
        <button
          onClick={() => setActiveTab("calendar")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
            activeTab === "calendar"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-blue-400 hover:bg-blue-500/10"
          }`}
        >
          <CalendarClock size={13} /> Callbacks & Visits ({counts.callbacks})
        </button>
        <button
          onClick={() => setActiveTab("escalation")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
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
          <div className="text-[14px] font-semibold text-[var(--text-primary)]">
            {activeTab === "all"
              ? "All clear — zero pending human tasks!"
              : activeTab === "loan_confirmed"
              ? "No pending confirmed loans right now."
              : activeTab === "calendar"
              ? "No scheduled callbacks or visits pending."
              : "No active escalations."}
          </div>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-[var(--text-secondary)]">
            When Priya confirms a loan with a customer, schedules a callback, or detects escalation, it will appear here automatically.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {filteredItems.map(item => {
            const isLoan = item.category === "loan_confirmed"
            const isVisit = item.category === "branch_visit"
            const isCallback = item.category === "callback"
            const isEscalation = item.category === "escalation"
            const timing = item.event_at ? formatEventTiming(item.event_at) : null
            const esc = isEscalation ? parseEscalationReason(item.summary) : null

            return (
              <li
                key={item.id}
                className={`rounded-xl border p-4 transition ${
                  isLoan
                    ? "border-emerald-500/35 bg-emerald-950/10 hover:border-emerald-500/60"
                    : timing?.isOverdue
                    ? "border-rose-500/35 bg-rose-950/10"
                    : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {/* Header Row: Lead Name + Phone + Badge */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-[var(--text-primary)]">
                        {item.lead_name || item.lead_phone || "Unknown Lead"}
                      </span>
                      {item.lead_phone && (
                        <span className="text-[12px] font-mono text-[var(--text-secondary)]">{item.lead_phone}</span>
                      )}

                      {/* Category Badge */}
                      {isLoan && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                          <Sparkles size={11} /> LOAN CONFORMED
                        </span>
                      )}
                      {isCallback && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            timing?.isOverdue
                              ? "bg-rose-500/15 border border-rose-500/30 text-rose-400"
                              : "bg-blue-500/15 border border-blue-500/30 text-blue-400"
                          }`}
                        >
                          <CalendarClock size={11} /> {timing?.badge || "CALLBACK"}
                        </span>
                      )}
                      {isVisit && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[11px] font-bold text-purple-400">
                          <Building2 size={11} /> OFFICE VISIT
                        </span>
                      )}
                      {isEscalation && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[11px] font-bold text-amber-400">
                          <AlertTriangle size={11} /> {esc?.reason || "ESCALATION"}
                        </span>
                      )}

                      {/* Lead Status */}
                      {item.lead_status && (
                        <span className="rounded-md bg-[var(--overlay-soft)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--text-secondary)]">
                          {LEAD_STATUS_LABEL[item.lead_status.toLowerCase()] || item.lead_status}
                        </span>
                      )}

                      <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] ml-auto sm:ml-0">
                        <Clock size={11} /> {timeAgo(item.created_at)}
                      </span>
                    </div>

                    {/* Loan Confirmed Details */}
                    {isLoan && (
                      <div className="mt-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-[12.5px]">
                        <div className="flex flex-wrap items-center gap-3 text-emerald-300 font-semibold">
                          <span className="flex items-center gap-1.5">
                            <Banknote size={14} className="text-emerald-400" />
                            {item.product_interest || "Loan"}: {item.loan_amount ? "₹" + Number(item.loan_amount).toLocaleString("en-IN") : "Amount Unspecified"}
                          </span>
                          {item.monthly_income && (
                            <span className="text-[11.5px] text-[var(--text-secondary)]">
                              Income: ₹{Number(item.monthly_income).toLocaleString("en-IN")}/mo
                            </span>
                          )}
                          {item.employment_type && (
                            <span className="text-[11.5px] text-[var(--text-secondary)]">
                              Type: {item.employment_type}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                          {item.summary || "Customer agreed to proceed with loan. Application sent on WhatsApp. Follow up to collect documents."}
                        </p>
                      </div>
                    )}

                    {/* Calendar Event Details */}
                    {(isCallback || isVisit) && (
                      <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--overlay-soft)] p-2.5 text-[12px]">
                        <div className="flex flex-wrap items-center gap-3 font-semibold text-[var(--text-primary)]">
                          <span className="flex items-center gap-1.5 text-blue-400">
                            <Clock size={13} /> Scheduled: {timing?.text}
                          </span>
                          {item.location && (
                            <span className="flex items-center gap-1 text-[var(--text-secondary)]">
                              <MapPin size={13} /> {item.location}
                            </span>
                          )}
                        </div>
                        {item.quote && (
                          <p className="mt-1 italic text-[var(--text-secondary)]">
                            “{item.quote}”
                          </p>
                        )}
                      </div>
                    )}

                    {/* Escalation Details */}
                    {isEscalation && (
                      <div className="mt-2 text-[12.5px]">
                        {esc?.quote && (
                          <p className="rounded-lg bg-[var(--overlay-soft)] px-2.5 py-1.5 italic text-[var(--text-secondary)]">
                            “{esc.quote.slice(0, 240)}”
                          </p>
                        )}
                        {esc?.action && (
                          <p className="mt-1 flex items-center gap-1 text-[11.5px] text-emerald-400">
                            <CheckCircle2 size={12} /> Suggested action: {esc.action}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 mt-1 sm:mt-0">
                    {canCall && item.lead_id && (
                      <button
                        onClick={() => callLead(item.lead_id)}
                        disabled={busyId === item.id || busyId === item.lead_id}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] disabled:opacity-50 transition"
                      >
                        <Phone size={13} /> Call
                      </button>
                    )}
                    {item.lead_id && (
                      <button
                        onClick={() => openChat(item.lead_id)}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition"
                      >
                        <MessageCircle size={13} /> Open Chat
                      </button>
                    )}
                    <button
                      onClick={() => resolve(item)}
                      disabled={busyId === item.id}
                      className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-white shadow-sm disabled:opacity-50 transition"
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
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-5 flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
        <ExternalLink size={12} />
        Items marked handled or resolved are safely archived and remain on the lead's history for full audit trail.
      </p>
    </div>
  )
}
