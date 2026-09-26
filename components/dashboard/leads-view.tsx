"use client"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
import { useEffect, useState, useMemo } from "react"
import { Users, Target, IndianRupee, BadgeCheck, Phone, MessageCircle, RotateCcw, Plus, Search, Link2, Check, Download, Brain, Pin, Square, CheckSquare, PhoneCall, X } from "lucide-react"
import { formatCurrency, timeAgo, formatDateTime } from "@/lib/utils"
import { usePolling } from "@/lib/use-poll"
import { useToast } from "../ui/toast"
import { Skeleton } from "../ui/skeleton"
import LeadMemoryModal from "./lead-memory-modal"
import VoiceDictation from "../ui/voice-dictation"
import { smartFilter } from "@/lib/smart-search"

import { PRODUCT_GROUPS, LOAN_TYPES } from "@/lib/products"

type Lead = {
  id: string; name: string; phone: string; address: string; whatsapp_number: string
  product_interest: string; status: string; interested: string; loan_amount: number; language: string
  call_count: number; created_at: string; updated_at: string; score: number
  form_token: string | null; form_used_at: string | null; form_sent_at: string | null
  form_completed: boolean
  pinned?: boolean; pinned_at?: string | null
  // Short human-readable code (RAG-0001). Optional because a row fetched
  // before the 2026-07-31_lead_code migration has run won't carry one.
  lead_code?: string | null
}

// Short lead code (RAG-0042). Monospace so the digits line up down the
// column and staff can scan for one, and click-to-copy because the usual
// reason you look at it is to paste it somewhere or read it out on a call.
function LeadCodeBadge({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(e: React.MouseEvent) {
    // The row itself is clickable — copying a code should not also open the lead.
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard blocked (insecure origin / denied permission) — the code is
      // visible on screen either way, so there is nothing useful to surface.
    }
  }

  return (
    <button
      onClick={copy}
      title={copied ? "Copied" : `Copy ${code}`}
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        letterSpacing: 0.3,
        background: copied ? "rgba(34,197,94,0.15)" : "var(--overlay-hover)",
        border: `1px solid ${copied ? "var(--accent-green)" : "var(--border)"}`,
        color: copied ? "var(--accent-green)" : "var(--text-secondary)",
        borderRadius: 5,
        padding: "1px 6px",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {copied ? "Copied" : code}
    </button>
  )
}

// Shows exactly what the WhatsApp form link is doing for this lead:
// nothing sent yet / sent & waiting / submitted. Click copies the link.
function FormLinkCell({ lead }: { lead: Lead }) {
  const [copied, setCopied] = useState(false)
  if (!lead.form_token) return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>

  const submitted = lead.form_completed || !!lead.form_used_at
  const tone = submitted ? "var(--accent-green)" : "var(--accent-yellow)"
  const label = submitted ? "Submitted" : "Sent"

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/form/${lead.form_token}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <button
      onClick={copy}
      title={copied ? "Link copied!" : `Copy form link — sent ${timeAgo(lead.form_sent_at || "")}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: `${tone}14`, border: `1px solid ${tone}3d`, color: tone,
        borderRadius: 8, padding: "4px 10px", fontSize: 11.5, fontWeight: 600,
      }}
    >
      {copied ? <Check size={12} strokeWidth={2.2} /> : <Link2 size={12} strokeWidth={2} />}
      {copied ? "Copied" : label}
    </button>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 70 ? "var(--accent-green)" : score >= 40 ? "var(--accent-yellow)" : "var(--text-muted)"
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--overlay-chip)", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: tone, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums" }}>{score}</span>
    </div>
  )
}

const INTERESTED_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  interested:     { bg: "rgba(34,197,94,0.15)",  color: "var(--accent-green)", label: "Interested" },
  not_interested: { bg: "rgba(239,68,68,0.15)",  color: "var(--accent-red)", label: "Not Interested" },
  unknown:        { bg: "rgba(100,116,139,0.15)",color: "var(--text-secondary)", label: "Unknown" },
}

// Tinted fill + accent-coloured initials rather than white-on-solid-accent:
// the bright accents (cyan, green, yellow) only reach ~2:1 against white
// text, and any accent dark enough to fix that in one theme breaks another.
// A tint of the accent keeps the per-lead colour coding and stays legible
// in all four themes.
function Avatar({ name }: { name: string }) {
  const initials = (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
  const colors = ["var(--accent-blue)", "var(--accent-violet)", "var(--accent-cyan)", "var(--accent-green)", "var(--accent-yellow)"]
  const color = colors[(name || "?").charCodeAt(0) % colors.length]
  return (
    <div style={{ width: 36, height: 36, borderRadius: "50%", background: `color-mix(in oklab, ${color} 18%, transparent)`, border: `1px solid color-mix(in oklab, ${color} 32%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color, flexShrink: 0 }}>
      {initials}
    </div>
  )
}

export default function LeadsView({ role, initialSearch }: { role: Role; initialSearch?: string }) {
  const canEdit = role !== "viewer"
  const toast = useToast()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState(initialSearch || "")
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch || "")

  // Command-palette jumps re-seed the search box.
  useEffect(() => { if (initialSearch !== undefined) setSearch(initialSearch) }, [initialSearch])

  // Debounce typed search input so fast typing doesn't fire a fetch per
  // keystroke — those out-of-order responses could otherwise clobber
  // the list with results for an already-stale query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])
  const [ageFilter, setAgeFilter] = useState("all")
  const [amountFilter, setAmountFilter] = useState("all")
  const [loanTypeFilter, setLoanTypeFilter] = useState("all")
  const [interestedFilter, setInterestedFilter] = useState("all")

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: "", phone: "", address: "", product_interest: "Home Loan", loan_amount: "", language: "telugu" })

  const [callTarget, setCallTarget] = useState<Lead | null>(null)
  const [callInstructions, setCallInstructions] = useState("")
  const [calling, setCalling] = useState<string | null>(null)

  const [waTarget, setWaTarget] = useState<Lead | null>(null)
  const [waText, setWaText] = useState("")
  const [waSending, setWaSending] = useState(false)

  const [memoryLeadId, setMemoryLeadId] = useState<string | null>(null)

  // ── Bulk call-queue selection (2026-09-26 bulk upgrade) ─────────────
  // Row checkboxes + floating action bar + the Add-to-Call-Queue modal.
  // DND / duplicate / recently-called protections are enforced SERVER-side
  // by /api/outbound/queue — the modal only states them, it doesn't
  // pre-filter (the server is the source of truth).
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showQueueModal, setShowQueueModal] = useState(false)
  const [queueBusy, setQueueBusy] = useState(false)
  const [queueForm, setQueueForm] = useState<{ channel: string; timing: "now" | "later"; scheduledAt: string; language: string }>({
    channel: "phone", timing: "now", scheduledAt: "", language: "auto",
  })

  // Prune selections that no longer exist (lead deleted / filter changed) —
  // keeps the action-bar count honest without blocking cross-filter batch picks.
  useEffect(() => {
    setSelectedIds((prev) => {
      const alive = new Set(leads.map((l) => l.id))
      const next = prev.filter((id) => alive.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [leads])

  const displayLeads = useMemo(() => {
    return smartFilter(leads, search, (l) => [
      l.name,
      l.phone,
      l.whatsapp_number,
      l.product_interest,
      l.address,
      l.lead_code,
      l.status,
    ])
  }, [leads, search])

  // Derived AFTER displayLeads (it reads the filtered list).
  const allSelected = displayLeads.length > 0 && displayLeads.every((l) => selectedIds.includes(l.id))
  function toggleAll() {
    setSelectedIds((prev) => (allSelected ? prev.filter((id) => !displayLeads.some((l) => l.id === id)) : [...new Set([...prev, ...displayLeads.map((l) => l.id)])]))
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function addSelectedToQueue() {
    setQueueBusy(true)
    try {
      const res = await fetch("/api/outbound/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds: selectedIds,
          channel: queueForm.channel,
          scheduledAt: queueForm.timing === "later" && queueForm.scheduledAt ? new Date(queueForm.scheduledAt).toISOString() : null,
          language: queueForm.language,
        }),
      })
      const d = await res.json()
      if (res.ok) {
        const skips = [
          d.skippedDnd ? `${d.skippedDnd} DND/do-not-call` : "",
          d.skippedRecent ? `${d.skippedRecent} recently-called` : "",
          d.skippedDuplicate ? `${d.skippedDuplicate} duplicate` : "",
        ].filter(Boolean).join(", ")
        toast.success(`Queued ${d.queuedCount} call${d.queuedCount === 1 ? "" : "s"}${skips ? ` — skipped: ${skips}` : ""}. Manage them in Call Queue.`)
        setShowQueueModal(false)
        setSelectedIds([])
      } else {
        toast.error(d.error || "Queueing failed")
      }
    } catch {
      toast.error("Queueing failed — check your connection and try again")
    }
    setQueueBusy(false)
  }

  async function load(silent = false) {
    if (!silent) setLoading(true)
    const params = new URLSearchParams()
    if (debouncedSearch) params.set("search", debouncedSearch)
    if (ageFilter !== "all") params.set("age", ageFilter)
    if (amountFilter !== "all") params.set("amount", amountFilter)
    if (loanTypeFilter !== "all") params.set("loanType", loanTypeFilter)
    if (interestedFilter !== "all") params.set("interested", interestedFilter)
    try {
      const res = await fetch(`/api/leads?${params.toString()}`)
      if (res.ok) {
        setLeads(await res.json())
        setLoadError(null)
      } else {
        // A failed fetch is NOT "no leads" — say so, or a server bug reads
        // as an empty pipeline (same trap loan-apps-view documents).
        setLoadError(`Could not load leads (HTTP ${res.status}). Check server logs.`)
      }
    } catch (e: any) {
      setLoadError(e?.message || "Could not load leads")
    } finally {
      setLoading(false)
    }
  }

  async function togglePin(lead: Lead) {
    const nextPinned = !lead.pinned
    // Optimistic — re-sort locally so pinning feels instant instead of
    // waiting for the next full reload.
    setLeads(prev => {
      const updated = prev.map(l => l.id === lead.id ? { ...l, pinned: nextPinned, pinned_at: nextPinned ? new Date().toISOString() : null } : l)
      return [...updated].sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        if (a.pinned && b.pinned) return (b.pinned_at || "").localeCompare(a.pinned_at || "")
        return 0 // leave everything else in the order the server gave us
      })
    })
    try {
      const res = await fetch(`/api/leads/${lead.id}/pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: nextPinned }) })
      if (!res.ok) throw new Error()
    } catch {
      toast.error("Couldn't update pin — refreshing")
      load()
    }
  }

  useEffect(() => {
    load()
  }, [debouncedSearch, ageFilter, amountFilter, loanTypeFilter, interestedFilter])

  useEffect(() => {
    const handler = () => load(true)
    window.addEventListener("rag:refresh", handler)
    return () => window.removeEventListener("rag:refresh", handler)
  }, [])

  // Background refresh — scores, statuses, form badges, and call counts
  // change from calls/WhatsApp/form submissions without any user action.
  // Each tick re-reads the current filters (usePolling calls the latest
  // closure), so it no longer needs its own deps list.
  usePolling(() => load(true), 15000)

  const totalLeads = leads.length
  const qualified = leads.filter((l) => l.status === "qualified").length
  // Pipeline value = sum of loan_amount only where it's a valid positive number
  const pipelineValue = leads.reduce((s, l) => {
    const amt = Number(l.loan_amount)
    return s + (isFinite(amt) && amt > 0 ? amt : 0)
  }, 0)
  const interestedCount = leads.filter((l) => l.interested === "interested").length

  async function startCall() {
    if (!callTarget) return
    setCalling(callTarget.id)
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: callTarget.id, phone: callTarget.phone, language: callTarget.language || "telugu", instructions: callInstructions }),
      })
      const data = await res.json()
      if (res.ok) { toast.success("AI call started — Priya is dialing now"); load() }
      else toast.error(data.error || "Call failed")
    } catch {
      // Network failure — surface it, the busy spinner must not just hang.
      toast.error("Call failed — check your connection and try again")
    } finally {
      setCalling(null)
      setCallTarget(null)
      setCallInstructions("")
    }
  }

  // Business-initiated WhatsApp call — Meta rings the lead's WhatsApp app;
  // the voicebot's WebRTC leg is identical to an inbound WhatsApp call.
  async function startWaCall() {
    if (!callTarget) return
    setCalling(`wa-${callTarget.id}`)
    try {
      const res = await fetch("/api/calls/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: callTarget.id, channel: "whatsapp" }),
      })
      const data = await res.json()
      if (res.ok) toast.success("WhatsApp call placed — ringing on the lead's WhatsApp now")
      else toast.error(data.error || "WhatsApp call failed")
    } catch {
      toast.error("WhatsApp call failed — check your connection and try again")
    } finally {
      setCalling(null)
      setCallTarget(null)
      setCallInstructions("")
    }
  }

  async function sendWa() {
    if (!waTarget || !waText.trim()) return
    setWaSending(true)
    const to = waTarget.whatsapp_number || waTarget.phone
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message: waText, leadId: waTarget.id }),
      })
      const data = await res.json()
      if (res.ok) { setWaTarget(null); setWaText(""); toast.success("WhatsApp message sent") }
      else toast.error(data.error === "WHATSAPP_NOT_CONFIGURED" ? data.message : data.error || "Send failed")
    } catch {
      // Network failure — surface it, the busy spinner must not just hang.
      toast.error("Send failed — check your connection and try again")
    } finally {
      setWaSending(false)
    }
  }

  async function addLead() {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, loan_amount: form.loan_amount ? parseFloat(form.loan_amount) : null, source: "manual" }),
    })
    if (res.ok) { setShowAdd(false); toast.success(`${form.name} added to leads`); load() }
    else { const d = await res.json().catch(() => ({})); toast.error(d.error || "Could not add lead") }
  }

  const Card = ({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone: string }) => (
    <div className="card" style={{ padding: "22px 24px", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: 12.5, fontWeight: 500, marginBottom: 8, letterSpacing: "0.01em" }}>{label}</div>
          <div style={{ fontSize: 27, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>{value}</div>
        </div>
        <div style={{
          width: 42, height: 42, background: `${tone}1f`, border: `1px solid ${tone}33`,
          borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={19} strokeWidth={1.9} style={{ color: tone }} />
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Card label="Total Leads" value={totalLeads.toLocaleString()} icon={Users} tone="var(--accent-violet)" />
        <Card label="Interested" value={interestedCount.toLocaleString()} icon={Target} tone="var(--accent-cyan)" />
        <Card label="Pipeline Value" value={formatCurrency(pipelineValue)} icon={IndianRupee} tone="var(--accent-yellow)" />
        <Card label="Qualified" value={qualified.toLocaleString()} icon={BadgeCheck} tone="var(--accent-green)" />
      </div>

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          {/* Single compact filter row */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", width: 230, display: "flex", alignItems: "center" }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input
                placeholder="Smart search name, phone, code (typo-tolerant)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: "100%", height: 34, fontSize: 12.5, paddingLeft: 30, paddingRight: 34 }}
              />
              <div style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)" }}>
                <VoiceDictation
                  onTranscript={(spoken) => setSearch(prev => (prev ? `${prev} ${spoken}` : spoken))}
                  size={14}
                  style={{ width: 28, height: 28, border: "none", background: "transparent" }}
                  title="Speak to search leads"
                />
              </div>
            </div>
            <select value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)} style={{ height: 34, fontSize: 12, width: 110 }}>
              <option value="all">All Ages</option>
              <option value="new">New (7d)</option>
              <option value="old">Older</option>
            </select>
            <select value={amountFilter} onChange={(e) => setAmountFilter(e.target.value)} style={{ height: 34, fontSize: 12, width: 130 }}>
              <option value="all">All Amounts</option>
              <option value="high">High (≥ ₹10L)</option>
              <option value="low">Low (&lt; ₹10L)</option>
            </select>
            <select value={loanTypeFilter} onChange={(e) => setLoanTypeFilter(e.target.value)} style={{ height: 34, fontSize: 12, width: 140 }}>
              <option value="all">All Loan Types</option>
              {LOAN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={interestedFilter} onChange={(e) => setInterestedFilter(e.target.value)} style={{ height: 34, fontSize: 12, width: 130 }}>
              <option value="all">All Statuses</option>
              <option value="interested">Interested</option>
              <option value="not_interested">Not Interested</option>
              <option value="unknown">Unknown</option>
            </select>
            {/* Refresh — resets all filters and reloads */}
            <button
              onClick={() => {
                setSearch("")
                setAgeFilter("all")
                setAmountFilter("all")
                setLoanTypeFilter("all")
                setInterestedFilter("all")
              }}
              title="Reset filters"
              className="icon-btn"
            ><RotateCcw size={14} strokeWidth={1.9} /></button>
            {/* Spacer */}
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{displayLeads.length} shown</div>
            <a href="/api/leads/export" className="btn-ghost" style={{ height: 34, textDecoration: "none" }} title="Export all leads as CSV">
              <Download size={14} strokeWidth={2} /> Export
            </a>
            {canEdit && (
              <button onClick={() => setShowAdd(true)} className="btn-primary" style={{ height: 34 }}>
                <Plus size={15} strokeWidth={2.2} /> Add Lead
              </button>
            )}
          </div>
        </div>

        {/* Horizontal scroll container — a 10-column table can't fit a phone
            screen; this keeps the overflow contained to the table itself
            instead of the whole page scrolling sideways. */}
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 820, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "12px 8px 12px 16px", width: 40, textAlign: "left" }}>
                {canEdit && displayLeads.length > 0 && (
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all shown leads" style={{ width: 15, height: 15, cursor: "pointer", accentColor: "var(--accent-violet)" }} />
                )}
              </th>
              {["LEAD", "SCORE", "ADDRESS", "LOAN TYPE", "VALUE", "STATUS", "FORM", "CALLS", "UPDATED", "ACTIONS"].map((h) => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <tr key={`sk-${i}`} style={{ borderBottom: "1px solid var(--border-light)" }}>
                <td style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Skeleton w={36} h={36} r={18} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <Skeleton w={110} h={12} />
                      <Skeleton w={80} h={10} />
                    </div>
                  </div>
                </td>
                <td style={{ padding: "14px 16px" }}><Skeleton w={16} h={16} r={4} /></td>
                {Array.from({ length: 9 }).map((_, j) => (
                  <td key={j} style={{ padding: "14px 16px" }}><Skeleton w={j === 8 ? 68 : 52} h={12} /></td>
                ))}
              </tr>
            ))}
            {!loading && loadError && (
              <tr>
                <td colSpan={11} style={{ padding: 32, textAlign: "center" }}>
                  <div style={{ color: "var(--accent-red)", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{loadError}</div>
                  <button onClick={() => load()} className="btn-ghost" style={{ height: 32, padding: "0 14px", fontSize: 12.5 }}>
                    <RotateCcw size={12.5} strokeWidth={1.9} /> Try again
                  </button>
                </td>
              </tr>
            )}
            {!loading && !loadError && displayLeads.length === 0 && (
              <tr><td colSpan={11} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No leads match these filters.</td></tr>
            )}
            {displayLeads.map((lead) => {
              const ist = INTERESTED_STYLES[lead.interested] ?? INTERESTED_STYLES.unknown
              return (
                <tr key={lead.id} style={{ borderBottom: "1px solid var(--border-light)", background: selectedIds.includes(lead.id) ? "rgba(139,124,255,0.05)" : undefined }}>
                  {canEdit && (
                    <td style={{ padding: "14px 8px 14px 16px" }}>
                      <input type="checkbox" checked={selectedIds.includes(lead.id)} onChange={() => toggleOne(lead.id)} title="Select for bulk call queue" style={{ width: 15, height: 15, cursor: "pointer", accentColor: "var(--accent-violet)" }} />
                    </td>
                  )}
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={lead.name} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                          {lead.pinned && <Pin size={12} strokeWidth={2.2} style={{ color: "var(--accent-yellow)", fill: "var(--accent-yellow)", flexShrink: 0 }} />}
                          {lead.name || "Unknown"}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                          {lead.lead_code && <LeadCodeBadge code={lead.lead_code} />}
                          <span>{lead.phone}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "14px 16px" }}><ScoreBadge score={lead.score ?? 0} /></td>
                  <td style={{ padding: "14px 16px", color: "var(--text-secondary)", fontSize: 13, maxWidth: 200 }}>{lead.address || "—"}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{ background: "rgba(59,130,246,0.12)", color: "var(--text-secondary)", borderRadius: 6, padding: "4px 10px", fontSize: 12 }}>{lead.product_interest || "—"}</span>
                  </td>
                  <td style={{ padding: "14px 16px", fontWeight: 600, fontSize: 13 }}>{lead.loan_amount ? formatCurrency(lead.loan_amount) : "—"}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{ background: ist.bg, color: ist.color, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>{ist.label}</span>
                  </td>
                  <td style={{ padding: "14px 16px" }}><FormLinkCell lead={lead} /></td>
                  <td style={{ padding: "14px 16px", fontSize: 13, color: "var(--text-secondary)" }}>{lead.call_count ?? 0}</td>
                  <td style={{ padding: "14px 16px", color: "var(--text-muted)", fontSize: 12 }}>
                    <div>{timeAgo(lead.updated_at || lead.created_at)}</div>
                    <div style={{ fontSize: 10.5, marginTop: 1 }}>{formatDateTime(lead.updated_at || lead.created_at)}</div>
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {canEdit && (
                        <>
                          <button
                            onClick={() => togglePin(lead)}
                            title={lead.pinned ? "Unpin" : "Pin to top"}
                            style={{ background: lead.pinned ? "rgba(247,183,49,0.15)" : "var(--overlay-hover)", border: `1px solid ${lead.pinned ? "rgba(247,183,49,0.35)" : "var(--border)"}`, color: lead.pinned ? "var(--accent-yellow)" : "var(--text-muted)", borderRadius: 9, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          ><Pin size={14} strokeWidth={1.9} style={lead.pinned ? { fill: "var(--accent-yellow)" } : undefined} /></button>
                          <button
                            onClick={() => { setCallTarget(lead); setCallInstructions("") }}
                            disabled={!lead.phone || calling === lead.id}
                            title="Call with AI"
                            style={{ background: "rgba(139,124,255,0.12)", border: "1px solid rgba(139,124,255,0.28)", color: "var(--accent-violet)", borderRadius: 9, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: calling === lead.id ? 0.5 : 1 }}
                          ><Phone size={14} strokeWidth={1.9} /></button>
                          <button
                            onClick={() => setWaTarget(lead)}
                            disabled={!lead.phone && !lead.whatsapp_number}
                            title="Send WhatsApp"
                            style={{ background: "rgba(45,212,160,0.1)", border: "1px solid rgba(45,212,160,0.28)", color: "var(--accent-green)", borderRadius: 9, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          ><MessageCircle size={14} strokeWidth={1.9} /></button>
                        </>
                      )}
                      <button
                        onClick={() => setMemoryLeadId(lead.id)}
                        title="View Lead Memory"
                        style={{ background: "rgba(247,183,49,0.1)", border: "1px solid rgba(247,183,49,0.28)", color: "var(--accent-yellow)", borderRadius: 9, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                      ><Brain size={14} strokeWidth={1.9} /></button>
                      {!canEdit && <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>View only</span>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Floating bulk-selection action bar */}
      {canEdit && selectedIds.length > 0 && !showQueueModal && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 900, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <CheckSquare size={15} strokeWidth={2} style={{ color: "var(--accent-violet)" }} />
            {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"} selected
          </span>
          <button onClick={() => setShowQueueModal(true)} className="btn-primary" style={{ height: 36 }}>
            <PhoneCall size={14} strokeWidth={2} /> Add to Call Queue
          </button>
          <button onClick={() => setSelectedIds([])} className="btn-ghost" style={{ height: 36 }}>
            <X size={14} strokeWidth={2} /> Clear
          </button>
        </div>
      )}

      {/* Add-to-Call-Queue modal */}
      {showQueueModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => !queueBusy && setShowQueueModal(false)}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 460 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Add {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"} to Call Queue</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 18 }}>Priya dials them through the bulk dialer — nothing is dialed until someone starts the queue.</div>

            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Dialing channel</label>
            <select value={queueForm.channel} onChange={(e) => setQueueForm({ ...queueForm, channel: e.target.value })} style={{ width: "100%", marginBottom: 14 }}>
              <option value="phone">📞 Standard Phone Call (Exotel)</option>
              <option value="whatsapp_voice">🟢 WhatsApp Voice Call (Meta)</option>
              <option value="auto">⚡ Auto — WhatsApp for recent callbacks, else phone</option>
            </select>

            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Preferred language</label>
            <select value={queueForm.language} onChange={(e) => setQueueForm({ ...queueForm, language: e.target.value })} style={{ width: "100%", marginBottom: 14 }}>
              <option value="auto">Auto-detect from lead profile</option>
              <option value="telugu">Force Telugu</option>
              <option value="hindi">Force Hindi</option>
              <option value="english">Force English</option>
            </select>

            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Execution timing</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={() => setQueueForm({ ...queueForm, timing: "now" })} style={{ flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12.5, border: "1px solid " + (queueForm.timing === "now" ? "rgba(139,124,255,0.5)" : "var(--border)"), background: queueForm.timing === "now" ? "rgba(139,124,255,0.12)" : "transparent", color: queueForm.timing === "now" ? "var(--accent-violet)" : "var(--text-secondary)", fontWeight: 600, cursor: "pointer" }}>⚡ Call immediately</button>
              <button onClick={() => setQueueForm({ ...queueForm, timing: "later" })} style={{ flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12.5, border: "1px solid " + (queueForm.timing === "later" ? "rgba(139,124,255,0.5)" : "var(--border)"), background: queueForm.timing === "later" ? "rgba(139,124,255,0.12)" : "transparent", color: queueForm.timing === "later" ? "var(--accent-violet)" : "var(--text-secondary)", fontWeight: 600, cursor: "pointer" }}>🕒 Schedule for later</button>
            </div>
            {queueForm.timing === "later" && (
              <input type="datetime-local" value={queueForm.scheduledAt} onChange={(e) => setQueueForm({ ...queueForm, scheduledAt: e.target.value })} style={{ width: "100%", marginBottom: 14 }} />
            )}

            <div style={{ fontSize: 11.5, color: "var(--text-muted)", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", marginBottom: 16, lineHeight: 1.6 }}>
              Automatic protections (always on): DND / do-not-call leads are skipped · numbers already pending in the queue are not stacked · numbers called in the last 24h are skipped · calling-window rules are enforced at dial time.
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowQueueModal(false)} disabled={queueBusy} style={{ flex: 1, padding: 10, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)" }}>Cancel</button>
              <button onClick={addSelectedToQueue} disabled={queueBusy || (queueForm.timing === "later" && !queueForm.scheduledAt)} className="btn-primary" style={{ flex: 1, height: 42 }}>
                <PhoneCall size={14} strokeWidth={2} /> {queueBusy ? "Queueing…" : `Queue ${selectedIds.length} call${selectedIds.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Lead modal */}
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 440 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Add New Lead</div>
            {[["name", "Full Name *"], ["phone", "Phone *"], ["address", "Address"], ["loan_amount", "Loan Amount (₹)"]].map(([k, l]) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>{l}</label>
                <div style={{ position: "relative" }}>
                  <input
                    value={(form as any)[k]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    style={{ width: "100%", paddingRight: (k === "name" || k === "address") ? 36 : undefined }}
                  />
                  {(k === "name" || k === "address") && (
                    <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                      <VoiceDictation onTranscript={(t: string) => setForm((prev) => ({ ...prev, [k]: (prev as any)[k] ? `${(prev as any)[k]} ${t}` : t }))} title={`Speak ${l}`} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Loan Type</label>
              <select value={form.product_interest} onChange={(e) => setForm({ ...form, product_interest: e.target.value })}>
                {PRODUCT_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.products.map((t) => <option key={t}>{t}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setShowAdd(false)} style={{ flex: 1, padding: 10, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)" }}>Cancel</button>
              <button onClick={addLead} disabled={!form.name || !form.phone} className="btn-primary" style={{ flex: 1, height: 40 }}>Add Lead</button>
            </div>
          </div>
        </div>
      )}

      {/* Call instructions modal */}
      {callTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 460 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Call {callTarget.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>{callTarget.phone}</div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>What should Priya talk about? (optional)</label>
            <div style={{ position: "relative" }}>
              <textarea
                value={callInstructions}
                onChange={(e) => setCallInstructions(e.target.value)}
                placeholder="e.g. Follow up on his home loan enquiry, mention the 8.4% rate offer"
                rows={4}
                style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 8, padding: "10px 36px 10px 10px", fontSize: 13, resize: "vertical" }}
              />
              <div style={{ position: "absolute", right: 8, top: 10 }}>
                <VoiceDictation onTranscript={(t: string) => setCallInstructions((prev) => prev ? `${prev} ${t}` : t)} title="Dictate call instructions" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setCallTarget(null)} style={{ flex: 1, padding: 10, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)" }}>Cancel</button>
              <button onClick={startCall} disabled={calling === callTarget.id} className="btn-primary" style={{ flex: 1, height: 40 }}>
                <Phone size={14} strokeWidth={2} /> {calling === callTarget.id ? "Calling…" : "Phone Call"}
              </button>
            </div>
            <button
              onClick={startWaCall}
              disabled={calling === `wa-${callTarget.id}` || calling === callTarget.id}
              style={{
                width: "100%", marginTop: 10, height: 40, borderRadius: 8,
                border: "1px solid var(--border)", cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                fontSize: 13, fontWeight: 600,
                background: calling === `wa-${callTarget.id}` ? "var(--bg-card)" : "#25D366",
                color: calling === `wa-${callTarget.id}` ? "var(--text-muted)" : "#06331d",
              }}
            >
              <Phone size={14} strokeWidth={2} /> {calling === `wa-${callTarget.id}` ? "Calling…" : "WhatsApp Call"}
            </button>
          </div>
        </div>
      )}

      {/* WhatsApp quick message modal */}
      {waTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 440 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Message {waTarget.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>{waTarget.whatsapp_number || waTarget.phone}</div>
            <div style={{ position: "relative" }}>
              <textarea
                value={waText}
                onChange={(e) => setWaText(e.target.value)}
                placeholder="Type a WhatsApp message…"
                rows={4}
                style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 8, padding: "10px 36px 10px 10px", fontSize: 13, resize: "vertical" }}
              />
              <div style={{ position: "absolute", right: 8, top: 10 }}>
                <VoiceDictation onTranscript={(t: string) => setWaText((prev) => prev ? `${prev} ${t}` : t)} title="Dictate WhatsApp message" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setWaTarget(null)} style={{ flex: 1, padding: 10, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)" }}>Cancel</button>
              <button onClick={sendWa} disabled={waSending || !waText.trim()} style={{ flex: 1, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "linear-gradient(135deg, var(--accent-green), var(--accent-green))", border: "none", borderRadius: 10, color: "white", fontWeight: 600, fontSize: 13, boxShadow: "0 4px 16px -4px rgba(45,212,160,0.45)", opacity: waSending || !waText.trim() ? 0.5 : 1 }}>
                <MessageCircle size={14} strokeWidth={2} /> {waSending ? "Sending…" : "Send Message"}
              </button>
            </div>
          </div>
        </div>
      )}

      {memoryLeadId && (
        <LeadMemoryModal leadId={memoryLeadId} canEdit={canEdit} onClose={() => setMemoryLeadId(null)} />
      )}
    </div>
  )
}
