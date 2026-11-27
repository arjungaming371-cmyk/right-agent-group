"use client"
import React, { useCallback, useEffect, useState, useMemo } from "react"
import {
  BellRing,
  Calendar,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Filter,
  Layers,
  LayoutGrid,
  List,
  MapPin,
  MessageCircle,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  UserCheck,
  X,
  AlertTriangle,
  FileText,
  DollarSign,
  ShieldCheck,
  ArrowUpDown,
  CheckSquare,
  Square
} from "lucide-react"
import { SkeletonList } from "../ui/skeleton"
import { usePolling } from "@/lib/use-poll"

// PROFESSIONAL CRM HUMAN ACTION CENTER
// Consolidated lead records, compact cards, dense table view,
// structured AI summaries, right-side detail drawer, search, filters & pagination.

export type PriorityLevel = "critical" | "high" | "medium" | "low"

export type TaskType =
  | "loan_confirmed"
  | "branch_visit"
  | "proposed_visit"
  | "callback"
  | "interested_lead"
  | "escalation"

export interface ActionTask {
  id: string
  raw_id: string
  type: TaskType
  title: string
  status: string
  due_at?: string | null
  created_at: string
  source: string
  source_id: string
  notes?: string | null
  raw_quote?: string | null
  location?: string | null
  channel?: string | null
  confidence?: string
  is_overdue?: boolean
}

export interface TimelineEntry {
  id: string
  channel: "phone" | "whatsapp"
  direction: "inbound" | "outbound"
  timestamp: string
  title: string
  summary: string
  sentiment?: "positive" | "neutral" | "negative" | "frustrated"
  language?: string
  recording_url?: string
}

export interface ActionCenterLead {
  id: string
  lead_id: string | null
  lead_name: string
  lead_phone: string | null
  lead_whatsapp: string | null
  lead_status: string
  city: string | null
  category: TaskType
  priority: PriorityLevel
  tasks: ActionTask[]
  financial: {
    product_interest?: string
    loan_amount?: number | string
    monthly_income?: number | string
    employment_type?: string
    city?: string
  }
  concerns: string[]
  recommended_actions: string[]
  timeline: TimelineEntry[]
  ai_analysis: {
    summary?: string
  }
  created_at: string
  updated_at: string
  summary: string
  full_description: string
}

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
type ViewMode = "cards" | "table"
type CategoryFilter = "all" | "loan_confirmed" | "branch_visit" | "proposed_visit" | "callback" | "escalation" | "interested_lead"
type SortField = "priority" | "newest" | "due_at" | "loan_amount"

function formatCurrency(val?: number | string | null): string {
  if (!val) return "Flexible"
  const n = Number(val)
  if (isNaN(n)) return String(val)
  return `₹${n.toLocaleString("en-IN")}`
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function formatAppointmentTime(dateStr?: string | null): string {
  if (!dateStr) return "Tentative / Unscheduled"
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return "Tentative"
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

const PRIORITY_CONFIG: Record<PriorityLevel, { label: string; bg: string; border: string; text: string; dot: string }> = {
  critical: {
    label: "CRITICAL",
    bg: "rgba(239,68,68,0.14)",
    border: "rgba(239,68,68,0.35)",
    text: "#ef4444",
    dot: "bg-red-500",
  },
  high: {
    label: "HIGH",
    bg: "rgba(245,158,11,0.14)",
    border: "rgba(245,158,11,0.35)",
    text: "#f59e0b",
    dot: "bg-amber-500",
  },
  medium: {
    label: "MEDIUM",
    bg: "rgba(59,130,246,0.14)",
    border: "rgba(59,130,246,0.35)",
    text: "#3b82f6",
    dot: "bg-blue-500",
  },
  low: {
    label: "LOW",
    bg: "rgba(107,114,128,0.14)",
    border: "rgba(107,114,128,0.35)",
    text: "#9ca3af",
    dot: "bg-gray-400",
  },
}

const TASK_BADGE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  loan_confirmed: { label: "Loan Confirmed", bg: "rgba(16,185,129,0.16)", text: "#10b981" },
  branch_visit: { label: "Confirmed Visit", bg: "rgba(168,85,247,0.16)", text: "#c084fc" },
  proposed_visit: { label: "Proposed Visit", bg: "rgba(99,102,241,0.16)", text: "#818cf8" },
  callback: { label: "Callback Due", bg: "rgba(59,130,246,0.16)", text: "#60a5fa" },
  interested_lead: { label: "Interested Lead", bg: "rgba(20,184,166,0.16)", text: "#2dd4bf" },
  escalation: { label: "Escalation", bg: "rgba(244,63,94,0.16)", text: "#fb7185" },
}

export default function AttentionView({ role }: { role: Role }) {
  const [leads, setLeads] = useState<ActionCenterLead[] | null>(null)
  const [counts, setCounts] = useState<any>({ all: 0, loans: 0, visits: 0, proposed_visits: 0, callbacks: 0, escalations: 0, interested: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters & State
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<CategoryFilter>("all")
  const [priority, setPriority] = useState<string>("all")
  const [channel, setChannel] = useState<string>("all")
  const [sortField, setSortField] = useState<SortField>("priority")
  const [viewMode, setViewMode] = useState<ViewMode>("cards")

  // Pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Detail Drawer & Resolution State
  const [selectedLead, setSelectedLead] = useState<ActionCenterLead | null>(null)
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set())
  const [resolvingLead, setResolvingLead] = useState<ActionCenterLead | null>(null)
  const [isBulkResolving, setIsBulkResolving] = useState(false)
  const [resolutionNotes, setResolutionNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeDrawerTab, setActiveDrawerTab] = useState<"overview" | "timeline" | "ai">("overview")

  // Load Data
  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch("/api/escalations")
      if (!res.ok) throw new Error("failed")
      const d = await res.json()
      setLeads(Array.isArray(d.items) ? d.items : [])
      if (d.counts) setCounts(d.counts)
    } catch {
      setError("Could not load action items. Reconnecting...")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  usePolling(load, 12000)

  // Filter & Sort Logic
  const filteredLeads = useMemo(() => {
    if (!leads) return []
    let result = [...leads]

    // 1. Text Search
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(l =>
        (l.lead_name || "").toLowerCase().includes(q) ||
        (l.lead_phone || "").includes(q) ||
        (l.city || "").toLowerCase().includes(q) ||
        (l.financial.product_interest || "").toLowerCase().includes(q) ||
        (l.summary || "").toLowerCase().includes(q) ||
        l.concerns.some(c => c.toLowerCase().includes(q))
      )
    }

    // 2. Category Filter
    if (category !== "all") {
      result = result.filter(l =>
        l.category === category || l.tasks.some(t => t.type === category)
      )
    }

    // 3. Priority Filter
    if (priority !== "all") {
      result = result.filter(l => l.priority === priority)
    }

    // 4. Channel Filter
    if (channel !== "all") {
      result = result.filter(l => {
        if (channel === "phone") return l.timeline.some(t => t.channel === "phone") || l.tasks.some(t => t.channel === "phone")
        if (channel === "whatsapp") return l.timeline.some(t => t.channel === "whatsapp") || l.tasks.some(t => t.channel === "whatsapp_text")
        return true
      })
    }

    // 5. Sorting
    const pOrder: Record<PriorityLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    result.sort((a, b) => {
      if (sortField === "priority") {
        const pDiff = (pOrder[a.priority] ?? 2) - (pOrder[b.priority] ?? 2)
        if (pDiff !== 0) return pDiff
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      if (sortField === "newest") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      if (sortField === "due_at") {
        const aDue = a.tasks.find(t => t.due_at)?.due_at
        const bDue = b.tasks.find(t => t.due_at)?.due_at
        if (!aDue && !bDue) return 0
        if (!aDue) return 1
        if (!bDue) return -1
        return new Date(aDue).getTime() - new Date(bDue).getTime()
      }
      if (sortField === "loan_amount") {
        const aAmt = Number(a.financial.loan_amount || 0)
        const bAmt = Number(b.financial.loan_amount || 0)
        return bAmt - aAmt
      }
      return 0
    })

    return result
  }, [leads, search, category, priority, channel, sortField])

  // Pagination slice
  const totalPages = Math.ceil(filteredLeads.length / pageSize) || 1
  const paginatedLeads = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredLeads.slice(start, start + pageSize)
  }, [filteredLeads, page, pageSize])

  // Selection for Bulk Actions
  const toggleSelectAll = () => {
    if (selectedLeadIds.size === paginatedLeads.length) {
      setSelectedLeadIds(new Set())
    } else {
      setSelectedLeadIds(new Set(paginatedLeads.map(l => l.id)))
    }
  }

  const toggleSelectLead = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(selectedLeadIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedLeadIds(next)
  }

  // Resolve Single or Bulk Action
  async function handleResolveSubmit() {
    const notes = resolutionNotes.trim()
    if (!notes) return
    setIsSubmitting(true)

    const idsToResolve = isBulkResolving
      ? Array.from(selectedLeadIds)
      : resolvingLead ? [resolvingLead.id] : []

    try {
      const res = await fetch("/api/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bulkIds: idsToResolve,
          notes,
        }),
      })

      if (res.ok) {
        setLeads(prev => (prev ? prev.filter(l => !idsToResolve.includes(l.id)) : prev))
        setSelectedLeadIds(new Set())
        setResolvingLead(null)
        setIsBulkResolving(false)
        setResolutionNotes("")
        if (selectedLead && idsToResolve.includes(selectedLead.id)) {
          setSelectedLead(null)
        }
      } else {
        setError("Could not resolve item(s). Please try again.")
      }
    } catch {
      setError("Network error while resolving item.")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Navigation to WhatsApp Chat
  function openWhatsAppChat(leadId: string | null) {
    if (!leadId || typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent("rag:lead-focus", { detail: { leadId, view: "whatsapp" } }))
    window.dispatchEvent(new CustomEvent("rag:navigate", { detail: { view: "whatsapp" } }))
  }

  // Export to CSV
  function exportToCsv() {
    if (filteredLeads.length === 0) return
    const headers = ["Lead Name", "Phone", "Status", "Priority", "Product", "Loan Amount", "City", "Tasks Count", "Summary", "Created At"]
    const rows = filteredLeads.map(l => [
      `"${l.lead_name || ""}"`,
      `"${l.lead_phone || ""}"`,
      `"${l.lead_status || ""}"`,
      `"${l.priority}"`,
      `"${l.financial.product_interest || ""}"`,
      `"${l.financial.loan_amount || ""}"`,
      `"${l.city || ""}"`,
      l.tasks.length,
      `"${(l.summary || "").replace(/"/g, '""')}"`,
      `"${l.created_at}"`,
    ])

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n")
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `Action_Center_Leads_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="relative min-h-[calc(100vh-80px)] pb-16">
      {/* 1. Header & KPI Action Bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[20px] font-bold text-[var(--text-primary)] tracking-tight">
              CRM Human Action Center
            </h1>
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2.5 py-0.5 text-[11px] font-bold text-red-400">
              <BellRing size={12} className="animate-pulse" />
              {counts.all || 0} Leads Need Action
            </span>
            {counts.critical > 0 && (
              <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10.5px] font-semibold text-amber-300">
                {counts.critical} Critical
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
            Consolidated CRM dispatch: confirmed loans, scheduled branch visits, callbacks, and customer escalations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportToCsv}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition shadow-sm"
          >
            <Download size={13} /> Export CSV
          </button>
          <button
            onClick={load}
            disabled={isLoading}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {/* 2. KPI Summary Metrics */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <div
          onClick={() => { setCategory("all"); setPage(1) }}
          className={`cursor-pointer rounded-xl border p-3 transition ${
            category === "all" ? "border-amber-500/60 bg-amber-500/10 shadow-sm" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
          }`}
        >
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">All Leads</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[20px] font-bold text-[var(--text-primary)]">{counts.all || 0}</span>
            <Layers size={14} className="text-amber-400" />
          </div>
        </div>

        <div
          onClick={() => { setCategory("loan_confirmed"); setPage(1) }}
          className={`cursor-pointer rounded-xl border p-3 transition ${
            category === "loan_confirmed" ? "border-emerald-500/60 bg-emerald-500/10 shadow-sm" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
          }`}
        >
          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">Confirmed Loans</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[20px] font-bold text-emerald-400">{counts.loans || 0}</span>
            <DollarSign size={14} className="text-emerald-400" />
          </div>
        </div>

        <div
          onClick={() => { setCategory("branch_visit"); setPage(1) }}
          className={`cursor-pointer rounded-xl border p-3 transition ${
            category === "branch_visit" ? "border-purple-500/60 bg-purple-500/10 shadow-sm" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
          }`}
        >
          <div className="text-[11px] font-semibold text-purple-400 uppercase tracking-wider">Confirmed Visits</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[20px] font-bold text-purple-300">{counts.visits || 0}</span>
            <Calendar size={14} className="text-purple-400" />
          </div>
        </div>

        <div
          onClick={() => { setCategory("proposed_visit"); setPage(1) }}
          className={`cursor-pointer rounded-xl border p-3 transition ${
            category === "proposed_visit" ? "border-indigo-500/60 bg-indigo-500/10 shadow-sm" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
          }`}
        >
          <div className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider">Proposed Visits</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[20px] font-bold text-indigo-300">{counts.proposed_visits || 0}</span>
            <MapPin size={14} className="text-indigo-400" />
          </div>
        </div>

        <div
          onClick={() => { setCategory("callback"); setPage(1) }}
          className={`cursor-pointer rounded-xl border p-3 transition ${
            category === "callback" ? "border-blue-500/60 bg-blue-500/10 shadow-sm" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
          }`}
        >
          <div className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider">Callbacks Due</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[20px] font-bold text-blue-300">{counts.callbacks || 0}</span>
            <PhoneCall size={14} className="text-blue-400" />
          </div>
        </div>

        <div
          onClick={() => { setCategory("escalation"); setPage(1) }}
          className={`cursor-pointer rounded-xl border p-3 transition ${
            category === "escalation" ? "border-rose-500/60 bg-rose-500/10 shadow-sm" : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
          }`}
        >
          <div className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider">Escalations</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[20px] font-bold text-rose-400">{counts.escalations || 0}</span>
            <AlertTriangle size={14} className="text-rose-400" />
          </div>
        </div>
      </div>

      {/* 3. Search & Control Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 shadow-sm">
        <div className="flex flex-1 flex-wrap items-center gap-2.5 min-w-[280px]">
          {/* Instant Search Input */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search by lead name, phone, city, or loan amount..."
              className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] pl-8 pr-7 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Priority Dropdown */}
          <select
            value={priority}
            onChange={e => { setPriority(e.target.value); setPage(1) }}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] focus:outline-none focus:border-amber-500 transition cursor-pointer"
          >
            <option value="all">All Priorities</option>
            <option value="critical">🔴 Critical Priority</option>
            <option value="high">🟠 High Priority</option>
            <option value="medium">🔵 Medium Priority</option>
            <option value="low">⚪ Low Priority</option>
          </select>

          {/* Channel Dropdown */}
          <select
            value={channel}
            onChange={e => { setChannel(e.target.value); setPage(1) }}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] focus:outline-none focus:border-amber-500 transition cursor-pointer"
          >
            <option value="all">All Channels</option>
            <option value="phone">📞 Phone / Voice</option>
            <option value="whatsapp">💬 WhatsApp</option>
          </select>

          {/* Sort Dropdown */}
          <select
            value={sortField}
            onChange={e => setSortField(e.target.value as SortField)}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] focus:outline-none focus:border-amber-500 transition cursor-pointer"
          >
            <option value="priority">Sort by Priority (Highest First)</option>
            <option value="due_at">Sort by Scheduled Due Date</option>
            <option value="loan_amount">Sort by Highest Loan Amount</option>
            <option value="newest">Sort by Newest Created</option>
          </select>
        </div>

        {/* View Switcher: Cards vs Table */}
        <div className="flex items-center gap-1.5 border-l border-[var(--border)] pl-3">
          <button
            onClick={() => setViewMode("cards")}
            title="Card View"
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
              viewMode === "cards"
                ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            onClick={() => setViewMode("table")}
            title="Table View"
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
              viewMode === "table"
                ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <List size={15} />
          </button>
        </div>
      </div>

      {/* 4. Bulk Action Floating Bar */}
      {selectedLeadIds.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-gradient-to-r from-amber-500/20 via-blue-500/20 to-emerald-500/20 border border-amber-500/40 p-3 shadow-md animate-in fade-in duration-150">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--text-primary)]">
            <CheckSquare size={16} className="text-amber-400" />
            <span>{selectedLeadIds.size} lead(s) selected</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsBulkResolving(true)
                setResolvingLead(null)
                setResolutionNotes("")
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-500 transition shadow-sm"
            >
              <CheckCheck size={13} /> Mark Selected as Resolved
            </button>
            <button
              onClick={() => setSelectedLeadIds(new Set())}
              className="flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-[12.5px] text-amber-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={load} className="underline text-[11.5px] font-semibold hover:text-white">Retry</button>
        </div>
      )}

      {/* 5. Main Content: Skeletons or Empty or Leads (Cards / Table) */}
      {isLoading && leads === null ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
          <SkeletonList rows={5} />
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-12 text-center shadow-sm">
          <CheckCheck size={32} className="mx-auto mb-3 text-emerald-400" />
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">All Clear — No Human Actions Pending</h3>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-[var(--text-secondary)]">
            Every loan application, appointment, and callback has been addressed. When Priya detects customer interest or escalation, it appears here automatically.
          </p>
        </div>
      ) : viewMode === "cards" ? (
        /* CARD VIEW: Compact, Modern Grid */
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {paginatedLeads.map(lead => {
            const priorityConfig = PRIORITY_CONFIG[lead.priority] || PRIORITY_CONFIG.medium
            const isSelected = selectedLeadIds.has(lead.id)

            return (
              <div
                key={lead.id}
                onClick={() => setSelectedLead(lead)}
                className={`group relative flex flex-col justify-between rounded-xl border bg-[var(--bg-card)] p-4 transition-all duration-150 cursor-pointer hover:shadow-lg hover:-translate-y-0.5 ${
                  isSelected
                    ? "border-amber-500/80 ring-1 ring-amber-500/80 bg-amber-500/[0.03]"
                    : "border-[var(--border)] hover:border-[var(--border-hover)]"
                }`}
              >
                {/* Top Lead Info Line */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={e => toggleSelectLead(lead.id, e)}
                        className="text-[var(--text-muted)] hover:text-amber-400 transition"
                      >
                        {isSelected ? <CheckSquare size={16} className="text-amber-400" /> : <Square size={16} />}
                      </button>
                      <div>
                        <h4 className="text-[14px] font-bold text-[var(--text-primary)] leading-tight group-hover:text-amber-400 transition">
                          {lead.lead_name}
                        </h4>
                        <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-[var(--text-secondary)] font-mono">
                          <span>{lead.lead_phone || "No phone"}</span>
                          {lead.city && (
                            <span className="flex items-center gap-0.5 text-[11px] text-[var(--text-muted)] font-sans">
                              <MapPin size={10} /> {lead.city}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span
                        className="rounded-md px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider"
                        style={{
                          background: priorityConfig.bg,
                          color: priorityConfig.text,
                          border: `1px solid ${priorityConfig.border}`,
                        }}
                      >
                        {priorityConfig.label}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {timeAgo(lead.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Financial Snapshot Tag */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                      {formatCurrency(lead.financial.loan_amount)}
                    </span>
                    <span className="rounded-md bg-[var(--overlay-soft)] border border-[var(--border)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-primary)] uppercase">
                      {lead.financial.product_interest || "LOAN"}
                    </span>
                  </div>

                  {/* Active Tasks Badges */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {lead.tasks.map(t => {
                      const cfg = TASK_BADGE_CONFIG[t.type] || TASK_BADGE_CONFIG.callback
                      return (
                        <span
                          key={t.id}
                          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
                          style={{ background: cfg.bg, color: cfg.text }}
                        >
                          {t.type === "branch_visit" && <Calendar size={10} />}
                          {t.type === "callback" && <PhoneCall size={10} />}
                          {t.type === "loan_confirmed" && <DollarSign size={10} />}
                          {t.title}
                          {t.due_at && ` • ${formatAppointmentTime(t.due_at)}`}
                        </span>
                      )
                    })}
                  </div>

                  {/* Concise Structured AI Summary */}
                  <p className="mt-2.5 text-[12px] text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                    {lead.summary}
                  </p>

                  {/* Detected Concerns Pills */}
                  {lead.concerns.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {lead.concerns.slice(0, 3).map((c, i) => (
                        <span key={i} className="rounded-full bg-red-500/10 border border-red-500/25 px-2 py-px text-[10px] font-medium text-red-300">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Card Action Footer */}
                <div className="mt-3.5 flex items-center justify-between border-t border-[var(--border)] pt-2.5">
                  <div className="flex items-center gap-1">
                    {lead.lead_phone && (
                      <a
                        href={`tel:${lead.lead_phone}`}
                        onClick={e => e.stopPropagation()}
                        title="Direct Call"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-emerald-400 hover:border-emerald-500/40 transition"
                      >
                        <Phone size={12} />
                      </a>
                    )}
                    {lead.lead_id && (
                      <button
                        onClick={e => { e.stopPropagation(); openWhatsAppChat(lead.lead_id) }}
                        title="Open WhatsApp Chat"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/40 transition"
                      >
                        <MessageCircle size={12} />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setResolvingLead(lead)
                        setIsBulkResolving(false)
                        setResolutionNotes("")
                      }}
                      className="flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:text-emerald-400 hover:border-emerald-500/40 transition"
                    >
                      <CheckCheck size={12} /> Resolve
                    </button>
                    <button
                      onClick={() => setSelectedLead(lead)}
                      className="flex h-7 items-center gap-1 rounded-lg bg-[var(--overlay-soft)] border border-[var(--border)] px-2 text-[11px] font-semibold text-[var(--text-primary)] hover:border-amber-500/40 transition"
                    >
                      Details &gt;
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* TABLE VIEW: Professional Dense CRM View */
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-surface)] text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="py-3 pl-4 pr-2 w-10">
                    <button onClick={toggleSelectAll} className="hover:text-amber-400">
                      {selectedLeadIds.size > 0 && selectedLeadIds.size === paginatedLeads.length ? (
                        <CheckSquare size={15} className="text-amber-400" />
                      ) : (
                        <Square size={15} />
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-3">Priority</th>
                  <th className="py-3 px-3">Lead & Contact</th>
                  <th className="py-3 px-3">Financial Requirement</th>
                  <th className="py-3 px-3">Active Tasks</th>
                  <th className="py-3 px-3">Key Concerns</th>
                  <th className="py-3 px-3">Timeline</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {paginatedLeads.map(lead => {
                  const priorityConfig = PRIORITY_CONFIG[lead.priority] || PRIORITY_CONFIG.medium
                  const isSelected = selectedLeadIds.has(lead.id)

                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className={`hover:bg-[var(--overlay-soft)] cursor-pointer transition ${
                        isSelected ? "bg-amber-500/[0.04]" : ""
                      }`}
                    >
                      <td className="py-3 pl-4 pr-2" onClick={e => e.stopPropagation()}>
                        <button onClick={e => toggleSelectLead(lead.id, e)} className="hover:text-amber-400">
                          {isSelected ? <CheckSquare size={15} className="text-amber-400" /> : <Square size={15} />}
                        </button>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className="rounded-md px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider"
                          style={{
                            background: priorityConfig.bg,
                            color: priorityConfig.text,
                            border: `1px solid ${priorityConfig.border}`,
                          }}
                        >
                          {priorityConfig.label}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-[var(--text-primary)] hover:text-amber-400 transition">
                          {lead.lead_name}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] font-mono">
                          {lead.lead_phone}
                          {lead.city && <span className="ml-1 text-[var(--text-muted)] font-sans">• {lead.city}</span>}
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-bold text-emerald-400">
                          {formatCurrency(lead.financial.loan_amount)}
                        </div>
                        <div className="text-[10.5px] text-[var(--text-muted)] uppercase">
                          {lead.financial.product_interest || "LOAN"}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1 max-w-[240px]">
                          {lead.tasks.map(t => {
                            const cfg = TASK_BADGE_CONFIG[t.type] || TASK_BADGE_CONFIG.callback
                            return (
                              <span
                                key={t.id}
                                className="rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                                style={{ background: cfg.bg, color: cfg.text }}
                              >
                                {t.title}
                              </span>
                            )
                          })}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        {lead.concerns.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {lead.concerns.slice(0, 2).map((c, i) => (
                              <span key={i} className="rounded-full bg-red-500/10 border border-red-500/25 px-1.5 py-px text-[9.5px] font-medium text-red-300">
                                {c}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] text-[var(--text-muted)]">—</span>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap text-[11px] text-[var(--text-muted)]">
                        <div className="flex items-center gap-1">
                          <Clock size={11} /> {timeAgo(lead.created_at)}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)]">
                          {lead.timeline.length} interactions
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {lead.lead_phone && (
                            <a
                              href={`tel:${lead.lead_phone}`}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-emerald-400 transition"
                              title="Direct Phone Call"
                            >
                              <Phone size={12} />
                            </a>
                          )}
                          {lead.lead_id && (
                            <button
                              onClick={() => openWhatsAppChat(lead.lead_id)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-blue-400 transition"
                              title="Open WhatsApp Chat"
                            >
                              <MessageCircle size={12} />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setResolvingLead(lead)
                              setIsBulkResolving(false)
                              setResolutionNotes("")
                            }}
                            className="flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:text-emerald-400 hover:border-emerald-500/40 transition"
                          >
                            <CheckCheck size={12} /> Resolve
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. Scalable Pagination Bar (Works for 100, 1,000, 10,000 Leads) */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[12px] text-[var(--text-secondary)]">
        <div className="flex items-center gap-2">
          <span>
            Showing <strong className="text-[var(--text-primary)]">{(page - 1) * pageSize + 1}</strong> to{" "}
            <strong className="text-[var(--text-primary)]">{Math.min(page * pageSize, filteredLeads.length)}</strong> of{" "}
            <strong className="text-[var(--text-primary)]">{filteredLeads.length}</strong> leads
          </span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
            className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-[11.5px] text-[var(--text-primary)] focus:outline-none"
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2.5 text-[11.5px] font-medium disabled:opacity-40 hover:bg-[var(--overlay-soft)] transition"
          >
            <ChevronLeft size={13} /> Prev
          </button>
          <span className="px-2 text-[11.5px] font-semibold text-[var(--text-primary)]">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2.5 text-[11.5px] font-medium disabled:opacity-40 hover:bg-[var(--overlay-soft)] transition"
          >
            Next <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* 7. EXPANDABLE RIGHT-SIDE DETAIL DRAWER PANEL */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className="relative h-full w-full max-w-xl bg-[var(--bg-card)] border-l border-[var(--border)] shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="border-b border-[var(--border)] p-4 flex items-start justify-between bg-[var(--bg-surface)]">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[17px] font-bold text-[var(--text-primary)]">
                    {selectedLead.lead_name}
                  </h3>
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      background: PRIORITY_CONFIG[selectedLead.priority].bg,
                      color: PRIORITY_CONFIG[selectedLead.priority].text,
                      border: `1px solid ${PRIORITY_CONFIG[selectedLead.priority].border}`,
                    }}
                  >
                    {PRIORITY_CONFIG[selectedLead.priority].label}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2.5 text-[12px] text-[var(--text-secondary)] font-mono">
                  <span>{selectedLead.lead_phone}</span>
                  {selectedLead.city && (
                    <span className="flex items-center gap-0.5 text-[11.5px] text-[var(--text-muted)] font-sans">
                      <MapPin size={11} /> {selectedLead.city}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => setSelectedLead(null)}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-soft)] transition"
              >
                <X size={15} />
              </button>
            </div>

            {/* Drawer Tabs */}
            <div className="flex border-b border-[var(--border)] px-4 bg-[var(--bg-surface)] text-[12px] font-semibold">
              <button
                onClick={() => setActiveDrawerTab("overview")}
                className={`py-2.5 px-3 border-b-2 transition ${
                  activeDrawerTab === "overview"
                    ? "border-amber-400 text-amber-400"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Action Plan & Financials
              </button>
              <button
                onClick={() => setActiveDrawerTab("timeline")}
                className={`py-2.5 px-3 border-b-2 transition ${
                  activeDrawerTab === "timeline"
                    ? "border-amber-400 text-amber-400"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Interaction Timeline ({selectedLead.timeline.length})
              </button>
              <button
                onClick={() => setActiveDrawerTab("ai")}
                className={`py-2.5 px-3 border-b-2 transition ${
                  activeDrawerTab === "ai"
                    ? "border-amber-400 text-amber-400"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                AI Memory & Analysis
              </button>
            </div>

            {/* Drawer Tab Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {activeDrawerTab === "overview" && (
                <>
                  {/* Financial Snapshot */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3.5">
                    <h5 className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                      <DollarSign size={13} className="text-emerald-400" /> Financial Profile
                    </h5>
                    <div className="grid grid-cols-2 gap-3 text-[12.5px]">
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)]">Loan Requirement</div>
                        <div className="text-[14px] font-bold text-emerald-400">
                          {formatCurrency(selectedLead.financial.loan_amount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)]">Product Type</div>
                        <div className="font-semibold text-[var(--text-primary)] uppercase">
                          {selectedLead.financial.product_interest || "Personal Loan"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)]">Monthly Income</div>
                        <div className="font-semibold text-[var(--text-primary)]">
                          {formatCurrency(selectedLead.financial.monthly_income)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)]">Employment Profile</div>
                        <div className="font-semibold text-[var(--text-primary)] capitalize">
                          {selectedLead.financial.employment_type || "Salaried"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Active Actionable Tasks */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3.5">
                    <h5 className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Calendar size={13} className="text-blue-400" /> Active Tasks for This Lead
                    </h5>
                    <div className="space-y-2">
                      {selectedLead.tasks.map(t => (
                        <div key={t.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[12.5px] text-[var(--text-primary)]">{t.title}</span>
                            <span className="text-[10.5px] font-semibold text-blue-400 uppercase">{t.status}</span>
                          </div>
                          {t.due_at && (
                            <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-300">
                              <Clock size={11} /> Scheduled Time: {formatAppointmentTime(t.due_at)}
                            </div>
                          )}
                          {t.raw_quote && (
                            <p className="mt-1.5 text-[11.5px] text-[var(--text-secondary)] italic">
                              "{t.raw_quote}"
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Customer Concerns & Objections */}
                  {selectedLead.concerns.length > 0 && (
                    <div className="rounded-xl border border-red-500/25 bg-red-500/[0.04] p-3.5">
                      <h5 className="text-[12px] font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <AlertTriangle size={13} /> Customer Objections & Concerns
                      </h5>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedLead.concerns.map((c, i) => (
                          <span key={i} className="rounded-md bg-red-500/15 border border-red-500/30 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommended Action Plan */}
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-3.5">
                    <h5 className="text-[12px] font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <TrendingUp size={13} /> Recommended Next Action Plan
                    </h5>
                    <ul className="space-y-1.5 text-[12px] text-[var(--text-primary)]">
                      {selectedLead.recommended_actions.map((act, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-400 mt-0.5">
                            {i + 1}
                          </span>
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              {activeDrawerTab === "timeline" && (
                <div className="space-y-3">
                  {selectedLead.timeline.length === 0 ? (
                    <p className="text-[12px] text-[var(--text-muted)] text-center py-6">No previous interactions logged yet.</p>
                  ) : (
                    selectedLead.timeline.map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                        <div className="flex items-center justify-between text-[11.5px]">
                          <span className="flex items-center gap-1.5 font-bold text-[var(--text-primary)]">
                            {entry.channel === "phone" ? <Phone size={12} className="text-emerald-400" /> : <MessageCircle size={12} className="text-blue-400" />}
                            {entry.title}
                          </span>
                          <span className="text-[10.5px] text-[var(--text-muted)]">{timeAgo(entry.timestamp)}</span>
                        </div>
                        <p className="mt-1.5 text-[12px] text-[var(--text-secondary)] leading-relaxed">
                          {entry.summary}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeDrawerTab === "ai" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3.5">
                    <h5 className="text-[12px] font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <ShieldCheck size={13} /> Lead Brain Memory Summary
                    </h5>
                    <p className="text-[12.5px] text-[var(--text-primary)] leading-relaxed">
                      {selectedLead.ai_analysis.summary || selectedLead.full_description || "Lead memory analyzed by autonomous engine."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Drawer Footer Actions */}
            <div className="border-t border-[var(--border)] p-4 flex items-center justify-between bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                {selectedLead.lead_phone && (
                  <a
                    href={`tel:${selectedLead.lead_phone}`}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-[12px] font-semibold text-[var(--text-primary)] hover:text-emerald-400 transition"
                  >
                    <Phone size={13} /> Call
                  </a>
                )}
                {selectedLead.lead_id && (
                  <button
                    onClick={() => openWhatsAppChat(selectedLead.lead_id)}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-[12px] font-semibold text-[var(--text-primary)] hover:text-blue-400 transition"
                  >
                    <MessageCircle size={13} /> WhatsApp
                  </button>
                )}
              </div>

              <button
                onClick={() => {
                  setResolvingLead(selectedLead)
                  setIsBulkResolving(false)
                  setResolutionNotes("")
                }}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-[12.5px] font-semibold text-white hover:bg-emerald-500 transition shadow-sm"
              >
                <CheckCheck size={14} /> Resolve Lead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. RESOLUTION MODAL DIALOG (Single or Bulk) */}
      {(resolvingLead || isBulkResolving) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <CheckCheck size={18} className="text-emerald-400" />
                <h3 className="text-[15px] font-bold text-[var(--text-primary)]">
                  {isBulkResolving ? `Resolve ${selectedLeadIds.size} Selected Leads` : "Resolve & Archive Action"}
                </h3>
              </div>
              <button
                onClick={() => { setResolvingLead(null); setIsBulkResolving(false); setResolutionNotes("") }}
                disabled={isSubmitting}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-[17px] leading-none transition"
              >
                ✕
              </button>
            </div>

            <div className="mt-3.5">
              {!isBulkResolving && resolvingLead && (
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="font-semibold text-[var(--text-primary)]">{resolvingLead.lead_name}</span>
                  <span className="font-mono text-[var(--text-secondary)]">{resolvingLead.lead_phone}</span>
                </div>
              )}
              <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
                Add resolution notes for the compliance audit trail. These notes will permanently save to the lead's timeline.
              </p>

              <textarea
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                placeholder="Enter what was discussed or completed (e.g. Spoke to customer, KYC verified / Appointment locked in)..."
                rows={3}
                disabled={isSubmitting}
                className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-[12.5px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 leading-relaxed resize-none transition"
                autoFocus
              />
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => { setResolvingLead(null); setIsBulkResolving(false); setResolutionNotes("") }}
                disabled={isSubmitting}
                className="h-8 rounded-lg border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--overlay-soft)] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleResolveSubmit}
                disabled={isSubmitting || !resolutionNotes.trim()}
                className="flex h-8 items-center gap-1.5 rounded-lg px-4 text-[12px] font-semibold text-white shadow-sm disabled:opacity-50 transition"
                style={{ background: "linear-gradient(135deg, #059669 0%, #10b981 100%)" }}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" /> Resolving...
                  </>
                ) : (
                  <>
                    <CheckCheck size={13} /> Confirm & Resolve
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
