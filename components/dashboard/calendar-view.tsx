"use client"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
import { useEffect, useState, useMemo } from "react"
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Phone,
  PhoneCall,
  RotateCcw,
  X,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  MapPin,
  Building2,
  FileText,
  Bell,
  HelpCircle,
  Play,
  ArrowRight,
  ShieldCheck,
  Check,
  Edit2,
  History,
  MessageSquare
} from "lucide-react"
import { useToast } from "../ui/toast"
import { SkeletonList } from "../ui/skeleton"

export type CalendarEventType = "callback" | "branch_visit" | "document_deadline" | "reminder"
export type CalendarEventStatus = "needs_review" | "confirmed" | "completed" | "cancelled" | "rescheduled"
export type CalendarConfidence = "high" | "medium" | "low"

export type CalendarEvent = {
  id: string
  lead_id: string | null
  branch_id: string | null
  event_type: CalendarEventType
  title: string
  event_at: string
  end_at: string | null
  status: CalendarEventStatus
  confidence: CalendarConfidence
  confidence_score: number
  raw_quote: string | null
  location: string | null
  channel: string | null
  notes: string | null
  source_type: "voice_call" | "whatsapp_message" | "lead_note" | "manual"
  source_id: string
  source_at: string
  reminder_enabled: boolean
  reminder_sent: boolean
  outbound_queue_id: string | null
  lead_name: string | null
  lead_phone: string | null
  product_interest: string | null
  queue_status: string | null
  created_at: string
}

type Lead = { id: string; name: string; phone: string }

type ScanResult = {
  ok: boolean
  dryRun: boolean
  processedCount: number
  eventsCreated: number
  needsReview: number
  skippedCount: number
  details?: {
    callSid: string
    leadName?: string
    phone?: string
    highConfidenceEvents: any[]
    reviewEvents: any[]
    durationMs: number
  }[]
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function formatIST(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return dateStr
  }
}

export function formatTimeIST(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

export function toLocalDatetimeInput(dateStrOrObj: string | Date): string {
  try {
    const d = typeof dateStrOrObj === "string" ? new Date(dateStrOrObj) : dateStrOrObj
    if (isNaN(d.getTime())) return ""
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  } catch {
    return ""
  }
}

const TYPE_CONFIG: Record<CalendarEventType, { label: string; icon: any; color: string; bg: string; border: string }> = {
  branch_visit: {
    label: "Branch Visit",
    icon: Building2,
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.14)",
    border: "rgba(16, 185, 129, 0.35)",
  },
  callback: {
    label: "Callback",
    icon: PhoneCall,
    color: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.14)",
    border: "rgba(59, 130, 246, 0.35)",
  },
  document_deadline: {
    label: "Doc Deadline",
    icon: FileText,
    color: "#a855f7",
    bg: "rgba(168, 85, 247, 0.14)",
    border: "rgba(168, 85, 247, 0.35)",
  },
  reminder: {
    label: "Reminder",
    icon: Bell,
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.14)",
    border: "rgba(245, 158, 11, 0.35)",
  },
}

export default function CalendarView({ role }: { role: Role }) {
  const canEdit = role !== "viewer"
  const canCall = role === "admin" || role === "agent" || role === "branch_manager" || role === "developer"
  const canScan = role === "admin" || role === "branch_manager" || role === "developer"
  const toast = useToast()

  const [activeTab, setActiveTab] = useState<"calendar" | "review" | "scanner">("calendar")
  const [typeFilter, setTypeFilter] = useState<string>("all")

  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [reviewEvents, setReviewEvents] = useState<CalendarEvent[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CalendarEvent | null>(null)
  const [calling, setCalling] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  // Scheduling state
  const [scheduling, setScheduling] = useState(false)
  const [scheduleLeadId, setScheduleLeadId] = useState("")
  const [scheduleType, setScheduleType] = useState<CalendarEventType>("branch_visit")
  const [scheduleTitle, setScheduleTitle] = useState("")
  const [scheduleDateTime, setScheduleDateTime] = useState("")
  const [scheduleLocation, setScheduleLocation] = useState("")
  const [scheduleNote, setScheduleNote] = useState("")
  const [saving, setSaving] = useState(false)

  // Reschedule state in detail modal
  const [rescheduleMode, setRescheduleMode] = useState(false)
  const [rescheduleDateTime, setRescheduleDateTime] = useState("")

  // Scanner state
  const [scanLimit, setScanLimit] = useState(25)
  const [scanDryRun, setScanDryRun] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)

  async function loadData() {
    setLoading(true)
    const firstOfMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)
    const gridStart = new Date(firstOfMonth)
    gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay() - 1)
    gridStart.setHours(0, 0, 0, 0)
    const lastDayOfMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0)
    const gridEnd = new Date(lastDayOfMonth)
    gridEnd.setDate(gridEnd.getDate() + (6 - lastDayOfMonth.getDay()) + 1)
    gridEnd.setHours(23, 59, 59, 999)

    const from = gridStart.toISOString()
    const to = gridEnd.toISOString()

    try {
      const [eventsRes, reviewRes, leadsRes] = await Promise.all([
        fetch(`/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=all`),
        fetch(`/api/calendar/events?status=needs_review`),
        fetch(`/api/leads`),
      ])

      if (eventsRes.ok) {
        const d = await eventsRes.json().catch(() => ({}))
        setEvents(Array.isArray(d?.events) ? d.events : [])
      }
      if (reviewRes.ok) {
        const d = await reviewRes.json().catch(() => ({}))
        setReviewEvents(Array.isArray(d?.events) ? d.events : [])
      }
      if (leadsRes.ok) {
        const d = await leadsRes.json().catch(() => [])
        setLeads(Array.isArray(d) ? d : [])
      }

      if (!eventsRes.ok && !reviewRes.ok) {
        setLoadError("Couldn't load calendar data. Check connection and retry.")
      } else {
        setLoadError(null)
      }
    } catch {
      setLoadError("Couldn't load calendar data. Check connection and retry.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthCursor])

  async function handleApprove(eventId: string) {
    setActionInProgress(eventId)
    try {
      const res = await fetch(`/api/calendar/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success("Event approved & confirmed" + (d.event?.event_type === "callback" ? " (Synced to Call Queue)" : ""))
        if (selected?.id === eventId) setSelected(null)
        loadData()
      } else {
        toast.error(d.error || "Failed to approve event")
      }
    } catch {
      toast.error("Network error while approving event")
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleReject(eventId: string) {
    if (!window.confirm("Dismiss and reject this detected event?")) return
    setActionInProgress(eventId)
    try {
      const res = await fetch(`/api/calendar/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      })
      if (res.ok) {
        toast.success("Event dismissed")
        if (selected?.id === eventId) setSelected(null)
        loadData()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Failed to reject event")
      }
    } catch {
      toast.error("Network error while rejecting event")
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleReschedule(eventId: string, newDateTime: string) {
    if (!newDateTime) return
    setActionInProgress(eventId)
    try {
      const res = await fetch(`/api/calendar/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reschedule",
          eventAt: new Date(newDateTime).toISOString(),
        }),
      })
      if (res.ok) {
        toast.success("Event rescheduled successfully")
        setRescheduleMode(false)
        if (selected?.id === eventId) setSelected(null)
        loadData()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Failed to reschedule event")
      }
    } catch {
      toast.error("Network error while rescheduling event")
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleCancel(eventId: string) {
    if (!window.confirm("Cancel this appointment? (Any linked queue call will also be cancelled)")) return
    setActionInProgress(eventId)
    try {
      const res = await fetch(`/api/calendar/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      })
      if (res.ok) {
        toast.success("Appointment cancelled")
        setSelected(null)
        loadData()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Failed to cancel event")
      }
    } catch {
      toast.error("Network error while cancelling event")
    } finally {
      setActionInProgress(null)
    }
  }

  async function callWithPriya(leadId: string) {
    if (!leadId) return
    setCalling(true)
    try {
      const res = await fetch("/api/calls/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, channel: "auto" }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success("Priya is calling them now")
        setSelected(null)
      } else {
        toast.error(d.error || "Call could not be placed")
      }
    } catch {
      toast.error("Call could not be placed — check connection and try again")
    } finally {
      setCalling(false)
    }
  }

  async function handleCreateEvent() {
    if (!scheduleLeadId || !scheduleDateTime) return
    const selLead = leads.find((l) => l.id === scheduleLeadId)
    setSaving(true)
    try {
      const title = scheduleTitle.trim() || `${TYPE_CONFIG[scheduleType].label} with ${selLead?.name || "Customer"}`
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: scheduleLeadId,
          leadName: selLead?.name || null,
          leadPhone: selLead?.phone || null,
          eventType: scheduleType,
          title,
          eventAt: new Date(scheduleDateTime).toISOString(),
          location: scheduleLocation || null,
          notes: scheduleNote || null,
          rawQuote: "Manually booked by staff",
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success("Event created successfully" + (scheduleType === "callback" ? " and added to Call Queue" : ""))
        setScheduling(false)
        setScheduleLeadId("")
        setScheduleTitle("")
        setScheduleDateTime("")
        setScheduleLocation("")
        setScheduleNote("")
        loadData()
      } else {
        toast.error(d.error || "Failed to create event")
      }
    } catch {
      toast.error("Network error creating event")
    } finally {
      setSaving(false)
    }
  }

  async function triggerScan(dryRun: boolean) {
    setScanning(true)
    setScanResult(null)
    try {
      const res = await fetch("/api/calendar/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun,
          limit: scanLimit,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setScanResult(data)
        if (dryRun) {
          toast.success(`Preview completed: ${data.eventsCreated} events discovered in ${data.processedCount} calls`)
        } else {
          toast.success(`Scan applied! Created ${data.eventsCreated} events, ${data.needsReview} in Review Queue`)
          loadData()
        }
      } else {
        toast.error(data.error || "Scan failed to run")
      }
    } catch {
      toast.error("Network error running Calendar Agent scan")
    } finally {
      setScanning(false)
    }
  }

  // Filtered confirmed/scheduled events for the calendar grid - Single Point of Truth Per Lead
  const visibleEvents = useMemo(() => {
    const leadMap = new Map<string, CalendarEvent>()

    const active = events.filter((e) => {
      if (e.status === "cancelled") return false
      if (typeFilter !== "all" && e.event_type !== typeFilter) return false
      return true
    })

    // Group and consolidate per lead so that each lead appears as EXACTLY ONE clean appointment card!
    for (const e of active) {
      const key = e.lead_id || (e.lead_phone ? e.lead_phone.replace(/\D/g, "").slice(-10) : e.id)
      const existing = leadMap.get(key)
      if (!existing) {
        leadMap.set(key, e)
      } else {
        // Keep the one with the latest date or confirmed status
        const existingTime = new Date(existing.event_at).getTime()
        const currTime = new Date(e.event_at).getTime()
        if (currTime >= existingTime && (e.status === "confirmed" || existing.status !== "confirmed")) {
          leadMap.set(key, e)
        }
      }
    }

    return Array.from(leadMap.values())
  }, [events, typeFilter])

  // Build the visible grid: pad to full weeks, Sunday-first.
  const firstOfMonth = monthCursor
  const startWeekday = firstOfMonth.getDay()
  const daysInMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate()
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(gridStart.getDate() - startWeekday)
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7
  const cells: Date[] = Array.from({ length: totalCells }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(d.getDate() + i)
    return d
  })

  const eventsByDay: Record<string, CalendarEvent[]> = {}
  for (const ev of visibleEvents) {
    const key = toDateKey(new Date(ev.event_at))
    if (!eventsByDay[key]) eventsByDay[key] = []
    eventsByDay[key].push(ev)
  }

  const todayKey = toDateKey(new Date())
  const monthLabel = monthCursor.toLocaleDateString([], { month: "long", year: "numeric" })

  const nowMs = Date.now()
  const upcomingEvents = visibleEvents
    .filter((e) => new Date(e.event_at).getTime() >= nowMs)
    .sort((a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime())

  const todayEvents = eventsByDay[todayKey] || []

  // Counts by type
  const branchVisitsCount = visibleEvents.filter((e) => e.event_type === "branch_visit").length
  const callbacksCount = visibleEvents.filter((e) => e.event_type === "callback").length
  const deadlinesCount = visibleEvents.filter((e) => e.event_type === "document_deadline" || e.event_type === "reminder").length

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Top Header Bar */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        {/* Navigation Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTab("calendar")}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: activeTab === "calendar" ? "var(--accent-violet)" : "transparent",
              color: activeTab === "calendar" ? "#ffffff" : "var(--text-secondary)",
              border: activeTab === "calendar" ? "none" : "1px solid var(--border-light)",
              transition: "all 0.15s ease",
            }}
          >
            <CalendarClock size={15} />
            <span>Schedule & Calendar</span>
          </button>

          <button
            onClick={() => setActiveTab("review")}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: activeTab === "review" ? "var(--accent-blue)" : "transparent",
              color: activeTab === "review" ? "#ffffff" : "var(--text-secondary)",
              border: activeTab === "review" ? "none" : "1px solid var(--border-light)",
              transition: "all 0.15s ease",
            }}
          >
            <ShieldCheck size={15} />
            <span>AI Review Queue</span>
            {reviewEvents.length > 0 && (
              <span
                style={{
                  background: activeTab === "review" ? "rgba(255,255,255,0.25)" : "rgba(245, 158, 11, 0.2)",
                  color: activeTab === "review" ? "#fff" : "#f59e0b",
                  border: activeTab === "review" ? "none" : "1px solid rgba(245, 158, 11, 0.4)",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 999,
                }}
              >
                {reviewEvents.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("scanner")}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: activeTab === "scanner" ? "rgba(16, 185, 129, 0.18)" : "transparent",
              color: activeTab === "scanner" ? "#10b981" : "var(--text-secondary)",
              border: activeTab === "scanner" ? "1px solid #10b981" : "1px solid var(--border-light)",
              transition: "all 0.15s ease",
            }}
          >
            <Sparkles size={15} />
            <span>Auto-Scan Agent</span>
          </button>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={loadData}
            className="btn-ghost"
            style={{ height: 34, padding: "0 12px", fontSize: 12.5 }}
            title="Refresh events from server"
          >
            <RotateCcw size={13} strokeWidth={2} /> Refresh
          </button>

          {canEdit && (
            <button
              onClick={() => setScheduling(true)}
              className="btn-primary"
              style={{ height: 34, padding: "0 14px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
            >
              <CalendarClock size={14} strokeWidth={2} /> Schedule Event
            </button>
          )}
        </div>
      </div>

      {/* Main View: Calendar Tab */}
      {activeTab === "calendar" && (
        <>
          {/* Subheader: Month Nav & Filter Chips */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "12px 18px",
            }}
          >
            {/* Month selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}
                className="btn-ghost"
                style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <ChevronLeft size={16} strokeWidth={2} />
              </button>
              <div style={{ fontWeight: 700, fontSize: 16, minWidth: 140, textAlign: "center", color: "var(--text-primary)" }}>
                {monthLabel}
              </div>
              <button
                onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
                className="btn-ghost"
                style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
              <button
                onClick={() => setMonthCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
                className="btn-ghost"
                style={{ height: 30, padding: "0 12px", fontSize: 12 }}
              >
                Today
              </button>
            </div>

            {/* Filter Pills */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginRight: 2 }}>Filter:</span>
              {[
                { id: "all", label: "All" },
                { id: "branch_visit", label: "🏢 Branch Visits" },
                { id: "callback", label: "📞 Callbacks" },
                { id: "document_deadline", label: "📄 Deadlines" },
                { id: "reminder", label: "⏰ Reminders" },
              ].map((f) => {
                const active = typeFilter === f.id
                return (
                  <button
                    key={f.id}
                    onClick={() => setTypeFilter(f.id)}
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: "4px 10px",
                      borderRadius: 999,
                      cursor: "pointer",
                      background: active ? "var(--overlay-chip)" : "transparent",
                      color: active ? "var(--text-primary)" : "var(--text-muted)",
                      border: active ? "1px solid var(--accent-violet)" : "1px solid var(--border-light)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Metrics summary banner */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: "var(--overlay-chip)", color: "var(--text-secondary)", border: "1px solid var(--border-light)" }}>
              {visibleEvents.length} Total in {monthCursor.toLocaleDateString([], { month: "short" })}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: "rgba(16, 185, 129, 0.12)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.28)" }}>
              🏢 {branchVisitsCount} Branch Visits
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: "rgba(59, 130, 246, 0.12)", color: "#3b82f6", border: "1px solid rgba(59, 130, 246, 0.28)" }}>
              📞 {callbacksCount} Callbacks
            </span>
            {deadlinesCount > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: "rgba(168, 85, 247, 0.12)", color: "#a855f7", border: "1px solid rgba(168, 85, 247, 0.28)" }}>
                📄 {deadlinesCount} Deadlines
              </span>
            )}
            {reviewEvents.length > 0 && (
              <button
                onClick={() => setActiveTab("review")}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "rgba(245, 158, 11, 0.14)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                ⚠️ {reviewEvents.length} Pending AI Review →
              </button>
            )}
          </div>

          {/* Calendar Desktop Grid */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }} className="hidden md:block">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border)" }}>
              {WEEKDAY_LABELS.map((w) => (
                <div key={w} style={{ padding: "10px 8px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textAlign: "center", letterSpacing: "0.06em" }}>
                  {w.toUpperCase()}
                </div>
              ))}
            </div>

            {loading && <SkeletonList rows={5} />}

            {!loading && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                {cells.map((d, i) => {
                  const key = toDateKey(d)
                  const inMonth = d.getMonth() === monthCursor.getMonth()
                  const isToday = key === todayKey
                  const dayEvents = eventsByDay[key] || []
                  return (
                    <div
                      key={key}
                      style={{
                        minHeight: 112,
                        padding: "8px 6px",
                        borderRight: "1px solid var(--border-light)",
                        borderBottom: "1px solid var(--border-light)",
                        opacity: inMonth ? 1 : 0.3,
                        background: isToday ? "rgba(139,124,255,0.02)" : "transparent",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: isToday ? 700 : 500,
                          color: isToday ? "var(--accent-violet)" : "var(--text-secondary)",
                          marginBottom: 6,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: isToday ? 24 : "auto",
                          height: isToday ? 24 : "auto",
                          borderRadius: isToday ? "50%" : 0,
                          background: isToday ? "rgba(139,124,255,0.2)" : "transparent",
                        }}
                      >
                        {d.getDate()}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {dayEvents.map((ev) => {
                          const cfg = TYPE_CONFIG[ev.event_type] || TYPE_CONFIG.reminder
                          const Icon = cfg.icon
                          const timeStr = formatTimeIST(ev.event_at)
                          return (
                            <button
                              key={ev.id}
                              onClick={() => {
                                setSelected(ev)
                                setRescheduleMode(false)
                              }}
                              style={{
                                textAlign: "left",
                                background: cfg.bg,
                                color: cfg.color,
                                border: `1px solid ${cfg.border}`,
                                borderRadius: 6,
                                padding: "3px 6px",
                                fontSize: 11,
                                fontWeight: 500,
                                cursor: "pointer",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                              title={`${cfg.label} — ${timeStr} ${ev.lead_name || ev.title}`}
                            >
                              <Icon size={11} style={{ flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, flexShrink: 0 }}>{timeStr}</span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                                {ev.lead_name || ev.title}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Mobile Agenda List */}
          <div className="md:hidden" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {loading && (
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <SkeletonList rows={4} />
              </div>
            )}
            {!loading && visibleEvents.length === 0 && (
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 28, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No events found for this month.
              </div>
            )}
            {!loading &&
              visibleEvents.map((ev) => {
                const cfg = TYPE_CONFIG[ev.event_type] || TYPE_CONFIG.reminder
                const Icon = cfg.icon
                return (
                  <button
                    key={ev.id}
                    onClick={() => {
                      setSelected(ev)
                      setRescheduleMode(false)
                    }}
                    style={{
                      textAlign: "left",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "12px 14px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: cfg.bg,
                          color: cfg.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={16} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {ev.lead_name || ev.title}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 1 }}>
                          {cfg.label} {ev.lead_phone ? `• ${ev.lead_phone}` : ""}
                        </div>
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: cfg.color, textAlign: "right" }}>
                      {formatIST(ev.event_at)}
                    </div>
                  </button>
                )
              })}
          </div>
        </>
      )}

      {/* Main View: AI Review Queue Tab */}
      {activeTab === "review" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: "18px 22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldCheck size={18} color="#f59e0b" />
                <span>AI Review Queue ({reviewEvents.length} items)</span>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "4px 0 0" }}>
                Appointments & callbacks detected with moderate confidence or ambiguous phrasing require agent verification before confirmation.
              </p>
            </div>
            <button onClick={loadData} className="btn-ghost" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
              <RotateCcw size={12.5} strokeWidth={2} /> Refresh Queue
            </button>
          </div>

          {reviewEvents.length === 0 ? (
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "48px 24px",
                textAlign: "center",
              }}
            >
              <CheckCircle2 size={36} color="#10b981" style={{ margin: "0 auto 12px" }} />
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>Review Queue is Clear!</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                All high-confidence events have been auto-scheduled, and no ambiguous items are pending review.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {reviewEvents.map((item) => {
                const cfg = TYPE_CONFIG[item.event_type] || TYPE_CONFIG.reminder
                const Icon = cfg.icon
                const isWorking = actionInProgress === item.id
                return (
                  <div
                    key={item.id}
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      borderRadius: 14,
                      padding: 18,
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            background: cfg.bg,
                            color: cfg.color,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon size={18} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                            {item.title}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                            Customer: <strong style={{ color: "var(--text-secondary)" }}>{item.lead_name || "Unknown"}</strong> {item.lead_phone ? `(${item.lead_phone})` : ""}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: item.confidence === "medium" ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)",
                            color: item.confidence === "medium" ? "#f59e0b" : "#ef4444",
                            border: `1px solid ${item.confidence === "medium" ? "rgba(245, 158, 11, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                            textTransform: "uppercase",
                          }}
                        >
                          {item.confidence} Confidence ({(item.confidence_score * 100).toFixed(0)}%)
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: cfg.bg,
                            color: cfg.color,
                            border: `1px solid ${cfg.border}`,
                          }}
                        >
                          {cfg.label}
                        </span>
                      </div>
                    </div>

                    {/* Detected Event Time & Location */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: 10,
                        background: "var(--bg-secondary)",
                        borderRadius: 10,
                        padding: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Proposed Schedule (IST)</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                          {formatIST(item.event_at)}
                        </div>
                      </div>
                      {item.location && (
                        <div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Location / Branch</div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
                            {item.location}
                          </div>
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>Source Origin</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          Voice Call #{item.source_id.slice(-8)} • {formatIST(item.source_at)}
                        </div>
                      </div>
                    </div>

                    {/* Verbatim Raw Quote Evidence */}
                    {item.raw_quote && (
                      <div
                        style={{
                          background: "rgba(139, 124, 255, 0.08)",
                          borderLeft: "3px solid var(--accent-violet)",
                          padding: "10px 14px",
                          borderRadius: "0 8px 8px 0",
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-violet)", marginBottom: 4 }}>
                          Transcript Quote Evidence:
                        </div>
                        <div style={{ fontSize: 12.5, fontStyle: "italic", color: "var(--text-secondary)" }}>
                          &ldquo;{item.raw_quote}&rdquo;
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button
                        disabled={isWorking}
                        onClick={() => handleReject(item.id)}
                        className="btn-ghost"
                        style={{ height: 34, fontSize: 12.5, color: "var(--accent-red)" }}
                      >
                        Dismiss / False Positive
                      </button>
                      <button
                        disabled={isWorking}
                        onClick={() => {
                          setSelected(item)
                          setRescheduleMode(true)
                          setRescheduleDateTime(toLocalDatetimeInput(item.event_at))
                        }}
                        className="btn-ghost"
                        style={{ height: 34, fontSize: 12.5 }}
                      >
                        Adjust Date & Confirm
                      </button>
                      <button
                        disabled={isWorking}
                        onClick={() => handleApprove(item.id)}
                        className="btn-primary"
                        style={{ height: 34, padding: "0 16px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}
                      >
                        <Check size={14} /> Approve & Confirm
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Main View: Auto-Scan Agent Tab */}
      {activeTab === "scanner" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: "24px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "#10b981",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Sparkles size={18} />
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Automatic Calendar Agent Scanner</h3>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "3px 0 0" }}>
                  Autonomous extraction engine that audits customer call transcripts, resolves Telugu & English temporal commitments, and schedules verified appointments.
                </p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 14,
                marginTop: 20,
                marginBottom: 20,
              }}
            >
              <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 6 }}>
                  1. Multi-turn Temporal Resolution
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Understands Telugu & English expressions (e.g. &ldquo;repu morning 11 ki&rdquo;, &ldquo;next Thursday&rdquo;) anchored to the call timestamp in IST (+5:30).
                </div>
              </div>

              <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 6 }}>
                  2. Strict Purpose Separation
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Branch visits are recorded as in-person appointments and <strong>never dialed</strong>. Callbacks are synchronized with the Call Queue.
                </div>
              </div>

              <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 6 }}>
                  3. AI Confidence & Safeguards
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Explicit dates are auto-confirmed. Vague promises (e.g. &ldquo;maybe tomorrow&rdquo;) route to the Human Review Queue.
                </div>
              </div>
            </div>

            {/* Scan Controls */}
            {canScan && (
              <div
                style={{
                  background: "var(--bg-secondary)",
                  borderRadius: 12,
                  padding: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div>
                    <label style={{ fontSize: 11.5, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                      Batch Size
                    </label>
                    <select
                      value={scanLimit}
                      onChange={(e) => setScanLimit(Number(e.target.value))}
                      style={{ height: 34, fontSize: 12.5, minWidth: 100 }}
                    >
                      <option value={10}>10 Calls</option>
                      <option value={25}>25 Calls</option>
                      <option value={50}>50 Calls</option>
                      <option value={100}>100 Calls</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
                    <input
                      type="checkbox"
                      id="dryRunCheck"
                      checked={scanDryRun}
                      onChange={(e) => setScanDryRun(e.target.checked)}
                      style={{ cursor: "pointer", width: 15, height: 15 }}
                    />
                    <label htmlFor="dryRunCheck" style={{ fontSize: 12.5, cursor: "pointer", color: "var(--text-secondary)" }}>
                      Dry-Run Preview (inspect without saving)
                    </label>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    disabled={scanning}
                    onClick={() => triggerScan(true)}
                    className="btn-ghost"
                    style={{ height: 36, padding: "0 16px", fontSize: 13 }}
                  >
                    Dry-Run Preview
                  </button>
                  <button
                    disabled={scanning}
                    onClick={() => triggerScan(false)}
                    className="btn-primary"
                    style={{ height: 36, padding: "0 18px", fontSize: 13, display: "flex", alignItems: "center", gap: 7 }}
                  >
                    <Play size={14} />
                    {scanning ? "Scanning Calls…" : "Run Full AI Sync"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Scan Results Display */}
          {scanResult && (
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  Scan Result {scanResult.dryRun ? "(Dry Run Preview)" : "(Saved to Database)"}
                </div>
                <button onClick={() => setScanResult(null)} className="btn-ghost" style={{ height: 28, padding: "0 8px" }}>
                  <X size={15} />
                </button>
              </div>

              {/* Stats badges */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ background: "var(--bg-secondary)", padding: "10px 14px", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Calls Processed</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{scanResult.processedCount}</div>
                </div>
                <div style={{ background: "rgba(16, 185, 129, 0.12)", padding: "10px 14px", borderRadius: 8, color: "#10b981" }}>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>Events Detected</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{scanResult.eventsCreated}</div>
                </div>
                <div style={{ background: "rgba(245, 158, 11, 0.12)", padding: "10px 14px", borderRadius: 8, color: "#f59e0b" }}>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>Sent to Review Queue</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{scanResult.needsReview}</div>
                </div>
                <div style={{ background: "var(--bg-secondary)", padding: "10px 14px", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Skipped (No Schedule Intent)</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{scanResult.skippedCount}</div>
                </div>
              </div>

              {/* Details breakdown */}
              {scanResult.details && scanResult.details.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" }}>Discovered Events:</div>
                  {scanResult.details.map((d, idx) => {
                    const allFound = [...d.highConfidenceEvents, ...d.reviewEvents]
                    return (
                      <div
                        key={idx}
                        style={{
                          background: "var(--bg-secondary)",
                          borderRadius: 8,
                          padding: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span>
                            <strong>{d.leadName || "Lead"}</strong> ({d.phone || "No phone"}) • Call #{d.callSid.slice(-8)}
                          </span>
                          <span style={{ color: "var(--text-muted)" }}>{d.durationMs}ms</span>
                        </div>
                        {allFound.map((ev, i) => (
                          <div
                            key={(ev as any).id || `${ev.eventType || 'ev'}-${ev.eventAt || ''}-${i}`}
                            style={{
                              fontSize: 12,
                              padding: "4px 8px",
                              borderRadius: 4,
                              background: ev.confidence === "high" ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)",
                              color: ev.confidence === "high" ? "#10b981" : "#f59e0b",
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span>
                              [{ev.eventType}] {ev.title} @ {formatIST(ev.eventAt)}
                            </span>
                            <span>&ldquo;{ev.rawQuote}&rdquo;</span>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Event Detail Modal */}
      {selected && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backdropFilter: "blur(2px)",
          }}
          onClick={() => {
            setSelected(null)
            setRescheduleMode(false)
          }}
        >
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 24,
              width: "min(480px, calc(100vw - 32px))",
              maxHeight: "calc(100vh - 48px)",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: TYPE_CONFIG[selected.event_type]?.bg,
                      color: TYPE_CONFIG[selected.event_type]?.color,
                      border: `1px solid ${TYPE_CONFIG[selected.event_type]?.border}`,
                    }}
                  >
                    {TYPE_CONFIG[selected.event_type]?.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background:
                        selected.status === "confirmed"
                          ? "rgba(16, 185, 129, 0.15)"
                          : selected.status === "cancelled"
                          ? "rgba(239, 68, 68, 0.15)"
                          : selected.status === "completed"
                          ? "rgba(59, 130, 246, 0.15)"
                          : "rgba(245, 158, 11, 0.15)",
                      color:
                        selected.status === "confirmed"
                          ? "#10b981"
                          : selected.status === "cancelled"
                          ? "#ef4444"
                          : selected.status === "completed"
                          ? "#3b82f6"
                          : "#f59e0b",
                    }}
                  >
                    {selected.status.replace("_", " ").toUpperCase()}
                  </span>
                </div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{selected.title}</h3>
              </div>
              <button
                onClick={() => {
                  setSelected(null)
                  setRescheduleMode(false)
                }}
                aria-label="Close"
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}
              >
                <X size={19} strokeWidth={2} />
              </button>
            </div>

            {/* Details List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>Customer</div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {selected.lead_name || "Unassigned"} {selected.lead_phone ? `• ${selected.lead_phone}` : ""}
                </div>
              </div>

              <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>Scheduled Time (IST)</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--accent-violet)" }}>
                  {formatIST(selected.event_at)}
                </div>
              </div>

              {selected.location && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>Location</div>
                  <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                    <MapPin size={13} color="#10b981" /> {selected.location}
                  </div>
                </div>
              )}

              {/* Event Type Behavior Note */}
              {selected.event_type === "branch_visit" && (
                <div style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.25)", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 12, color: "#10b981", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    <Building2 size={14} /> In-Person Appointment
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 2 }}>
                    This appointment represents a visit to the branch and is protected from automated outbound phone calls.
                  </div>
                </div>
              )}

              {selected.raw_quote && (
                <div style={{ background: "rgba(139, 124, 255, 0.08)", border: "1px solid rgba(139, 124, 255, 0.25)", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--accent-violet)", fontWeight: 600 }}>AI Evidence Quote:</div>
                  <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--text-secondary)", marginTop: 2 }}>
                    &ldquo;{selected.raw_quote}&rdquo;
                  </div>
                </div>
              )}

              {selected.notes && (() => {
                const hasTimeline = selected.notes.includes("--- CONSOLIDATED LEAD TIMELINE")
                const [primaryNotes, timelineRaw] = hasTimeline
                  ? selected.notes.split("--- CONSOLIDATED LEAD TIMELINE (ALL INTERACTIONS AT ONE POINT) ---")
                  : [selected.notes, ""]
                const timelineLines = timelineRaw
                  ? timelineRaw.split("\n").map(l => l.trim()).filter(l => l.startsWith("•"))
                  : []

                return (
                  <>
                    {primaryNotes.trim() && (
                      <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>Notes</div>
                        <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>{primaryNotes.trim()}</div>
                      </div>
                    )}

                    {timelineLines.length > 0 && (
                      <div style={{ background: "rgba(139, 92, 246, 0.05)", border: "1px solid rgba(139, 92, 246, 0.2)", borderRadius: 8, padding: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--accent-violet)", fontWeight: 700, fontSize: 12 }}>
                          <History size={14} />
                          <span>Unified Interaction Timeline ({timelineLines.length} points consolidated)</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {timelineLines.map((line, idx) => {
                            const isVoice = line.includes("Voice Call")
                            const isWhatsApp = line.includes("WhatsApp")
                            return (
                              <div
                                key={idx}
                                style={{
                                  fontSize: 11.5,
                                  lineHeight: 1.45,
                                  padding: "6px 8px",
                                  borderRadius: 6,
                                  background: "var(--bg-card)",
                                  border: "1px solid var(--border)",
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 6
                                }}
                              >
                                <span style={{ marginTop: 2, display: "inline-flex", flexShrink: 0 }}>
                                  {isVoice ? (
                                    <PhoneCall size={12} color="#8b5cf6" />
                                  ) : isWhatsApp ? (
                                    <MessageSquare size={12} color="#10b981" />
                                  ) : (
                                    <Clock size={12} color="#3b82f6" />
                                  )}
                                </span>
                                <span style={{ color: "var(--text-secondary)" }}>
                                  {line.replace(/^•\s*/, "")}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}

              {/* Reschedule inline form */}
              {rescheduleMode && (
                <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--accent-violet)", borderRadius: 8, padding: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", display: "block", marginBottom: 6 }}>
                    Pick New Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={rescheduleDateTime}
                    onChange={(e) => setRescheduleDateTime(e.target.value)}
                    style={{ width: "100%", marginBottom: 10 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setRescheduleMode(false)}
                      className="btn-ghost"
                      style={{ flex: 1, height: 32, fontSize: 12 }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleReschedule(selected.id, rescheduleDateTime)}
                      className="btn-primary"
                      style={{ flex: 1, height: 32, fontSize: 12 }}
                    >
                      Save Reschedule
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            {canEdit && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {selected.status === "needs_review" && (
                  <button
                    onClick={() => handleApprove(selected.id)}
                    className="btn-primary"
                    style={{ height: 38, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <Check size={15} /> Approve & Confirm Appointment
                  </button>
                )}

                {/* For callbacks, offer Priya AI Dialing */}
                {selected.event_type === "callback" && selected.lead_id && canCall && (
                  <button
                    disabled={calling}
                    onClick={() => callWithPriya(selected.lead_id!)}
                    className="btn-primary"
                    style={{ height: 38, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13 }}
                  >
                    <PhoneCall size={14} strokeWidth={2} /> {calling ? "Dialing…" : "Call with Priya"}
                  </button>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selected.lead_phone && (
                    <a
                      href={`tel:${selected.lead_phone}`}
                      className="btn-ghost"
                      style={{ flex: 1, height: 34, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, textDecoration: "none" }}
                    >
                      <Phone size={13} strokeWidth={2} /> Phone Call
                    </a>
                  )}

                  {!rescheduleMode && (
                    <button
                      onClick={() => {
                        setRescheduleMode(true)
                        setRescheduleDateTime(toLocalDatetimeInput(selected.event_at))
                      }}
                      className="btn-ghost"
                      style={{ flex: 1, height: 34, fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                    >
                      <Edit2 size={13} /> Reschedule
                    </button>
                  )}

                  <button
                    onClick={() => handleCancel(selected.id)}
                    className="btn-ghost"
                    style={{ flex: 1, height: 34, fontSize: 12.5, color: "var(--accent-red)" }}
                  >
                    Cancel Event
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual Schedule Modal */}
      {scheduling && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backdropFilter: "blur(2px)",
          }}
          onClick={() => setScheduling(false)}
        >
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 24,
              width: "min(460px, calc(100vw - 32px))",
              maxHeight: "calc(100vh - 48px)",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Schedule Calendar Event</div>
              <button onClick={() => setScheduling(false)} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}>
                <X size={19} strokeWidth={2} />
              </button>
            </div>

            {/* Event Type selector */}
            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Event Type</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              {[
                { type: "branch_visit", label: "🏢 Branch Visit", desc: "In-person meeting" },
                { type: "callback", label: "📞 Callback", desc: "Queues phone call" },
                { type: "document_deadline", label: "📄 Doc Deadline", desc: "ITR / KYC tracking" },
                { type: "reminder", label: "⏰ Reminder", desc: "General follow-up" },
              ].map((t) => {
                const active = scheduleType === t.type
                return (
                  <button
                    key={t.type}
                    type="button"
                    onClick={() => setScheduleType(t.type as CalendarEventType)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      textAlign: "left",
                      cursor: "pointer",
                      background: active ? "var(--overlay-chip)" : "var(--bg-secondary)",
                      border: active ? "1.5px solid var(--accent-violet)" : "1px solid var(--border)",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{t.label}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{t.desc}</div>
                  </button>
                )
              })}
            </div>

            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Customer / Lead</label>
            <select
              value={scheduleLeadId}
              onChange={(e) => setScheduleLeadId(e.target.value)}
              style={{ width: "100%", marginBottom: 14 }}
            >
              <option value="">Select a customer…</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {l.phone}
                </option>
              ))}
            </select>

            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Date & Time</label>
            <input
              type="datetime-local"
              value={scheduleDateTime}
              onChange={(e) => setScheduleDateTime(e.target.value)}
              style={{ width: "100%", marginBottom: 14 }}
            />

            {scheduleType === "branch_visit" && (
              <>
                <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Branch / Meeting Location</label>
                <input
                  type="text"
                  placeholder="e.g. Hyderabad Main Branch / Banjara Hills"
                  value={scheduleLocation}
                  onChange={(e) => setScheduleLocation(e.target.value)}
                  style={{ width: "100%", marginBottom: 14 }}
                />
              </>
            )}

            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Notes (Optional)</label>
            <textarea
              value={scheduleNote}
              onChange={(e) => setScheduleNote(e.target.value)}
              placeholder="e.g. Discuss loan tenure, verify original bank statements"
              rows={2}
              style={{
                width: "100%",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                borderRadius: 8,
                padding: 10,
                fontSize: 13,
                resize: "vertical",
                marginBottom: 16,
              }}
            />

            <button
              disabled={saving || !scheduleLeadId || !scheduleDateTime}
              onClick={handleCreateEvent}
              className="btn-primary"
              style={{ width: "100%", height: 38, fontSize: 13 }}
            >
              {saving ? "Scheduling…" : "Save Appointment"}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
