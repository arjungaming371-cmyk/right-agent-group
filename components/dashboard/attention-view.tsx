"use client"
import React, { useCallback, useEffect, useState, useMemo } from "react"
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Filter,
  MapPin,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  ShieldCheck,
  FileText,
  AlertTriangle,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { SkeletonList } from "../ui/skeleton"
import { usePolling } from "@/lib/use-poll"

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

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
    facts?: Record<string, any>
  }
  created_at: string
  updated_at: string
  summary: string
  full_description: string
}

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
type CategoryFilter = "all" | "loan_confirmed" | "branch_visit" | "proposed_visit" | "callback" | "escalation" | "interested_lead"
type SortField = "priority" | "newest" | "due_at" | "loan_amount"

// ─────────────────────────────────────────────────────────────────────────────
// OBJECT-ORIENTED DOMAIN MODEL: LeadIntelligenceProfile
// Encapsulates entity parsing, classification rules, and intelligence extraction
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedIntelligence {
  purpose: string | null
  collateral: string | null
  cibilScore: string | null
  cibilBand: "good" | "fair" | "subprime" | "unknown"
  roadblocks: string[]
  advisorGuidance: string | null
  appointmentInfo: string | null
}

export class LeadIntelligenceProfile {
  private readonly rawSummary: string
  private readonly facts: Record<string, any>
  public readonly entities: ExtractedIntelligence

  constructor(summary: string = "", facts: Record<string, any> = {}) {
    this.rawSummary = summary || ""
    this.facts = facts || {}
    this.entities = this.parseEntities()
  }

  private parseEntities(): ExtractedIntelligence {
    const text = this.rawSummary
    const cibil = this.extractCibil(text)

    return {
      purpose: this.extractPurpose(text),
      collateral: this.extractCollateral(text),
      cibilScore: cibil.score,
      cibilBand: cibil.band,
      roadblocks: this.extractRoadblocks(text),
      advisorGuidance: this.extractAdvisorGuidance(text),
      appointmentInfo: this.extractAppointmentInfo(text),
    }
  }

  private extractPurpose(text: string): string | null {
    if (this.facts.purpose) return String(this.facts.purpose)
    if (this.facts.loan_purpose) return String(this.facts.loan_purpose)
    const match = text.match(/(?:needs|seeking|required|for)\s+(?:a\s+)?([^\.,;]+?(?:investment|hospital|business|personal|purchase|medical|expansion)[^\.,;]*)/i)
    if (match) return match[1].trim()
    return null
  }

  private extractCollateral(text: string): string | null {
    if (this.facts.collateral) return String(this.facts.collateral)
    const match = text.match(/(?:offering|as\s+security|collateral|security\s+for|has)\s+([^\.,;]+?(?:acres|land|property|gold|house|plot|flat)[^\.,;]*)/i)
    if (match) return match[1].trim()
    return null
  }

  private extractCibil(text: string): { score: string | null; band: "good" | "fair" | "subprime" | "unknown" } {
    const directScore = this.facts.cibil_score || this.facts.cibil
    let valStr: string | null = directScore ? String(directScore) : null

    if (!valStr) {
      const match = text.match(/cibil\s*(?:score)?\s*(?:of|is|:)?\s*(\d{3})/i)
      if (match) valStr = match[1]
    }

    if (valStr) {
      const num = parseInt(valStr, 10)
      if (num >= 750) return { score: valStr, band: "good" }
      if (num >= 650) return { score: valStr, band: "fair" }
      return { score: valStr, band: "subprime" }
    }

    if (/low\s+cibil/i.test(text)) {
      return { score: "Low (< 650)", band: "subprime" }
    }

    return { score: null, band: "unknown" }
  }

  private extractRoadblocks(text: string): string[] {
    const list: string[] = []
    if (/bank\s+statement/i.test(text)) list.push("Bank statement proof")
    if (/business\s+registration|gst/i.test(text)) list.push("Business registration proof")
    if (/zero[- ]turnover|no\s+turnover|startup/i.test(text)) list.push("Zero-turnover startup")
    if (/agri|agriculture|land|passbook|dharani/i.test(text)) list.push("Agricultural land verification")
    if (/cibil|credit\s+score/i.test(text) && !list.some(r => r.includes("CIBIL"))) list.push("Low CIBIL score")
    return list
  }

  private extractAdvisorGuidance(text: string): string | null {
    const match = text.match(/(?:Priya|Advisor|AI)\s+(?:advised|suggested|informed|recommended|shared)\s+([^\.]+)/i)
    if (match) return match[1].trim()
    return null
  }

  private extractAppointmentInfo(text: string): string | null {
    const match = text.match(/(?:visit|branch|office)\s+(?:the\s+)?([^\.]+?(?:branch|office)[^\.]*)/i)
    if (match) return match[1].trim()
    return null
  }

  public getRawSummary(): string {
    return this.rawSummary
  }

  public hasStructuredInsights(): boolean {
    return Boolean(
      this.entities.purpose ||
      this.entities.collateral ||
      this.entities.cibilScore ||
      this.entities.roadblocks.length > 0 ||
      this.entities.advisorGuidance
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatLoanAmount(val?: number | string | null): string {
  if (!val) return "—"
  const n = Number(val)
  if (isNaN(n)) return String(val)
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(n % 10000000 === 0 ? 0 : 1)} Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 0)} L`
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`
  return `₹${n.toLocaleString("en-IN")}`
}

function formatCurrency(val?: number | string | null): string {
  if (!val) return "—"
  const n = Number(val)
  if (isNaN(n)) return String(val)
  return `₹${n.toLocaleString("en-IN")}`
}

function formatAppointmentTime(dateStr?: string | null): string {
  if (!dateStr) return "Unscheduled"
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return "Tentative"
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const days = Math.floor(diff / 86400000)

  const timeStr = d.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  if (days === 0) return `Today, ${timeStr}`
  if (days === 1) return `Tomorrow, ${timeStr}`
  if (days === -1) return `Yesterday, ${timeStr}`
  if (days < 0) return `${Math.abs(days)}d ago`

  return (
    d.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
    }) + `, ${timeStr}`
  )
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  loan_confirmed:  { label: "Loan confirmed",   color: "#10b981" },
  branch_visit:    { label: "Visit confirmed",   color: "#a78bfa" },
  proposed_visit:  { label: "Visit proposed",    color: "#f59e0b" },
  callback:        { label: "Callback",          color: "#3b82f6" },
  interested_lead: { label: "Interested",        color: "#14b8a6" },
  escalation:      { label: "Escalated",         color: "#ef4444" },
}

function deriveNextAction(lead: ActionCenterLead): string {
  const dueTasks = lead.tasks.filter(t => t.due_at)
  if (dueTasks.length > 0) {
    const nearest = dueTasks.sort(
      (a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime()
    )[0]
    return formatAppointmentTime(nearest.due_at)
  }
  if (lead.recommended_actions.length > 0) {
    const action = lead.recommended_actions[0]
    if (action.length > 30) return action.slice(0, 28) + "…"
    return action
  }
  if (lead.category === "loan_confirmed") return "Review application"
  if (lead.category === "branch_visit") return "Confirm appointment"
  if (lead.category === "proposed_visit") return "Confirm date"
  if (lead.category === "callback") return "Schedule call"
  if (lead.category === "escalation") return "Human assistance"
  if (lead.category === "interested_lead") return "Share application"
  return "Follow up"
}

const TABS: { key: CategoryFilter; label: string }[] = [
  { key: "all",             label: "All leads" },
  { key: "loan_confirmed",  label: "Loans" },
  { key: "callback",        label: "Callbacks" },
  { key: "branch_visit",    label: "Visits" },
  { key: "escalation",      label: "Escalations" },
]

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

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
  const [showFilters, setShowFilters] = useState(false)

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
  const [activeDrawerTab, setActiveDrawerTab] = useState<"overview" | "timeline">("overview")
  const [showFullAiBrief, setShowFullAiBrief] = useState(false)

  // ── Data Fetching ──

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

  // ── Filter & Sort ──

  const filteredLeads = useMemo(() => {
    if (!leads) return []
    let result = [...leads]

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

    if (category !== "all") {
      result = result.filter(l =>
        l.category === category || l.tasks.some(t => t.type === category)
      )
    }

    if (priority !== "all") {
      result = result.filter(l => l.priority === priority)
    }

    if (channel !== "all") {
      result = result.filter(l => {
        if (channel === "phone") return l.timeline.some(t => t.channel === "phone") || l.tasks.some(t => t.channel === "phone")
        if (channel === "whatsapp") return l.timeline.some(t => t.channel === "whatsapp") || l.tasks.some(t => t.channel === "whatsapp_text")
        return true
      })
    }

    const pOrder: Record<PriorityLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    result.sort((a, b) => {
      if (sortField === "priority") {
        const pDiff = (pOrder[a.priority] ?? 2) - (pOrder[b.priority] ?? 2)
        if (pDiff !== 0) return pDiff
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      if (sortField === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      if (sortField === "due_at") {
        const aDue = a.tasks.find(t => t.due_at)?.due_at
        const bDue = b.tasks.find(t => t.due_at)?.due_at
        if (!aDue && !bDue) return 0
        if (!aDue) return 1
        if (!bDue) return -1
        return new Date(aDue).getTime() - new Date(bDue).getTime()
      }
      if (sortField === "loan_amount") return Number(b.financial.loan_amount || 0) - Number(a.financial.loan_amount || 0)
      return 0
    })

    return result
  }, [leads, search, category, priority, channel, sortField])

  // Pagination
  const totalPages = Math.ceil(filteredLeads.length / pageSize) || 1
  const paginatedLeads = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredLeads.slice(start, start + pageSize)
  }, [filteredLeads, page, pageSize])

  // ── Selection ──

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

  // ── Resolve ──

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
        body: JSON.stringify({ bulkIds: idsToResolve, notes }),
      })

      if (res.ok) {
        setLeads(prev => (prev ? prev.filter(l => !idsToResolve.includes(l.id)) : prev))
        setSelectedLeadIds(new Set())
        setResolvingLead(null)
        setIsBulkResolving(false)
        setResolutionNotes("")
        if (selectedLead && idsToResolve.includes(selectedLead.id)) setSelectedLead(null)
      } else {
        setError("Could not resolve item(s). Please try again.")
      }
    } catch {
      setError("Network error while resolving item.")
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── WhatsApp Nav ──

  function openWhatsAppChat(leadId: string | null) {
    if (!leadId || typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent("rag:lead-focus", { detail: { leadId, view: "whatsapp" } }))
    window.dispatchEvent(new CustomEvent("rag:navigate", { detail: { view: "whatsapp" } }))
  }

  // ── CSV Export ──

  function exportToCsv() {
    if (filteredLeads.length === 0) return
    const headers = ["Customer", "Phone", "Status", "Priority", "Product", "Loan Amount", "City", "Tasks", "Summary", "Created"]
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
    const link = document.createElement("a")
    link.setAttribute("href", encodeURI(csvContent))
    link.setAttribute("download", `Needs_Human_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // ── Computed Metrics ──

  const dueToday = useMemo(() => {
    if (!leads) return 0
    const todayStart = new Date(); todayStart.setHours(0,0,0,0)
    const todayEnd = new Date(); todayEnd.setHours(23,59,59,999)
    return leads.filter(l => l.tasks.some(t => {
      if (!t.due_at) return false
      const d = new Date(t.due_at)
      return d >= todayStart && d <= todayEnd
    })).length
  }, [leads])

  const officeVisits = (counts.visits || 0) + (counts.proposed_visits || 0)
  const escalationCount = counts.escalations || 0

  // Instantiated OOP Intelligence Object for Selected Lead
  const leadIntelligence = useMemo(() => {
    if (!selectedLead) return null
    return new LeadIntelligenceProfile(
      selectedLead.ai_analysis.summary || selectedLead.full_description || selectedLead.summary,
      selectedLead.ai_analysis.facts || {}
    )
  }, [selectedLead])

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className="relative min-h-[calc(100vh-80px)]">

      {/* ── TOP UTILITY ROW (Single non-duplicate header) ── */}
      <div className="mb-3.5 flex items-center justify-between">
        <div className="text-[12.5px] text-[var(--text-muted)] font-medium">
          Manage and prioritize customer follow-ups
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportToCsv}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition shadow-sm"
          >
            <Download size={13} /> Export
          </button>
          <button
            onClick={load}
            disabled={isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition disabled:opacity-40 shadow-sm"
            title="Refresh leads"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── COMPACT STATUS COUNTERS ── */}
      <div className="mb-4 grid grid-cols-4 gap-3">
        {[
          { label: "Pending actions", value: counts.all || 0 },
          { label: "Due today", value: dueToday },
          { label: "Office visits", value: officeVisits },
          { label: "Escalations", value: escalationCount },
        ].map(metric => (
          <div key={metric.label} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3.5 py-2.5 shadow-sm">
            <div className="text-[11.5px] text-[var(--text-muted)] font-medium">{metric.label}</div>
            <div className="mt-0.5 text-[22px] font-semibold text-[var(--text-primary)] leading-tight tracking-tight">{metric.value}</div>
          </div>
        ))}
      </div>

      {/* ── CATEGORY TABS ── */}
      <div className="mb-4 flex items-center gap-0 border-b border-[var(--border)]">
        {TABS.map(tab => {
          const isActive = category === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => { setCategory(tab.key); setPage(1) }}
              className={`relative px-3.5 py-2 text-[13px] font-medium transition cursor-pointer ${
                isActive
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--text-primary)] rounded-t" />
              )}
            </button>
          )
        })}
      </div>

      {/* ── SEARCH + FILTERS ROW ── */}
      <div className="mb-4 flex items-center gap-2.5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search customers..."
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] pl-9 pr-8 text-[13px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)] transition shadow-sm"
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

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition cursor-pointer ${
            showFilters || priority !== "all" || channel !== "all"
              ? "border-[var(--accent-blue)] text-[var(--accent-blue)] bg-[var(--accent-blue)]/5"
              : "border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-card)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
          }`}
        >
          <Filter size={13} /> Filters
        </button>

        <select
          value={sortField}
          onChange={e => setSortField(e.target.value as SortField)}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 text-[12.5px] font-medium text-[var(--text-secondary)] focus:outline-none cursor-pointer appearance-none pr-7 shadow-sm"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7 15l5 5 5-5'/%3E%3Cpath d='M7 9l5-5 5 5'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center" }}
        >
          <option value="priority">Priority</option>
          <option value="due_at">Due date</option>
          <option value="loan_amount">Loan amount</option>
          <option value="newest">Newest</option>
        </select>
      </div>

      {/* ── FILTER PANEL (collapsible) ── */}
      {showFilters && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2.5 animate-in fade-in duration-100">
          <span className="text-[11.5px] text-[var(--text-muted)] font-medium mr-1">Priority</span>
          <select
            value={priority}
            onChange={e => { setPriority(e.target.value); setPage(1) }}
            className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2 text-[12px] text-[var(--text-primary)] focus:outline-none cursor-pointer"
          >
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <span className="ml-3 text-[11.5px] text-[var(--text-muted)] font-medium mr-1">Channel</span>
          <select
            value={channel}
            onChange={e => { setChannel(e.target.value); setPage(1) }}
            className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2 text-[12px] text-[var(--text-primary)] focus:outline-none cursor-pointer"
          >
            <option value="all">All</option>
            <option value="phone">Phone</option>
            <option value="whatsapp">WhatsApp</option>
          </select>

          {(priority !== "all" || channel !== "all") && (
            <button
              onClick={() => { setPriority("all"); setChannel("all"); setPage(1) }}
              className="ml-auto text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] underline cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* ── BULK ACTIONS BAR ── */}
      {selectedLeadIds.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/5 px-4 py-2 animate-in fade-in duration-100">
          <span className="text-[12.5px] font-medium text-[var(--text-primary)]">
            {selectedLeadIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setIsBulkResolving(true); setResolvingLead(null); setResolutionNotes("") }}
              className="flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-[11.5px] font-semibold text-white hover:bg-emerald-500 transition cursor-pointer"
            >
              <CheckCheck size={12} /> Mark resolved
            </button>
            <button
              onClick={() => setSelectedLeadIds(new Set())}
              className="text-[11.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Deselect
            </button>
          </div>
        </div>
      )}

      {/* ── ERROR ── */}
      {error && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-2 text-[12.5px] text-amber-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={load} className="underline text-[11px] font-medium hover:text-amber-200 cursor-pointer">Retry</button>
        </div>
      )}

      {/* ── MAIN DATA TABLE (ENTERPRISE COMPACT VIEW) ── */}
      {isLoading && leads === null ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6">
          <SkeletonList rows={8} />
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] py-16 text-center">
          <CheckCheck size={28} className="mx-auto mb-2 text-emerald-400" />
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">All clear</h3>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)] max-w-sm mx-auto">
            No follow-ups pending. New items will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden shadow-sm">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11.5px] font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)]/50">
                <th className="py-2.5 pl-3 pr-1 w-9">
                  <input
                    type="checkbox"
                    checked={selectedLeadIds.size > 0 && selectedLeadIds.size === paginatedLeads.length}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 rounded border-[var(--border)] bg-transparent accent-[var(--accent-blue)] cursor-pointer"
                  />
                </th>
                <th className="py-2.5 px-3 font-medium">Customer</th>
                <th className="py-2.5 px-3 font-medium">Loan / Amount</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Next action</th>
                <th className="py-2.5 px-3 w-9"></th>
              </tr>
            </thead>
            <tbody>
              {paginatedLeads.map(lead => {
                const status = STATUS_CONFIG[lead.category] || STATUS_CONFIG.escalation
                const isSelected = selectedLeadIds.has(lead.id)

                return (
                  <tr
                    key={lead.id}
                    onClick={() => {
                      setSelectedLead(lead)
                      setActiveDrawerTab("overview")
                      setShowFullAiBrief(false)
                    }}
                    className={`border-b border-[var(--border)] last:border-b-0 cursor-pointer transition hover:bg-[var(--overlay-hover)] ${
                      isSelected ? "bg-[var(--accent-blue)]/[0.04]" : ""
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="py-2.5 pl-3 pr-1" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={e => { const ev = e.nativeEvent as any; toggleSelectLead(lead.id, ev) }}
                        onClick={e => e.stopPropagation()}
                        className="h-3.5 w-3.5 rounded border-[var(--border)] bg-transparent accent-[var(--accent-blue)] cursor-pointer"
                      />
                    </td>

                    {/* Customer */}
                    <td className="py-2.5 px-3">
                      <div className="text-[13px] font-semibold text-[var(--text-primary)] leading-tight">
                        {lead.lead_name}
                      </div>
                    </td>

                    {/* Loan / Amount */}
                    <td className="py-2.5 px-3">
                      <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {formatLoanAmount(lead.financial.loan_amount)}
                      </div>
                      <div className="text-[11.5px] text-[var(--text-muted)] capitalize">
                        {(lead.financial.product_interest || "Loan").replace(/_/g, " ")}
                      </div>
                    </td>

                    {/* Status with colored dot */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: status.color }}
                        />
                        <span className="text-[12.5px] text-[var(--text-secondary)]">
                          {status.label}
                        </span>
                      </div>
                    </td>

                    {/* Next action */}
                    <td className="py-2.5 px-3">
                      <span className="text-[12.5px] text-[var(--text-secondary)]">
                        {deriveNextAction(lead)}
                      </span>
                    </td>

                    {/* Chevron */}
                    <td className="py-2.5 px-3 text-right">
                      <ChevronRight size={15} className="text-[var(--text-muted)] inline-block" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── PAGINATION FOOTER ── */}
      <div className="mt-3 flex items-center justify-between text-[12px] text-[var(--text-muted)]">
        <span>
          {filteredLeads.length > 0
            ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredLeads.length)} of ${filteredLeads.length} leads`
            : "No leads"
          }
        </span>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
            className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 text-[11.5px] text-[var(--text-primary)] focus:outline-none cursor-pointer"
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="h-7 w-7 flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-card)] disabled:opacity-30 hover:bg-[var(--bg-card-hover)] transition cursor-pointer"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11.5px] text-[var(--text-secondary)] tabular-nums">
            {page}/{totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="h-7 w-7 flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-card)] disabled:opacity-30 hover:bg-[var(--bg-card-hover)] transition cursor-pointer"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          RIGHT-SIDE DETAIL DRAWER
          Contains Overview (with OOP AI Intelligence) & Timeline
      ══════════════════════════════════════════════════════════════════════ */}
      {selectedLead && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => setSelectedLead(null)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />

          {/* Drawer Panel */}
          <div
            className="relative h-full w-full max-w-lg bg-[var(--bg-card)] border-l border-[var(--border)] shadow-2xl flex flex-col"
            style={{ animation: "slideInRight 150ms ease-out" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="border-b border-[var(--border)] px-5 py-4 flex items-start justify-between flex-shrink-0 bg-[var(--bg-secondary)]/40">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[16px] font-semibold text-[var(--text-primary)] truncate">
                    {selectedLead.lead_name}
                  </h2>
                  <span
                    className="flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: STATUS_CONFIG[selectedLead.category]?.color + "18",
                      color: STATUS_CONFIG[selectedLead.category]?.color,
                      border: `1px solid ${STATUS_CONFIG[selectedLead.category]?.color}33`,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: STATUS_CONFIG[selectedLead.category]?.color }}
                    />
                    {STATUS_CONFIG[selectedLead.category]?.label}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[12px] text-[var(--text-muted)]">
                  {selectedLead.lead_phone && <span className="font-mono text-[var(--text-secondary)]">{selectedLead.lead_phone}</span>}
                  {selectedLead.city && (
                    <span className="flex items-center gap-1">
                      <MapPin size={11} className="text-[var(--text-muted)]" /> {selectedLead.city}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="ml-3 h-7 w-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-hover)] transition flex-shrink-0 cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            {/* Drawer Navigation Tabs: Overview & Timeline */}
            <div className="flex border-b border-[var(--border)] px-5 flex-shrink-0 bg-[var(--bg-secondary)]/20">
              <button
                onClick={() => setActiveDrawerTab("overview")}
                className={`py-2.5 px-3 text-[12.5px] font-medium border-b-2 transition cursor-pointer ${
                  activeDrawerTab === "overview"
                    ? "border-[var(--text-primary)] text-[var(--text-primary)] font-semibold"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveDrawerTab("timeline")}
                className={`py-2.5 px-3 text-[12.5px] font-medium border-b-2 transition cursor-pointer ${
                  activeDrawerTab === "timeline"
                    ? "border-[var(--text-primary)] text-[var(--text-primary)] font-semibold"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Timeline ({selectedLead.timeline.length})
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {/* ════════════════════════════════════════════════════════════
                  OVERVIEW TAB (INCLUDES OOP-STRUCTURED AI ANALYSIS)
              ════════════════════════════════════════════════════════════ */}
              {activeDrawerTab === "overview" && (
                <>
                  {/* 1. FINANCIAL SNAPSHOT PROFILE */}
                  <section>
                    <h4 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2.5">
                      Financial Profile
                    </h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]/50 p-3">
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)]">Loan Requirement</div>
                        <div className="text-[14px] font-bold text-emerald-400">
                          {formatCurrency(selectedLead.financial.loan_amount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)]">Product Type</div>
                        <div className="text-[13px] font-semibold text-[var(--text-primary)] capitalize">
                          {(selectedLead.financial.product_interest || "Personal Loan").replace(/_/g, " ")}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)]">Monthly Income</div>
                        <div className="text-[13px] font-medium text-[var(--text-primary)]">
                          {formatCurrency(selectedLead.financial.monthly_income)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)]">Employment Profile</div>
                        <div className="text-[13px] font-medium text-[var(--text-primary)] capitalize">
                          {selectedLead.financial.employment_type || "—"}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* 2. AI EXECUTIVE INTELLIGENCE (OOP-DRIVEN STRUCTURED PRESENTATION) */}
                  {leadIntelligence && (
                    <section className="rounded-lg border border-indigo-500/30 bg-gradient-to-br from-indigo-500/[0.06] via-purple-500/[0.04] to-transparent p-3.5 shadow-sm">
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-indigo-300">
                          <Sparkles size={13} className="text-indigo-400" />
                          <span>AI Executive Intelligence</span>
                        </div>
                        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          PRIYA NEURAL MEMORY
                        </span>
                      </div>

                      {/* Structured Domain Entity Breakdown */}
                      <div className="space-y-2 text-[12.5px]">
                        {/* Loan Purpose Entity */}
                        {leadIntelligence.entities.purpose && (
                          <div className="flex items-start gap-2 bg-[var(--bg-card)]/80 rounded-md border border-[var(--border)] p-2">
                            <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase shrink-0 w-24">
                              Loan Purpose:
                            </span>
                            <span className="font-medium text-[var(--text-primary)]">
                              {leadIntelligence.entities.purpose}
                            </span>
                          </div>
                        )}

                        {/* Collateral Security Entity */}
                        {leadIntelligence.entities.collateral && (
                          <div className="flex items-start gap-2 bg-[var(--bg-card)]/80 rounded-md border border-[var(--border)] p-2">
                            <span className="text-[11px] font-bold text-amber-400/90 uppercase shrink-0 w-24">
                              Collateral:
                            </span>
                            <span className="font-semibold text-amber-200">
                              {leadIntelligence.entities.collateral}
                            </span>
                          </div>
                        )}

                        {/* Credit / CIBIL Entity */}
                        {leadIntelligence.entities.cibilScore && (
                          <div className="flex items-start gap-2 bg-[var(--bg-card)]/80 rounded-md border border-[var(--border)] p-2">
                            <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase shrink-0 w-24">
                              Credit Score:
                            </span>
                            <span className={`inline-flex items-center gap-1 font-bold text-[11.5px] px-2 py-0.5 rounded ${
                              leadIntelligence.entities.cibilBand === "good"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : leadIntelligence.entities.cibilBand === "fair"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                            }`}>
                              CIBIL {leadIntelligence.entities.cibilScore} ({leadIntelligence.entities.cibilBand.toUpperCase()})
                            </span>
                          </div>
                        )}

                        {/* Documentation Roadblocks Entity */}
                        {leadIntelligence.entities.roadblocks.length > 0 && (
                          <div className="flex items-start gap-2 bg-[var(--bg-card)]/80 rounded-md border border-[var(--border)] p-2">
                            <span className="text-[11px] font-bold text-red-400/90 uppercase shrink-0 w-24">
                              Key Hurdles:
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {leadIntelligence.entities.roadblocks.map((rb, i) => (
                                <span
                                  key={i}
                                  className="rounded bg-red-500/15 border border-red-500/30 px-1.5 py-0.5 text-[10.5px] font-medium text-red-300"
                                >
                                  {rb}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Advisor Guidance Entity */}
                        {leadIntelligence.entities.advisorGuidance && (
                          <div className="flex items-start gap-2 bg-[var(--bg-card)]/80 rounded-md border border-[var(--border)] p-2">
                            <span className="text-[11px] font-bold text-blue-400/90 uppercase shrink-0 w-24">
                              Advisor Note:
                            </span>
                            <span className="text-[12px] text-[var(--text-secondary)] italic">
                              {leadIntelligence.entities.advisorGuidance}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Expandable Full Conversation Brief */}
                      <div className="mt-2.5 pt-2 border-t border-indigo-500/20">
                        <button
                          onClick={() => setShowFullAiBrief(!showFullAiBrief)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-indigo-300 hover:text-indigo-200 transition cursor-pointer"
                        >
                          {showFullAiBrief ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          <span>{showFullAiBrief ? "Collapse AI transcript briefing" : "View full AI transcript briefing"}</span>
                        </button>

                        {showFullAiBrief && (
                          <p className="mt-2 text-[12px] text-[var(--text-secondary)] leading-relaxed bg-[var(--bg-secondary)] p-2.5 rounded border border-[var(--border)] animate-in fade-in duration-100">
                            {leadIntelligence.getRawSummary()}
                          </p>
                        )}
                      </div>
                    </section>
                  )}

                  {/* 3. ACTIVE TASKS & APPOINTMENT SCHEDULE */}
                  {selectedLead.tasks.length > 0 && (
                    <section>
                      <h4 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                        Active Tasks & Appointments
                      </h4>
                      <div className="space-y-2">
                        {selectedLead.tasks.map(t => (
                          <div key={t.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]/50 p-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">{t.title}</span>
                              <span className="text-[10px] font-bold text-[var(--accent-blue)] uppercase px-1.5 py-0.5 rounded bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/20">
                                {t.status}
                              </span>
                            </div>
                            {t.due_at && (
                              <div className="mt-1 flex items-center gap-1 text-[11.5px] text-amber-300">
                                <Clock size={11} /> {formatAppointmentTime(t.due_at)}
                              </div>
                            )}
                            {t.location && (
                              <div className="mt-1 flex items-center gap-1 text-[11.5px] text-[var(--text-secondary)]">
                                <MapPin size={11} className="text-indigo-400" /> {t.location}
                              </div>
                            )}
                            {t.raw_quote && (
                              <p className="mt-1.5 text-[11.5px] text-[var(--text-muted)] italic leading-relaxed">
                                &ldquo;{t.raw_quote}&rdquo;
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 4. CUSTOMER CONCERNS */}
                  {selectedLead.concerns.length > 0 && (
                    <section>
                      <h4 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                        Customer Concerns & Objections
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedLead.concerns.map((c, i) => (
                          <span
                            key={i}
                            className="rounded-md bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[11px] font-medium text-red-400"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 5. RECOMMENDED NEXT ACTIONS */}
                  <section>
                    <h4 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      Recommended Next Actions
                    </h4>
                    <ul className="space-y-1.5">
                      {selectedLead.recommended_actions.map((act, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)] leading-relaxed">
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-400 mt-0.5">
                            {i + 1}
                          </span>
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}

              {/* ════════════════════════════════════════════════════════════
                  TIMELINE TAB
              ════════════════════════════════════════════════════════════ */}
              {activeDrawerTab === "timeline" && (
                <div className="space-y-2.5">
                  {selectedLead.timeline.length === 0 ? (
                    <p className="text-[12.5px] text-[var(--text-muted)] text-center py-8">
                      No interactions logged yet.
                    </p>
                  ) : (
                    selectedLead.timeline.map(entry => (
                      <div key={entry.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]/50 p-3">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--text-primary)]">
                            {entry.channel === "phone"
                              ? <Phone size={12} className="text-emerald-400" />
                              : <MessageCircle size={12} className="text-blue-400" />
                            }
                            {entry.title}
                          </span>
                          <span className="text-[10.5px] text-[var(--text-muted)] font-mono">{timeAgo(entry.timestamp)}</span>
                        </div>
                        <p className="mt-1 text-[12px] text-[var(--text-secondary)] leading-relaxed">
                          {entry.summary}
                        </p>
                        {entry.recording_url && (
                          <a
                            href={entry.recording_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--accent-blue)] hover:underline"
                          >
                            Play recording →
                          </a>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Drawer Footer Quick Actions */}
            <div className="border-t border-[var(--border)] px-5 py-3 flex items-center justify-between flex-shrink-0 bg-[var(--bg-secondary)]/40">
              <div className="flex items-center gap-2">
                {selectedLead.lead_phone && (
                  <a
                    href={`tel:${selectedLead.lead_phone}`}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 text-[12px] font-semibold text-[var(--text-secondary)] hover:text-emerald-400 hover:border-emerald-500/30 transition shadow-sm"
                  >
                    <Phone size={12} /> Call
                  </a>
                )}
                {selectedLead.lead_id && (
                  <button
                    onClick={() => openWhatsAppChat(selectedLead.lead_id)}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 text-[12px] font-semibold text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/30 transition shadow-sm cursor-pointer"
                  >
                    <MessageCircle size={12} /> WhatsApp
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  setResolvingLead(selectedLead)
                  setIsBulkResolving(false)
                  setResolutionNotes("")
                }}
                className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-4 text-[12px] font-semibold text-white hover:bg-emerald-500 transition shadow-sm cursor-pointer"
              >
                <CheckCheck size={13} /> Resolve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          RESOLUTION MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      {(resolvingLead || isBulkResolving) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                {isBulkResolving ? `Resolve ${selectedLeadIds.size} leads` : "Resolve lead"}
              </h3>
              <button
                onClick={() => { setResolvingLead(null); setIsBulkResolving(false); setResolutionNotes("") }}
                disabled={isSubmitting}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="mt-3">
              {!isBulkResolving && resolvingLead && (
                <div className="flex items-center justify-between text-[12.5px] mb-2">
                  <span className="font-semibold text-[var(--text-primary)]">{resolvingLead.lead_name}</span>
                  <span className="font-mono text-[var(--text-muted)]">{resolvingLead.lead_phone}</span>
                </div>
              )}
              <p className="text-[11.5px] text-[var(--text-muted)] mb-2.5">
                Add notes for the audit trail.
              </p>
              <textarea
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                placeholder="What was done or discussed..."
                rows={3}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-[12.5px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)] resize-none transition"
                autoFocus
              />
            </div>

            <div className="mt-3.5 flex items-center justify-end gap-2">
              <button
                onClick={() => { setResolvingLead(null); setIsBulkResolving(false); setResolutionNotes("") }}
                disabled={isSubmitting}
                className="h-8 rounded-lg border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-muted)] hover:bg-[var(--overlay-hover)] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleResolveSubmit}
                disabled={isSubmitting || !resolutionNotes.trim()}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-[12px] font-semibold text-white disabled:opacity-40 hover:bg-emerald-500 transition cursor-pointer shadow-sm"
              >
                {isSubmitting ? (
                  <><RefreshCw size={12} className="animate-spin" /> Resolving...</>
                ) : (
                  <><CheckCheck size={13} /> Confirm</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── INLINE KEYFRAMES ── */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
