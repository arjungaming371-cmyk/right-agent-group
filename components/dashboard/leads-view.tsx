"use client"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
import { useEffect, useState, useMemo } from "react"
import {
  Users, Target, IndianRupee, BadgeCheck, Phone, MessageCircle, MessageSquare, RotateCcw,
  Plus, Search, Link2, Check, Download, Upload, Brain, Pin, Sparkles, CheckSquare,
  PhoneCall, Instagram, X, ExternalLink, Clock, CheckCircle2, ArrowRight, Pencil, Landmark, AlertCircle, FileText
} from "lucide-react"
import { formatCurrency, timeAgo, formatDateTime } from "@/lib/utils"
import { pctOf } from "@/lib/maths"
import { usePolling, broadcastCrmSync } from "@/lib/use-poll"
import { useToast } from "../ui/toast"
import { useEscapeDismiss } from "../ui/interactive"
import { Skeleton } from "../ui/skeleton"
import LeadMemoryModal from "./lead-memory-modal"
import VoiceDictation from "../ui/voice-dictation"
import { smartFilter } from "@/lib/smart-search"
import { checkAgendaRules } from "@/lib/agenda-rules"

import { PRODUCT_GROUPS, LOAN_TYPES, COMMON_LOAN_TYPES } from "@/lib/products"
import { META_TEMPLATES_CATALOG } from "@/lib/meta-templates"

type Lead = {
  id: string; name: string; phone: string | null; address: string; whatsapp_number: string
  product_interest: string; status: string; interested: string; loan_amount: number; language: string
  call_count: number; created_at: string; updated_at: string; score: number
  form_token: string | null; form_used_at: string | null; form_sent_at: string | null
  form_completed: boolean
  pinned?: boolean; pinned_at?: string | null
  lead_code?: string | null
  loan_app_id?: string | null
  loan_status?: string | null
  loan_status_reason?: string | null
  loan_remarks?: string | null
  app_loan_type?: string | null
  app_loan_amount?: number | null
  // Instagram Separation (2026-09-26): lane fields. source/instagram_handle
  // power the IG-origin badge in the CRM tab; the prospect fields power the
  // Instagram Prospects tab. Optional so pre-migration rows render fine.
  source?: string | null
  instagram_handle?: string | null
  ig_user_id?: string | null
  is_social_prospect?: boolean
  promoted_to_crm_at?: string | null
  ig_phone_extracted?: string | null
  last_message?: string | null
  last_interaction_at?: string | null
  last_type?: string | null
  last_direction?: string | null
  notes?: string | null
}

function SocialAvatar({ name, handle }: { name?: string; handle?: string | null }) {
  const label = (handle || name || "IG").replace(/^@/, "")
  const initials = label.slice(0, 2).toUpperCase()
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #fd1d1d, #833ab4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
        boxShadow: "0 2px 5px rgba(225,48,108,0.2)",
        border: "1.5px solid rgba(255,255,255,0.15)",
      }}
    >
      {initials}
    </div>
  )
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
        fontSize: 10.5,
        letterSpacing: 0.3,
        background: copied ? "rgba(34,197,94,0.15)" : "var(--overlay-hover)",
        border: `1px solid ${copied ? "var(--accent-green)" : "var(--border)"}`,
        color: copied ? "var(--accent-green)" : "var(--text-secondary)",
        borderRadius: 4,
        padding: "1px 5px",
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
  if (!lead.form_token) return <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>—</span>

  const isApplied = lead.status === "applied"
  const isOpened = lead.form_completed || !!lead.form_used_at || lead.status === "opened"
  const tone = isApplied || isOpened ? "var(--accent-green)" : "var(--accent-yellow)"
  const label = isApplied ? "Applied" : isOpened ? "Opened" : "Sent"

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/l/${lead.form_token}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <button
      onClick={copy}
      title={copied ? "Link copied!" : `Copy application link (${lead.form_token}) — sent ${timeAgo(lead.form_sent_at || "")}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        background: `${tone}14`, border: `1px solid ${tone}3d`, color: tone,
        borderRadius: 5, padding: "2px 7px", fontSize: 11, fontWeight: 600, height: 23, cursor: "pointer",
      }}
    >
      {copied ? <Check size={11} strokeWidth={2.2} /> : <Link2 size={11} strokeWidth={2} />}
      {copied ? "Copied" : label}
    </button>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 70 ? "var(--accent-green)" : score >= 40 ? "var(--accent-yellow)" : "var(--text-muted)"
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 28, height: 3.5, borderRadius: 2, background: "var(--overlay-chip)", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: tone, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums" }}>{score}</span>
    </div>
  )
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  sanctioned:     { bg: "rgba(56,189,248,0.15)", color: "#38bdf8",            label: "Sanctioned" },
  disbursed:      { bg: "rgba(34,197,94,0.15)",  color: "#22c55e",            label: "Disbursed" },
  qualified:      { bg: "rgba(34,197,94,0.15)",  color: "var(--accent-green)", label: "Qualified" },
  interested:     { bg: "rgba(34,197,94,0.15)",  color: "var(--accent-green)", label: "Interested" },
  contacted:      { bg: "rgba(59,130,246,0.15)", color: "var(--accent-blue)",  label: "Contacted" },
  approved:       { bg: "rgba(16,185,129,0.15)", color: "#10b981",            label: "Approved" },
  in_progress:    { bg: "rgba(245,158,11,0.15)", color: "var(--accent-yellow)",label: "In Progress" },
  pending:        { bg: "rgba(234,179,8,0.15)",  color: "var(--accent-yellow)",label: "Under Review" },
  new:            { bg: "rgba(139,124,255,0.15)",color: "var(--accent-violet)",label: "New" },
  not_interested: { bg: "rgba(239,68,68,0.15)",  color: "var(--accent-red)",   label: "Not Interested" },
  rejected:       { bg: "rgba(239,68,68,0.15)",  color: "var(--accent-red)",   label: "Not Sanctioned / Rejected" },
  unknown:        { bg: "rgba(100,116,139,0.15)",color: "var(--text-secondary)", label: "Pending" },
}

function getLeadStatusStyle(lead: Lead) {
  // If loan application status exists, it reflects the true finance pipeline status
  const loanSt = String(lead.loan_status || "").toLowerCase().trim()
  if (loanSt && STATUS_STYLES[loanSt]) return STATUS_STYLES[loanSt]

  const st = String(lead.status || "").toLowerCase().trim()
  if (st && STATUS_STYLES[st]) return STATUS_STYLES[st]
  const inst = String(lead.interested || "").toLowerCase().trim()
  if (inst && STATUS_STYLES[inst]) return STATUS_STYLES[inst]
  return STATUS_STYLES.unknown
}

const INTERESTED_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  interested:     { bg: "rgba(34,197,94,0.15)",  color: "var(--accent-green)", label: "Interested" },
  not_interested: { bg: "rgba(239,68,68,0.15)",  color: "var(--accent-red)", label: "Not Interested" },
  unknown:        { bg: "rgba(100,116,139,0.15)",color: "var(--text-secondary)", label: "Pending" },
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
    <div style={{ width: 30, height: 30, borderRadius: "50%", background: `color-mix(in oklab, ${color} 18%, transparent)`, border: `1px solid color-mix(in oklab, ${color} 32%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>
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
  // A11y (2026-10-05): console modals close on Escape, matching the
  // marketing nav behavior.
  useEscapeDismiss(showAdd, () => setShowAdd(false))
  const [form, setForm] = useState({ name: "", phone: "", address: "", product_interest: "", loan_amount: "", language: "telugu" })

  type AgendaPreset = {
    id: string
    label: string
    text: string
    product?: string | null
    language?: string | null
  }

  const DEFAULT_PRESETS: AgendaPreset[] = [
    { id: "p1", label: "Standard intro", text: "" },
    { id: "p2", label: "New enquiry — send link", text: "Reference what they enquired about, offer to send the official application link, and book a callback." },
    { id: "p3", label: "Balance transfer offer", text: "Introduce our balance-transfer offer and ask if their current EMI feels heavy. Don't pitch personal loans." },
    { id: "p4", label: "Top-up on existing loan", text: "Ask if they need extra liquidity or renovation funds with an instant pre-approved top-up on their existing loan." },
    { id: "p5", label: "Documents pending", text: "Politely follow up regarding pending documents needed to proceed with their loan submission." },
    { id: "p6", label: "Old lead — still looking?", text: "Re-engage regarding their earlier loan enquiry with today's current competitive bank interest rates." },
  ]

  const [presets, setPresets] = useState<AgendaPreset[]>(DEFAULT_PRESETS)
  const [uploadAgendaPreset, setUploadAgendaPreset] = useState("Standard intro")
  const [uploadTalkingPoints, setUploadTalkingPoints] = useState("")
  const [saveAsPresetName, setSaveAsPresetName] = useState("")
  const [showSavePreset, setShowSavePreset] = useState(false)
  const [savingPreset, setSavingPreset] = useState(false)

  const [queueAgendaPreset, setQueueAgendaPreset] = useState("Standard intro")
  const [queueTalkingPoints, setQueueTalkingPoints] = useState("")
  const [queueShowSavePreset, setQueueShowSavePreset] = useState(false)
  const [queueSavePresetName, setQueueSavePresetName] = useState("")

  async function loadPresets() {
    try {
      const res = await fetch("/api/agenda-presets")
      const d = await res.json()
      if (res.ok && Array.isArray(d.presets) && d.presets.length > 0) {
        setPresets(d.presets)
      }
    } catch {}
  }

  useEffect(() => {
    loadPresets()
  }, [])

  function onSelectUploadPreset(lbl: string) {
    setUploadAgendaPreset(lbl)
    const match = presets.find((p) => p.label === lbl)
    if (match) {
      setUploadTalkingPoints(match.text)
    }
  }

  function onSelectQueuePreset(lbl: string) {
    setQueueAgendaPreset(lbl)
    const match = presets.find((p) => p.label === lbl)
    if (match) {
      setQueueTalkingPoints(match.text)
    }
  }

  async function handleSavePreset(label: string, text: string) {
    if (!label.trim()) return
    setSavingPreset(true)
    try {
      const res = await fetch("/api/agenda-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, text }),
      })
      const d = await res.json()
      if (res.ok) {
        toast.success(`Saved preset "${label}"`)
        setShowSavePreset(false)
        setQueueShowSavePreset(false)
        setSaveAsPresetName("")
        setQueueSavePresetName("")
        await loadPresets()
      } else {
        toast.error(d.error || "Failed to save preset")
      }
    } catch {
      toast.error("Failed to save preset")
    }
    setSavingPreset(false)
  }

  const [showUpload, setShowUpload] = useState(false)
  useEscapeDismiss(showUpload, () => setShowUpload(false))
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadDestination, setUploadDestination] = useState<"leads" | "queue">("leads")
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{
    created: number
    duplicates?: number
    invalid?: number
    queued?: number
    destination?: string
  } | null>(null)

  async function handleUploadCsv() {
    if (!uploadFile) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", uploadFile)
      fd.append("type", "contacts")
      fd.append("destination", uploadDestination)
      if (uploadDestination === "queue") {
        fd.append("talking_points", uploadTalkingPoints.trim())
        fd.append("agenda_label", uploadAgendaPreset.trim())
      }
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Upload failed")
        return
      }
      setUploadResult(data)
      load()
    } catch {
      toast.error("Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const [callTarget, setCallTarget] = useState<Lead | null>(null)
  const [callInstructions, setCallInstructions] = useState("")
  const [calling, setCalling] = useState<string | null>(null)

  const [waTarget, setWaTarget] = useState<Lead | null>(null)
  const [waText, setWaText] = useState("")
  const [waSending, setWaSending] = useState(false)

  // Send Bank Link modal state
  const [bankLinkTarget, setBankLinkTarget] = useState<Lead | null>(null)
  const [selectedBank, setSelectedBank] = useState("Right Agent Group")
  const [bankProduct, setBankProduct] = useState("Home Loan")
  const [sendingBankLink, setSendingBankLink] = useState(false)
  const [availableBanks, setAvailableBanks] = useState<{ id: string; bank: string; product: string }[]>([])

  async function openSendBankLinkModal(lead: Lead) {
    setBankLinkTarget(lead)
    const prod = lead.product_interest || "Home Loan"
    setBankProduct(prod)
    setSelectedBank("Right Agent Group")
  }

  async function handleSendBankLink() {
    if (!bankLinkTarget) return
    setSendingBankLink(true)
    try {
      const res = await fetch("/api/links/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: bankLinkTarget.id,
          bank: selectedBank || "Right Agent Group",
          product: bankProduct,
        }),
      })
      const d = await res.json()
      if (res.ok) {
        toast.success(`Sent Right Agent Group application link (${bankProduct}) to ${bankLinkTarget.name || "customer"} via WhatsApp`)
        setBankLinkTarget(null)
        load()
      } else {
        toast.error(d.error || "Failed to send application link")
      }
    } catch {
      toast.error("Failed to send application link")
    } finally {
      setSendingBankLink(false)
    }
  }

  const [memoryLeadId, setMemoryLeadId] = useState<string | null>(null)

  // ── Instagram Separation lanes (2026-09-26) ──────────────────────
  // "crm" = callable leads (telecaller default), "social" = Instagram
  // prospects (no phone yet). The server default is crm too, so any other
  // consumer of /api/leads (dialer, exports, badge) stays clean.
  const [scopeTab, setScopeTab] = useState<"crm" | "social">("crm")
  const [crmCount, setCrmCount] = useState(0)
  const [socialCount, setSocialCount] = useState(0)
  const [socialPhoneFilter, setSocialPhoneFilter] = useState<"all" | "detected" | "missing">("all")
  const [socialChannelFilter, setSocialChannelFilter] = useState<"all" | "dm" | "comment">("all")
  const [convertTarget, setConvertTarget] = useState<Lead | null>(null)
  const [convertBusy, setConvertBusy] = useState(false)
  const [convertForm, setConvertForm] = useState<{ phone: string; productInterest: string; notes: string; sendWa: boolean; addToQueue: boolean }>({
    phone: "", productInterest: "", notes: "", sendWa: true, addToQueue: false,
  })

  // ── Bulk call-queue selection (2026-09-26 bulk upgrade) ───────────
  // Row checkboxes + floating action bar + the Add-to-Call-Queue modal.
  // DND / duplicate / recently-called protections are enforced SERVER-side
  // by /api/outbound/queue — the modal only states them.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showQueueModal, setShowQueueModal] = useState(false)
  const [queueBusy, setQueueBusy] = useState(false)
  const [bypassRecentCooloff, setBypassRecentCooloff] = useState(false)
  const [queueForm, setQueueForm] = useState<{ channel: string; timing: "now" | "later"; scheduledAt: string; language: string }>({
    channel: "phone", timing: "now", scheduledAt: "", language: "auto",
  })

  // Bulk WhatsApp modal state
  const [showBulkWaModal, setShowBulkWaModal] = useState(false)
  const [bulkWaMessage, setBulkWaMessage] = useState("Hello {name}, greetings from Right Agent Group! We provide fast-track approval on Personal, Business, and Home Loans with minimal documentation.")
  const [bulkWaIncludeLink, setBulkWaIncludeLink] = useState(true)
  const [bulkWaProduct, setBulkWaProduct] = useState("Home Loan")
  const [bulkWaBusy, setBulkWaBusy] = useState(false)
  const [bulkWaResult, setBulkWaResult] = useState<{ total: number; sentCount: number; skippedDnd: number; failedCount: number; errors?: string[] } | null>(null)
  const [bulkWaMode, setBulkWaMode] = useState<"template" | "text">("template")
  const [bulkWaTemplateName, setBulkWaTemplateName] = useState("loan_application_form")
  const [bulkWaTemplateLang, setBulkWaTemplateLang] = useState("en")

  // ── Lead Name & Details Editing ──
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState<string>("")
  const [savingNameId, setSavingNameId] = useState<string | null>(null)
  const [editModalLead, setEditModalLead] = useState<Lead | null>(null)
  useEscapeDismiss(!!editModalLead, () => setEditModalLead(null))
  const [editForm, setEditForm] = useState<{
    name: string
    phone: string
    address: string
    loan_amount: string
    product_interest: string
    notes: string
  }>({ name: "", phone: "", address: "", loan_amount: "", product_interest: "", notes: "" })
  const [savingEditModal, setSavingEditModal] = useState(false)

  function startEditName(lead: Lead) {
    setEditingLeadId(lead.id)
    setEditingNameValue(lead.name || "")
  }

  function cancelEditName() {
    setEditingLeadId(null)
    setEditingNameValue("")
  }

  async function saveLeadName(id: string) {
    const trimmed = editingNameValue.trim()
    if (!trimmed) {
      toast.error("Lead name cannot be empty")
      return
    }
    setSavingNameId(id)
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, name: trimmed } : l)))
    try {
      const res = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: trimmed }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Failed to update lead name")
        load(true)
      } else {
        toast.success(`Lead name updated to "${trimmed}"`)
        setEditingLeadId(null)
        broadcastCrmSync()
      }
    } catch {
      toast.error("Failed to update lead name — check connection")
      load(true)
    } finally {
      setSavingNameId(null)
    }
  }

  function openEditModal(lead: Lead) {
    setEditModalLead(lead)
    const rawProd = (lead.product_interest || (lead as any).loan_type || "").trim()
    const normalizeProduct = (p: string) => {
      const lower = p.toLowerCase().trim()
      if (!lower) return ""
      if (lower.includes("edu") || lower.includes("student")) return "Education Loan"
      if (lower.includes("home") || lower.includes("housing")) return "Home Loan"
      if (lower.includes("biz") || lower.includes("business") || lower.includes("commercial")) return "Business Loan"
      if (lower.includes("person")) return "Personal Loan"
      if (lower.includes("lap") || lower.includes("property")) return "Loan Against Property (LAP)"
      if (lower.includes("gold")) return "Gold Loan"
      if (lower.includes("car") || lower.includes("vehicle") || lower.includes("auto")) return "Vehicle Loan"
      return LOAN_TYPES.find((t) => t.toLowerCase() === lower) || p
    }
    const matched = normalizeProduct(rawProd)

    setEditForm({
      name: lead.name || "",
      phone: lead.phone || "",
      address: lead.address || "",
      loan_amount: lead.loan_amount ? String(lead.loan_amount) : "",
      product_interest: matched,
      notes: lead.notes || "",
    })
  }

  async function saveEditModal() {
    if (!editModalLead) return
    const trimmedName = editForm.name.trim()
    if (!trimmedName) {
      toast.error("Lead name is required")
      return
    }
    setSavingEditModal(true)
    try {
      const updates: Record<string, unknown> = {
        id: editModalLead.id,
        name: trimmedName,
        address: editForm.address,
        product_interest: editForm.product_interest,
        loan_amount: editForm.loan_amount ? Number(editForm.loan_amount) : null,
        notes: editForm.notes,
      }
      if (editForm.phone.trim()) {
        updates.phone = editForm.phone.trim()
      }
      const res = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        const updated = await res.json()
        setLeads((prev) => prev.map((l) => (l.id === editModalLead.id ? { ...l, ...updated } : l)))
        toast.success(`Lead "${trimmedName}" updated`)
        setEditModalLead(null)
        broadcastCrmSync()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Failed to update lead")
      }
    } catch {
      toast.error("Failed to update lead — check connection")
    } finally {
      setSavingEditModal(false)
    }
  }

  // Prune selections that no longer exist (lead deleted / filter changed).
  useEffect(() => {
    setSelectedIds((prev) => {
      const alive = new Set(leads.map((l) => l.id))
      const next = prev.filter((id) => alive.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [leads])

  const displayLeads = useMemo(() => {
    const filtered = smartFilter(leads, search, (l) => [
      l.name,
      l.phone,
      l.whatsapp_number,
      l.product_interest,
      l.address,
      l.lead_code,
      l.status,
      l.instagram_handle,
      l.ig_phone_extracted,
      l.last_message,
      l.source,
    ])

    if (scopeTab === "social") {
      return filtered.filter((l) => {
        if (socialPhoneFilter === "detected" && !l.ig_phone_extracted) return false
        if (socialPhoneFilter === "missing" && !!l.ig_phone_extracted) return false
        if (socialChannelFilter === "dm" && !l.source?.toLowerCase().includes("dm")) return false
        if (socialChannelFilter === "comment" && !l.source?.toLowerCase().includes("comment")) return false
        return true
      })
    }
    return filtered
  }, [leads, search, scopeTab, socialPhoneFilter, socialChannelFilter])

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
          talking_points: queueTalkingPoints.trim() || undefined,
          agenda_label: queueAgendaPreset.trim() || undefined,
          skipRecentCalledHours: bypassRecentCooloff ? 0 : 24,
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

  // Send Bulk WhatsApp campaign to selected leads
  async function sendBulkWaCampaign() {
    if (bulkWaMode === "text" && !bulkWaMessage.trim()) return
    if (bulkWaMode === "template" && !bulkWaTemplateName.trim()) return
    setBulkWaBusy(true)
    try {
      const res = await fetch("/api/whatsapp/bulk-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds: selectedIds,
          sendMode: bulkWaMode,
          templateName: bulkWaTemplateName.trim(),
          templateLanguage: bulkWaTemplateLang,
          message: bulkWaMessage.trim(),
          includeLink: bulkWaIncludeLink,
          product: bulkWaProduct,
        }),
      })
      const d = await res.json()
      if (res.ok) {
        setBulkWaResult({
          total: d.total || selectedIds.length,
          sentCount: d.sentCount || 0,
          skippedDnd: d.skippedDnd || 0,
          failedCount: d.failedCount || 0,
          errors: d.errors || [],
        })
        setSelectedIds([])
      } else {
        toast.error(d.error || "Failed to send bulk WhatsApp")
      }
    } catch {
      toast.error("Network error sending bulk WhatsApp")
    } finally {
      setBulkWaBusy(false)
    }
  }

  async function convertProspect() {
    if (!convertTarget) return
    setConvertBusy(true)
    try {
      const res = await fetch(`/api/instagram/leads/${convertTarget.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: convertForm.phone,
          productInterest: convertForm.productInterest || null,
          notes: convertForm.notes || null,
          sendWhatsAppLink: convertForm.sendWa,
          addToCallQueue: convertForm.addToQueue,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(
          `${d.lead?.name || "Prospect"} is now a CRM lead${d.lead?.lead_code ? ` (${d.lead.lead_code})` : ""}` +
          `${d.queued ? " — added to Call Queue" : ""}` +
          `${d.whatsappSent ? " — WhatsApp welcome + form link sent" : ""}`
        )
        setConvertTarget(null)
        load()
      } else if (res.status === 409) {
        // Never auto-merged — the operator decides. Point them at the other lead.
        toast.error(d.message || "That phone already belongs to another CRM lead — review it manually before converting.")
      } else {
        toast.error(d.message || d.error || "Convert failed")
      }
    } catch {
      toast.error("Convert failed — check your connection and try again")
    }
    setConvertBusy(false)
  }

  async function load(silent = false) {
    if (!silent) setLoading(true)
    // Lane tab badges — two tiny COUNT queries riding the same poll cycle.
    fetch("/api/leads?count=1&scope=crm").then((r) => (r.ok ? r.json() : null)).then((d) => d && setCrmCount(d.count ?? 0)).catch(() => {})
    fetch("/api/leads?count=1&scope=social").then((r) => (r.ok ? r.json() : null)).then((d) => d && setSocialCount(d.count ?? 0)).catch(() => {})
    const params = new URLSearchParams()
    params.set("scope", scopeTab)
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
  }, [debouncedSearch, ageFilter, amountFilter, loanTypeFilter, interestedFilter, scopeTab])

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

  const isQualified = (l: Lead) =>
    l.status === "qualified" ||
    l.status === "interested" ||
    l.status === "form_opened" ||
    l.status === "approved" ||
    l.status === "link_sent" ||
    l.status === "docs_pending" ||
    l.interested === "interested" ||
    (Number(l.score) || 0) >= 70

  const totalLeads = leads.length
  const qualified = leads.filter(isQualified).length
  // Pipeline value = sum of loan_amount only where it's a valid positive number
  const pipelineValue = leads.reduce((s, l) => {
    const amt = Number(l.loan_amount)
    return s + (isFinite(amt) && amt > 0 ? amt : 0)
  }, 0)
  // Qualified value = the sum for qualified/high-intent leads (score >= 70 or active pipeline stage).
  // The raw total is inflated by junk/test entries (a single ₹1,234Cr test
  // lead once showed a ₹1,235Cr pipeline), so the tile leads with the
  // qualified money and shows the total as context — qualified vs total.
  const qualifiedValue = leads.reduce((s, l) => {
    if (!isQualified(l)) return s
    const amt = Number(l.loan_amount)
    return s + (isFinite(amt) && amt > 0 ? amt : 0)
  }, 0)
  const qualifiedPct = pctOf(qualifiedValue, pipelineValue)
  const interestedCount = leads.filter((l) => l.interested === "interested").length

  // Instagram prospect metrics:
  const socialDetectedCount = leads.filter((l) => !!l.ig_phone_extracted).length
  const socialAwaitingCount = Math.max(0, leads.length - socialDetectedCount)
  const socialProductCount = leads.filter((l) => !!l.product_interest && l.product_interest !== "General").length

  // One dialer, one endpoint: every outbound call from this screen goes
  // through POST /api/calls/dial (channel: phone | whatsapp | auto) so the
  // rules are IDENTICAL for both networks — compliance, quota, comm-log,
  // instructions, warm-up. The old split (phone → /api/calls, WhatsApp →
  // /api/calls/dial) silently skipped the comm-log and dropped the
  // "What should Priya talk about?" text on WhatsApp calls.
  async function dial(channel: "phone" | "whatsapp" | "auto") {
    if (!callTarget) return
    const key = `${channel}-${callTarget.id}`
    setCalling(key)
    try {
      const res = await fetch("/api/calls/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: callTarget.id, channel, instructions: callInstructions }),
      })
      const data = await res.json()
      if (res.ok) {
        const via = data.channel === "whatsapp" ? "WhatsApp" : "phone"
        toast.success(channel === "auto"
          ? `Smart Dial → ${via} call placed — Priya is dialing now`
          : `${via === "WhatsApp" ? "WhatsApp" : "Phone"} call placed — Priya is dialing now. Track it in Voice Logs.`)
        load()
      } else {
        toast.error(data.error || "Call failed")
      }
    } catch {
      // Network failure — surface it, the busy spinner must not just hang.
      toast.error("Call failed — check your connection and try again")
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
    if (!form.name.trim()) {
      toast.error("Full name is required")
      return
    }
    const phoneDigits = (form.phone || "").replace(/\D/g, "")
    const isValidPhone = phoneDigits.length === 10 || (phoneDigits.length === 12 && phoneDigits.startsWith("91"))
    if (!isValidPhone) {
      toast.error("Please enter a valid 10-digit Indian mobile number")
      return
    }

    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        product_interest: form.product_interest.trim() || null,
        loan_amount: form.loan_amount ? parseFloat(form.loan_amount) : null,
        source: "manual"
      }),
    })
    if (res.ok) {
      setShowAdd(false)
      setForm({ name: "", phone: "", address: "", product_interest: "", loan_amount: "", language: "telugu" })
      toast.success(`${form.name} added to leads`)
      load()
    }
    else { const d = await res.json().catch(() => ({})); toast.error(d.error || "Could not add lead") }
  }

  const Card = ({ label, value, icon: Icon, tone, sub }: { label: string; value: string; icon: any; tone: string; sub?: string }) => (
    <div className="card" style={{ padding: "14px 18px", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 500, marginBottom: 4, letterSpacing: "0.01em" }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>{value}</div>
          {sub && (
            <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", marginTop: 3, letterSpacing: "0.01em" }}>{sub}</div>
          )}
        </div>
        <div style={{
          width: 36, height: 36, background: `${tone}1f`, border: `1px solid ${tone}33`,
          borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={17} strokeWidth={1.9} style={{ color: tone }} />
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {scopeTab === "social" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <Card
            label="Total Prospects"
            value={socialCount.toLocaleString()}
            icon={Instagram}
            tone="#e1306c"
          />
          <Card
            label="Phone Detected (Ready)"
            value={socialDetectedCount.toLocaleString()}
            icon={PhoneCall}
            tone="var(--accent-green)"
          />
          <Card
            label="Awaiting Phone"
            value={socialAwaitingCount.toLocaleString()}
            icon={MessageSquare}
            tone="var(--accent-yellow)"
          />
          <Card
            label="Loan Inquiries"
            value={socialProductCount.toLocaleString()}
            icon={Target}
            tone="var(--accent-cyan)"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <Card label="Total Leads" value={totalLeads.toLocaleString()} icon={Users} tone="var(--accent-violet)" />
          <Card label="Interested" value={interestedCount.toLocaleString()} icon={Target} tone="var(--accent-cyan)" />
          <Card
            label="Pipeline Value"
            value={formatCurrency(qualifiedValue)}
            icon={IndianRupee}
            tone="var(--accent-yellow)"
            sub={`Qualified · of ${formatCurrency(pipelineValue)} total (${qualifiedPct}%)`}
          />
          <Card label="Qualified Leads" value={qualified.toLocaleString()} icon={BadgeCheck} tone="var(--accent-green)" />
        </div>
      )}

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          {/* Lane tabs — CRM leads vs Instagram prospects (2026-09-26).
              Telecallers live in CRM; phone-less IG inquirers get their own
              lane so they never clutter the pipeline or the dialer. */}
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {([
              { key: "crm", label: "CRM Leads", count: crmCount, icon: Phone },
              { key: "social", label: "Instagram Prospects", count: socialCount, icon: Instagram },
            ] as const).map((t) => {
              const active = scopeTab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => { setScopeTab(t.key); setSelectedIds([]); setLeads([]) }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    height: 30, padding: "0 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${active ? "rgba(139,124,255,0.5)" : "var(--border)"}`,
                    background: active ? "rgba(139,124,255,0.12)" : "transparent",
                    color: active ? "var(--accent-violet)" : "var(--text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  <t.icon size={13} strokeWidth={2} />
                  {t.label} ({t.count.toLocaleString()})
                </button>
              )
            })}
          </div>
          {/* Single compact filter row */}
          <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", width: scopeTab === "social" ? 250 : 220, display: "flex", alignItems: "center" }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input
                placeholder={scopeTab === "social" ? "Search @handle, name, phone…" : "Search name, phone, code…"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: "100%", height: 34, fontSize: 12.5, paddingLeft: 30, paddingRight: 32 }}
              />
              <div style={{ position: "absolute", right: 3, top: "50%", transform: "translateY(-50%)" }}>
                <VoiceDictation
                  onTranscript={(spoken) => setSearch(prev => (prev ? `${prev} ${spoken}` : spoken))}
                  size={14}
                  style={{ width: 28, height: 28, border: "none", background: "transparent" }}
                  title="Speak to search leads"
                />
              </div>
            </div>

            {scopeTab === "social" ? (
              <>
                <select
                  value={socialPhoneFilter}
                  onChange={(e) => setSocialPhoneFilter(e.target.value as any)}
                  style={{ height: 34, padding: "0 26px 0 10px", fontSize: 12.5, width: 180, borderRadius: 8, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", lineHeight: "32px" }}
                >
                  <option value="all">All Phone Statuses</option>
                  <option value="detected">🟢 Phone Detected (Ready)</option>
                  <option value="missing">⏳ Awaiting Phone</option>
                </select>
                <select
                  value={socialChannelFilter}
                  onChange={(e) => setSocialChannelFilter(e.target.value as any)}
                  style={{ height: 34, padding: "0 26px 0 10px", fontSize: 12.5, width: 150, borderRadius: 8, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", lineHeight: "32px" }}
                >
                  <option value="all">All Channels</option>
                  <option value="dm">💬 Direct Messages</option>
                  <option value="comment">💬 Post Comments</option>
                </select>
                <select
                  value={loanTypeFilter}
                  onChange={(e) => setLoanTypeFilter(e.target.value)}
                  style={{ height: 34, padding: "0 26px 0 10px", fontSize: 12.5, width: 145, borderRadius: 8, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", lineHeight: "32px" }}
                >
                  <option value="all">All Products</option>
                  {LOAN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </>
            ) : (
              <>
                <select
                  value={ageFilter}
                  onChange={(e) => setAgeFilter(e.target.value)}
                  style={{ height: 34, padding: "0 26px 0 10px", fontSize: 12.5, width: 115, borderRadius: 8, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", lineHeight: "32px" }}
                >
                  <option value="all">All Ages</option>
                  <option value="new">New (7d)</option>
                  <option value="old">Older</option>
                </select>
                <select
                  value={amountFilter}
                  onChange={(e) => setAmountFilter(e.target.value)}
                  style={{ height: 34, padding: "0 26px 0 10px", fontSize: 12.5, width: 135, borderRadius: 8, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", lineHeight: "32px" }}
                >
                  <option value="all">All Amounts</option>
                  <option value="high">High (≥ ₹10L)</option>
                  <option value="low">Low (&lt; ₹10L)</option>
                </select>
                <select
                  value={loanTypeFilter}
                  onChange={(e) => setLoanTypeFilter(e.target.value)}
                  style={{ height: 34, padding: "0 26px 0 10px", fontSize: 12.5, width: 150, borderRadius: 8, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", lineHeight: "32px" }}
                >
                  <option value="all">All Loan Types</option>
                  {LOAN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select
                  value={interestedFilter}
                  onChange={(e) => setInterestedFilter(e.target.value)}
                  style={{ height: 34, padding: "0 26px 0 10px", fontSize: 12.5, width: 135, borderRadius: 8, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", lineHeight: "32px" }}
                >
                  <option value="all">All Statuses</option>
                  <option value="interested">Interested</option>
                  <option value="not_interested">Not Interested</option>
                  <option value="unknown">Unknown</option>
                </select>
              </>
            )}

            {/* Refresh — resets all filters and reloads */}
            <button
              onClick={() => {
                setSearch("")
                setAgeFilter("all")
                setAmountFilter("all")
                setLoanTypeFilter("all")
                setInterestedFilter("all")
                setSocialPhoneFilter("all")
                setSocialChannelFilter("all")
              }}
              title="Reset filters"
              className="icon-btn"
              style={{ width: 34, height: 34 }}
            ><RotateCcw size={14} strokeWidth={1.9} /></button>

            {scopeTab === "social" && (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("rag:navigate", { detail: { view: "instagram" } }))}
                className="btn-ghost"
                style={{
                  height: 34,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#e1306c",
                  borderColor: "rgba(225,48,108,0.3)",
                  background: "rgba(225,48,108,0.06)",
                }}
                title="Open Instagram Chat engagement hub"
              >
                <Instagram size={14} strokeWidth={2.2} /> Live IG Chat
              </button>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{displayLeads.length} shown</div>
            <a href="/api/leads/export" className="btn-ghost" style={{ height: 34, fontSize: 12, padding: "0 12px", textDecoration: "none" }} title="Export all leads as CSV">
              <Download size={13} strokeWidth={2} /> Export
            </a>
            {canEdit && scopeTab === "crm" && (
              <button
                type="button"
                onClick={() => { setShowUpload(true); setUploadResult(null); setUploadFile(null); }}
                className="btn-ghost"
                style={{ height: 34, fontSize: 12, padding: "0 12px" }}
              >
                <Upload size={13} strokeWidth={2} /> Upload CSV
              </button>
            )}
            {canEdit && scopeTab === "crm" && (
              <button onClick={() => setShowAdd(true)} className="btn-primary" style={{ height: 34, fontSize: 12, padding: "0 14px" }}>
                <Plus size={14} strokeWidth={2.2} /> Add Lead
              </button>
            )}
          </div>
        </div>

        {/* Horizontal scroll container */}
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: scopeTab === "crm" ? 1180 : 960, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {scopeTab === "crm" ? (
                <>
                  <th style={{ padding: "10px 8px 10px 12px", width: 36, textAlign: "left" }}>
                    {canEdit && displayLeads.length > 0 && (
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all shown leads" style={{ width: 14, height: 14, cursor: "pointer", accentColor: "var(--accent-violet)" }} />
                    )}
                  </th>
                  {["LEAD", "SCORE", "ADDRESS", "LOAN TYPE", "VALUE", "STATUS", "FORM", "CALLS", "UPDATED", "ACTIONS"].map((h) => (
                    <th key={h} style={{
                      padding: "10px 12px",
                      textAlign: h === "CALLS" ? "center" : "left",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      letterSpacing: "0.05em",
                      whiteSpace: "nowrap",
                      minWidth: h === "CALLS" ? 70 : h === "UPDATED" ? 110 : h === "ACTIONS" ? 140 : undefined,
                      ...(h === "ACTIONS" ? { position: "sticky", right: 0, background: "var(--bg-card)", zIndex: 2, boxShadow: "-6px 0 10px rgba(0,0,0,0.12)" } : {}),
                    }}>{h}</th>
                  ))}
                </>
              ) : (
                ["PROSPECT / HANDLE", "CHANNEL", "DETECTED PHONE", "PRODUCT INTEREST", "LATEST INQUIRY", "LAST ACTIVE", "ACTIONS"].map((h) => (
                  <th key={h} style={{
                    padding: "10px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    letterSpacing: "0.05em",
                    whiteSpace: "nowrap",
                    minWidth: h === "ACTIONS" ? 140 : undefined,
                    ...(h === "ACTIONS" ? { position: "sticky", right: 0, background: "var(--bg-card)", zIndex: 2, boxShadow: "-6px 0 10px rgba(0,0,0,0.12)" } : {}),
                  }}>{h}</th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} style={{ borderBottom: "1px solid var(--border-light)" }}>
                  {scopeTab === "crm" && (
                    <td style={{ padding: "8px 6px 8px 12px", width: 36 }}>
                      <Skeleton w={14} h={14} r={3} />
                    </td>
                  )}
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Skeleton w={30} h={30} r={15} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <Skeleton w={100} h={11} />
                        <Skeleton w={70} h={9} />
                      </div>
                    </div>
                  </td>
                  {Array.from({ length: scopeTab === "social" ? 6 : 9 }).map((_, j) => (
                    <td key={j} style={{ padding: "8px 10px" }}><Skeleton w={j === (scopeTab === "social" ? 5 : 8) ? 68 : 52} h={11} /></td>
                  ))}
                </tr>
              ))
            ) : loadError ? (
              <tr>
                <td colSpan={scopeTab === "social" ? 7 : 11} style={{ padding: 32, textAlign: "center" }}>
                  <div style={{ color: "var(--accent-red)", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{loadError}</div>
                  <button onClick={() => load()} className="btn-ghost" style={{ height: 32, padding: "0 14px", fontSize: 12.5 }}>
                    <RotateCcw size={12.5} strokeWidth={1.9} /> Try again
                  </button>
                </td>
              </tr>
            ) : displayLeads.length === 0 ? (
              <tr>
                <td colSpan={scopeTab === "social" ? 7 : 11} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                  {scopeTab === "social" ? (
                    <div style={{ maxWidth: 460, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "20px 0" }}>
                      <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(225,48,108,0.1)", border: "1px solid rgba(225,48,108,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Instagram size={26} strokeWidth={1.8} style={{ color: "#e1306c" }} />
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>No Instagram prospects found</div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                        No Instagram prospects — DM/comment leads without a phone number land here. When they share their mobile, Priya auto-qualifies them into the CRM.
                      </div>
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent("rag:navigate", { detail: { view: "instagram" } }))}
                        className="btn-primary"
                        style={{ marginTop: 4, height: 34, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}
                      >
                        <Instagram size={14} strokeWidth={2} /> Open Instagram Chat
                      </button>
                    </div>
                  ) : (
                    "No leads match these filters."
                  )}
                </td>
              </tr>
            ) : (
              displayLeads.map((lead) => {
              if (scopeTab === "social") {
                return (
                  <tr key={lead.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <SocialAvatar name={lead.name} handle={lead.instagram_handle} />
                        <div>
                          {editingLeadId === lead.id ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }} onClick={(e) => e.stopPropagation()}>
                              <input
                                type="text"
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveLeadName(lead.id)
                                  if (e.key === "Escape") cancelEditName()
                                }}
                                autoFocus
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  padding: "2px 6px",
                                  height: 26,
                                  borderRadius: 5,
                                  border: "1px solid var(--accent-violet)",
                                  background: "var(--bg-card)",
                                  color: "var(--text-primary)",
                                  minWidth: 130,
                                  maxWidth: 180,
                                }}
                              />
                              <button
                                onClick={() => saveLeadName(lead.id)}
                                disabled={savingNameId === lead.id}
                                title="Save Name"
                                style={{
                                  padding: "2px 5px",
                                  height: 24,
                                  borderRadius: 5,
                                  background: "var(--accent-green)",
                                  border: "none",
                                  color: "white",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                }}
                              >
                                <Check size={11} strokeWidth={2.5} />
                              </button>
                              <button
                                onClick={cancelEditName}
                                disabled={savingNameId === lead.id}
                                title="Cancel"
                                style={{
                                  padding: "2px 5px",
                                  height: 24,
                                  borderRadius: 5,
                                  background: "transparent",
                                  border: "1px solid var(--border)",
                                  color: "var(--text-muted)",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                }}
                              >
                                <X size={11} strokeWidth={2} />
                              </button>
                            </div>
                          ) : (
                            <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", lineHeight: 1.25 }}>
                              {lead.pinned && <Pin size={11} strokeWidth={2.2} style={{ color: "var(--accent-yellow)", fill: "var(--accent-yellow)", flexShrink: 0 }} />}
                              <span>{lead.name || "Instagram Inquirer"}</span>
                              {canEdit && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    startEditName(lead)
                                  }}
                                  title="Edit Name"
                                  style={{
                                    background: "none",
                                    border: "none",
                                    padding: "1px 3px",
                                    cursor: "pointer",
                                    color: "var(--text-muted)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    borderRadius: 4,
                                    opacity: 0.65,
                                    transition: "opacity 0.15s",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.65")}
                                >
                                  <Pencil size={11} strokeWidth={2} />
                                </button>
                              )}
                              {lead.instagram_handle && (
                                <a
                                  href={`https://instagram.com/${lead.instagram_handle.replace(/^@/, "")}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  title={`Open @${lead.instagram_handle.replace(/^@/, "")} on Instagram`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 2,
                                    fontSize: 9.5,
                                    fontWeight: 600,
                                    color: "#e1306c",
                                    background: "rgba(225,48,108,0.1)",
                                    border: "1px solid rgba(225,48,108,0.28)",
                                    borderRadius: 4,
                                    padding: "0 4px",
                                    textDecoration: "none",
                                    flexShrink: 0,
                                  }}
                                >
                                  <Instagram size={9} strokeWidth={2.2} /> @{lead.instagram_handle.replace(/^@/, "")}
                                  <ExternalLink size={8} style={{ opacity: 0.6 }} />
                                </a>
                              )}
                            </div>
                          )}
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
                            {lead.lead_code && <LeadCodeBadge code={lead.lead_code} />}
                            {lead.ig_user_id && <span style={{ fontFamily: "monospace", fontSize: 10.5, opacity: 0.7 }}>ID: {lead.ig_user_id.slice(-6)}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      {lead.source?.toLowerCase().includes("comment") ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#e1306c", background: "rgba(225,48,108,0.1)", border: "1px solid rgba(225,48,108,0.25)", borderRadius: 5, padding: "2px 7px" }}>
                          <MessageSquare size={11} strokeWidth={2.2} /> Comment
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#0095f6", background: "rgba(0,149,246,0.1)", border: "1px solid rgba(0,149,246,0.25)", borderRadius: 5, padding: "2px 7px" }}>
                          <MessageCircle size={11} strokeWidth={2.2} /> DM
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      {lead.phone ? (
                        <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--accent-green)" }}>{lead.phone}</span>
                      ) : lead.ig_phone_extracted ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              color: "var(--accent-green)",
                              background: "rgba(34,197,94,0.12)",
                              border: "1px solid rgba(34,197,94,0.3)",
                              borderRadius: 5,
                              padding: "1px 6px",
                              fontFamily: "ui-monospace, monospace",
                            }}
                            title="Auto-detected from Instagram DM — ready to convert to CRM lead"
                          >
                            <Phone size={10} strokeWidth={2.2} />
                            Detected: {lead.ig_phone_extracted}
                          </span>
                          <span style={{ fontSize: 9.5, color: "var(--accent-green)", fontWeight: 600 }}>Ready to convert</span>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 11.5 }}>
                          <Clock size={11} />
                          <span>Awaiting number</span>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      <span style={{ background: "rgba(59,130,246,0.1)", color: "var(--text-secondary)", borderRadius: 5, padding: "2px 7px", fontSize: 11, fontWeight: 500 }}>
                        {lead.product_interest || "General Inquiry"}
                      </span>
                      {lead.loan_amount ? <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 1 }}>{formatCurrency(lead.loan_amount)}</div> : null}
                    </td>
                    <td style={{ padding: "8px 10px", maxWidth: 220 }}>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.3 }} title={lead.last_message || lead.notes || ""}>
                        {lead.last_message ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", padding: "0 4px", borderRadius: 3, background: "var(--overlay-hover)", flexShrink: 0 }}>
                              {lead.last_direction === "inbound" ? "User" : "Priya"}
                            </span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {lead.last_message}
                            </span>
                          </div>
                        ) : lead.notes ? (
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                            {lead.notes}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 11.5 }}>No messages recorded</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>
                      <div>{timeAgo(lead.last_interaction_at || lead.updated_at || lead.created_at)}</div>
                      <div style={{ fontSize: 9.5, opacity: 0.75, marginTop: 1 }}>{formatDateTime(lead.last_interaction_at || lead.updated_at || lead.created_at)}</div>
                    </td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap", position: "sticky", right: 0, background: "var(--bg-card)", zIndex: 1, boxShadow: "-6px 0 10px rgba(0,0,0,0.12)" }}>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        {canEdit && (
                          <>
                            <button
                              onClick={() => {
                                const targetId = lead.instagram_handle || lead.ig_user_id || lead.name
                                window.dispatchEvent(new CustomEvent("rag:navigate", { detail: { view: "instagram", search: targetId } }))
                              }}
                              title="Open in Instagram Chat"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                background: "rgba(225,48,108,0.1)",
                                border: "1px solid rgba(225,48,108,0.3)",
                                color: "#e1306c",
                                borderRadius: 7,
                                height: 28,
                                padding: "0 8px",
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              <Instagram size={12} strokeWidth={2} /> Chat
                            </button>
                            <button
                              onClick={() => togglePin(lead)}
                              title={lead.pinned ? "Unpin" : "Pin to top"}
                              style={{ background: lead.pinned ? "rgba(247,183,49,0.15)" : "var(--overlay-hover)", border: `1px solid ${lead.pinned ? "rgba(247,183,49,0.35)" : "var(--border)"}`, color: lead.pinned ? "var(--accent-yellow)" : "var(--text-muted)", borderRadius: 7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                            >
                              <Pin size={12.5} strokeWidth={1.9} style={lead.pinned ? { fill: "var(--accent-yellow)" } : undefined} />
                            </button>
                            <button
                              onClick={() => openEditModal(lead)}
                              title="Edit Lead Details"
                              style={{ background: "rgba(139,124,255,0.1)", border: "1px solid rgba(139,124,255,0.28)", color: "var(--accent-violet)", borderRadius: 7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                            >
                              <Pencil size={12.5} strokeWidth={1.9} />
                            </button>
                            <button
                              onClick={() => setMemoryLeadId(lead.id)}
                              title="View Lead Memory"
                              style={{ background: "rgba(247,183,49,0.1)", border: "1px solid rgba(247,183,49,0.28)", color: "var(--accent-yellow)", borderRadius: 7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                            >
                              <Brain size={13} strokeWidth={1.9} />
                            </button>
                          </>
                        )}
                        {!canEdit && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>View only</span>}
                      </div>
                    </td>
                  </tr>
                )
              }

              // CRM row
              const ist = getLeadStatusStyle(lead)
              return (
                <tr key={lead.id} style={{ borderBottom: "1px solid var(--border-light)", background: selectedIds.includes(lead.id) ? "rgba(139,124,255,0.05)" : undefined }}>
                  {canEdit && scopeTab === "crm" && (
                    <td style={{ padding: "8px 6px 8px 12px", width: 36 }}>
                      <input type="checkbox" checked={selectedIds.includes(lead.id)} onChange={() => toggleOne(lead.id)} title="Select for bulk call queue" style={{ width: 14, height: 14, cursor: "pointer", accentColor: "var(--accent-violet)" }} />
                    </td>
                  )}
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Avatar name={lead.name} />
                      <div style={{ minWidth: 0 }}>
                        {editingLeadId === lead.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingNameValue}
                              onChange={(e) => setEditingNameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveLeadName(lead.id)
                                if (e.key === "Escape") cancelEditName()
                              }}
                              autoFocus
                              style={{
                                fontSize: 12.5,
                                fontWeight: 600,
                                padding: "2px 6px",
                                height: 26,
                                borderRadius: 5,
                                border: "1px solid var(--accent-violet)",
                                background: "var(--bg-card)",
                                color: "var(--text-primary)",
                                minWidth: 130,
                                maxWidth: 180,
                              }}
                            />
                            <button
                              onClick={() => saveLeadName(lead.id)}
                              disabled={savingNameId === lead.id}
                              title="Save Name"
                              style={{
                                padding: "2px 5px",
                                height: 24,
                                borderRadius: 5,
                                background: "var(--accent-green)",
                                border: "none",
                                color: "white",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                              }}
                            >
                              <Check size={11} strokeWidth={2.5} />
                            </button>
                            <button
                              onClick={cancelEditName}
                              disabled={savingNameId === lead.id}
                              title="Cancel"
                              style={{
                                padding: "2px 5px",
                                height: 24,
                                borderRadius: 5,
                                background: "transparent",
                                border: "1px solid var(--border)",
                                color: "var(--text-muted)",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                              }}
                            >
                              <X size={11} strokeWidth={2} />
                            </button>
                          </div>
                        ) : (
                          <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", lineHeight: 1.25 }}>
                            {lead.pinned && <Pin size={11} strokeWidth={2.2} style={{ color: "var(--accent-yellow)", fill: "var(--accent-yellow)", flexShrink: 0 }} />}
                            <span>{lead.name || "Unknown"}</span>
                            {canEdit && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  startEditName(lead)
                                }}
                                title="Edit Name"
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: "1px 3px",
                                  cursor: "pointer",
                                  color: "var(--text-muted)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  borderRadius: 4,
                                  opacity: 0.65,
                                  transition: "opacity 0.15s",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.65")}
                              >
                                <Pencil size={11} strokeWidth={2} />
                              </button>
                            )}
                            {lead.source?.startsWith("Instagram") && lead.instagram_handle && (
                              <span
                                title={`Instagram origin: @${lead.instagram_handle}${lead.promoted_to_crm_at ? " — promoted from Instagram Prospects" : ""}`}
                                style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 9.5, fontWeight: 600, color: "#e1306c", background: "rgba(225,48,108,0.1)", border: "1px solid rgba(225,48,108,0.3)", borderRadius: 4, padding: "0 4px", flexShrink: 0 }}
                              >
                                <Instagram size={9} strokeWidth={2.2} /> @{lead.instagram_handle}
                              </span>
                            )}
                          </div>
                        )}
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
                          {lead.lead_code && <LeadCodeBadge code={lead.lead_code} />}
                          {lead.phone ? (
                            <span>{lead.phone}</span>
                          ) : lead.ig_phone_extracted ? (
                            <span style={{ color: "var(--accent-yellow)", fontWeight: 600 }} title="Auto-detected in their DM — click Convert to use it">Detected: {lead.ig_phone_extracted}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}><ScoreBadge score={lead.score ?? 0} /></td>
                  <td style={{ padding: "8px 10px", color: "var(--text-secondary)", fontSize: 12, maxWidth: 150, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={lead.address || "—"}>
                    {lead.address || "—"}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <span style={{ background: "rgba(59,130,246,0.1)", color: "var(--text-secondary)", borderRadius: 5, padding: "2px 7px", fontSize: 11, fontWeight: 500 }}>{lead.product_interest || "—"}</span>
                  </td>
                  <td style={{ padding: "8px 10px", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }}>{lead.loan_amount ? formatCurrency(lead.loan_amount) : "—"}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <span style={{ background: ist.bg, color: ist.color, borderRadius: 5, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>{ist.label}</span>
                    {lead.loan_status_reason && (
                      <div style={{ fontSize: 9.5, color: ist.color, marginTop: 2, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`Reason: ${lead.loan_status_reason}${lead.loan_remarks ? ` | Note: ${lead.loan_remarks}` : ""}`}>
                        {lead.loan_status_reason}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}><FormLinkCell lead={lead} /></td>
                  <td style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-secondary)", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{lead.call_count ?? 0}</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>
                    <div>{timeAgo(lead.updated_at || lead.created_at)}</div>
                    <div style={{ fontSize: 9.5, opacity: 0.75, marginTop: 1 }}>{formatDateTime(lead.updated_at || lead.created_at)}</div>
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap", position: "sticky", right: 0, background: selectedIds.includes(lead.id) ? "var(--bg-card-hover)" : "var(--bg-card)", zIndex: 1, boxShadow: "-6px 0 10px rgba(0,0,0,0.12)" }}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      {canEdit && (
                        <>
                          <button
                            onClick={() => togglePin(lead)}
                            title={lead.pinned ? "Unpin" : "Pin to top"}
                            style={{ background: lead.pinned ? "rgba(247,183,49,0.15)" : "var(--overlay-hover)", border: `1px solid ${lead.pinned ? "rgba(247,183,49,0.35)" : "var(--border)"}`, color: lead.pinned ? "var(--accent-yellow)" : "var(--text-muted)", borderRadius: 7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                          ><Pin size={12.5} strokeWidth={1.9} style={lead.pinned ? { fill: "var(--accent-yellow)" } : undefined} /></button>
                          <button
                            onClick={() => openEditModal(lead)}
                            title="Edit Lead Details"
                            style={{ background: "rgba(139,124,255,0.1)", border: "1px solid rgba(139,124,255,0.28)", color: "var(--accent-violet)", borderRadius: 7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                          ><Pencil size={12.5} strokeWidth={1.9} /></button>
                          <button
                            onClick={() => { setCallTarget(lead); setCallInstructions("") }}
                            disabled={!lead.phone || calling === lead.id}
                            title="Call with AI"
                            style={{ background: "rgba(139,124,255,0.12)", border: "1px solid rgba(139,124,255,0.28)", color: "var(--accent-violet)", borderRadius: 7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: calling === lead.id ? 0.5 : 1, cursor: "pointer" }}
                          ><Phone size={12.5} strokeWidth={1.9} /></button>
                          <button
                            onClick={() => setWaTarget(lead)}
                            disabled={!lead.phone && !lead.whatsapp_number}
                            title="Send WhatsApp"
                            style={{ background: "rgba(45,212,160,0.1)", border: "1px solid rgba(45,212,160,0.28)", color: "var(--accent-green)", borderRadius: 7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                          ><MessageCircle size={12.5} strokeWidth={1.9} /></button>
                          <button
                            onClick={() => openSendBankLinkModal(lead)}
                            disabled={!lead.phone && !lead.whatsapp_number}
                            title="Send Right Agent Group Application Link"
                            style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.28)", color: "var(--accent-cyan)", borderRadius: 7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                          ><FileText size={12.5} strokeWidth={1.9} /></button>
                        </>
                      )}
                      <button
                        onClick={() => setMemoryLeadId(lead.id)}
                        title="View Lead Memory"
                        style={{ background: "rgba(247,183,49,0.1)", border: "1px solid rgba(247,183,49,0.28)", color: "var(--accent-yellow)", borderRadius: 7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                      ><Brain size={13} strokeWidth={1.9} /></button>
                      {!canEdit && <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>View only</span>}
                    </div>
                  </td>
                </tr>
              )
            })
          )}
          </tbody>
        </table>
        {leads.length >= 200 && (
          // The server caps the list at 200 rows (default LIMIT) — if the page
          // is exactly full, say so instead of silently hiding the rest.
          <div style={{ padding: "10px 16px", fontSize: 11.5, color: "var(--text-muted)", textAlign: "center", borderTop: "1px solid var(--border-light)" }}>
            Showing the first {leads.length} leads — refine the search or filters to narrow further.
          </div>
        )}
        </div>
      </div>

      {/* Floating bulk-selection action bar (CRM lane only — prospects have
          no phone to dial until they are converted) */}
      {canEdit && scopeTab === "crm" && selectedIds.length > 0 && !showQueueModal && !showBulkWaModal && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 900, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 12px 40px rgba(0,0,0,0.25)", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <CheckSquare size={15} strokeWidth={2} style={{ color: "var(--accent-violet)" }} />
            {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"} selected
          </span>
          <button
            onClick={() => {
              setBulkWaResult(null)
              setShowBulkWaModal(true)
            }}
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 8,
              border: "none",
              background: "#25D366",
              color: "#06331d",
              fontWeight: 700,
              fontSize: 12.5,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
            title="Send bulk WhatsApp message to all selected leads"
          >
            <MessageCircle size={15} strokeWidth={2.4} /> Send Bulk WhatsApp
          </button>
          <button onClick={() => { setBypassRecentCooloff(selectedIds.length === 1); setShowQueueModal(true); }} className="btn-primary" style={{ height: 36 }}>
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
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: "min(520px, calc(100vw - 32px))" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Add {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"} to Call Queue</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 18 }}>Priya dials them through the bulk dialer — nothing is dialed until a campaign is started.</div>

            {/* What should Priya talk about? — Agenda picker */}
            <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 10, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                  What should Priya talk about?
                </label>
                <select
                  value={queueAgendaPreset}
                  onChange={(e) => onSelectQueuePreset(e.target.value)}
                  style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.label}>{p.label}</option>
                  ))}
                  <option value="Custom brief">Custom brief</option>
                </select>
              </div>

              <textarea
                value={queueTalkingPoints}
                onChange={(e) => setQueueTalkingPoints(e.target.value.slice(0, 1000))}
                rows={3}
                maxLength={1000}
                placeholder="e.g. Introduce our balance-transfer offer and ask if their current EMI feels heavy. Don't pitch personal loans."
                style={{
                  width: "100%",
                  fontSize: 12.5,
                  lineHeight: 1.45,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-card)",
                  color: "var(--text-primary)",
                  resize: "vertical",
                }}
              />

              {/* Soft compliance warnings */}
              {checkAgendaRules(queueTalkingPoints).length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  {checkAgendaRules(queueTalkingPoints).map((w, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: "var(--accent-yellow)", background: "rgba(234,179,8,0.08)", padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(234,179,8,0.2)" }}>
                      <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{w.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                  Priya opens with this in mind — she&apos;ll say it naturally, in the customer&apos;s language, not word for word.
                </div>
                {queueTalkingPoints.trim() && !presets.some((p) => p.label === queueAgendaPreset && p.text === queueTalkingPoints.trim()) && (
                  <button
                    type="button"
                    onClick={() => setQueueShowSavePreset(!queueShowSavePreset)}
                    style={{ fontSize: 11, color: "var(--accent-violet)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                  >
                    Save as preset
                  </button>
                )}
              </div>

              {queueShowSavePreset && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="Preset name (e.g. Balance Transfer 8.5%)"
                    value={queueSavePresetName}
                    onChange={(e) => setQueueSavePresetName(e.target.value)}
                    style={{ flex: 1, fontSize: 11.5, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                  />
                  <button
                    type="button"
                    onClick={() => handleSavePreset(queueSavePresetName, queueTalkingPoints)}
                    disabled={!queueSavePresetName.trim() || savingPreset}
                    className="btn-primary"
                    style={{ height: 26, fontSize: 11, padding: "0 10px" }}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>

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

            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: "var(--bg-secondary)", border: bypassRecentCooloff ? "1px solid rgba(139,124,255,0.4)" : "1px solid var(--border)", borderRadius: 8, marginBottom: 14 }}>
              <input
                type="checkbox"
                id="bypassRecentCheckbox"
                checked={bypassRecentCooloff}
                onChange={(e) => setBypassRecentCooloff(e.target.checked)}
                style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent-violet)", cursor: "pointer" }}
              />
              <label htmlFor="bypassRecentCheckbox" style={{ fontSize: 12, color: "var(--text-primary)", cursor: "pointer", userSelect: "none" }}>
                <strong>Allow redialing recently-contacted numbers</strong>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  Bypasses the 24-hour cool-off guard so you can immediately call leads that were already called today.
                </span>
              </label>
            </div>

            <div style={{ fontSize: 11.5, color: "var(--text-muted)", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", marginBottom: 16, lineHeight: 1.6 }}>
              Automatic protections: DND / do-not-call leads are always skipped · numbers already pending in the queue are not duplicated · calling-window rules pause and resume automatically.
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

      {/* Convert-to-CRM-Lead modal (Instagram Prospects lane) */}
      {convertTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => !convertBusy && setConvertTarget(null)}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: "min(450px, calc(100vw - 32px))" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <SocialAvatar name={convertTarget.name} handle={convertTarget.instagram_handle} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Convert {convertTarget.name || "prospect"} to CRM Lead</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {convertTarget.instagram_handle ? `@${convertTarget.instagram_handle} · ` : ""}{convertTarget.source || "Instagram prospect"} — all chat history stays attached after conversion.
                </div>
              </div>
            </div>

            {convertTarget.ig_phone_extracted && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, margin: "14px 0" }}>
                <CheckCircle2 size={16} style={{ color: "var(--accent-green)", flexShrink: 0 }} />
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Auto-detected from DM: <strong style={{ color: "var(--accent-green)", fontFamily: "monospace" }}>{convertTarget.ig_phone_extracted}</strong> (pre-filled)
                </div>
              </div>
            )}

            <div style={{ margin: "14px 0" }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Phone number *</label>
              <input
                value={convertForm.phone}
                onChange={(e) => setConvertForm({ ...convertForm, phone: e.target.value })}
                placeholder={convertTarget.ig_phone_extracted ? `Detected: ${convertTarget.ig_phone_extracted}` : "10-digit mobile"}
                style={{ width: "100%", height: 38, fontSize: 13, fontFamily: "ui-monospace, monospace" }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Product interest (optional)</label>
              <select value={convertForm.productInterest} onChange={(e) => setConvertForm({ ...convertForm, productInterest: e.target.value })} style={{ width: "100%", height: 38, fontSize: 13 }}>
                <option value="">— keep as {convertTarget.product_interest || "is"} —</option>
                {LOAN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Note (optional)</label>
              <input value={convertForm.notes} onChange={(e) => setConvertForm({ ...convertForm, notes: e.target.value })} placeholder="e.g. Asked about home loan rates on IG" style={{ width: "100%", height: 38, fontSize: 13 }} />
            </div>

            <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 12, border: "1px solid var(--border)", marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={convertForm.sendWa} onChange={(e) => setConvertForm({ ...convertForm, sendWa: e.target.checked })} style={{ accentColor: "var(--accent-violet)" }} />
                Send WhatsApp welcome + loan application link
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={convertForm.addToQueue} onChange={(e) => setConvertForm({ ...convertForm, addToQueue: e.target.checked })} style={{ accentColor: "var(--accent-violet)" }} />
                Add to Call Queue (high priority)
              </label>
            </div>

            <div style={{ fontSize: 11.5, color: "var(--text-muted)", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", marginBottom: 16, lineHeight: 1.6 }}>
              If this number already belongs to another CRM lead, conversion is BLOCKED and nothing is merged — you review it manually. Prospects are never silently merged.
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConvertTarget(null)} disabled={convertBusy} style={{ flex: 1, padding: 10, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)" }}>Cancel</button>
              <button onClick={convertProspect} disabled={convertBusy || !/^\d{10}$/.test(convertForm.phone.replace(/\D/g, ""))} className="btn-primary" style={{ flex: 1, height: 42 }}>
                {convertBusy ? "Converting…" : "Convert to Lead"}
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
            {[["name", "Full Name *"], ["phone", "Phone *"], ["address", "Address"], ["loan_amount", "Loan Amount (₹)"]].map(([k, l]) => {
              const isPhone = k === "phone"
              const cleanDigits = (form.phone || "").replace(/\D/g, "")
              const phoneValid = cleanDigits.length === 10 || (cleanDigits.length === 12 && cleanDigits.startsWith("91"))
              const hasPhoneError = isPhone && form.phone.trim().length > 0 && !phoneValid

              return (
                <div key={k} style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>{l}</label>
                  <div style={{ position: "relative" }}>
                    <input
                      value={(form as any)[k]}
                      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                      placeholder={isPhone ? "+91 98765 43210" : undefined}
                      style={{
                        width: "100%",
                        paddingRight: (k === "name" || k === "address") ? 36 : undefined,
                        borderColor: hasPhoneError ? "var(--accent-red)" : undefined,
                      }}
                    />
                    {(k === "name" || k === "address") && (
                      <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                        <VoiceDictation onTranscript={(t: string) => setForm((prev) => ({ ...prev, [k]: (prev as any)[k] ? `${(prev as any)[k]} ${t}` : t }))} title={`Speak ${l}`} />
                      </div>
                    )}
                  </div>
                  {hasPhoneError && (
                    <div style={{ fontSize: 11, color: "var(--accent-red)", marginTop: 4 }}>
                      Please enter a valid 10-digit Indian mobile number (e.g. 9876543210)
                    </div>
                  )}
                </div>
              )
            })}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Loan Type (Optional)</label>
              <select value={form.product_interest} onChange={(e) => setForm({ ...form, product_interest: e.target.value })}>
                <option value="">-- None / Blank (General Inquiry) --</option>
                {PRODUCT_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.products.map((t) => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            {(() => {
              const cleanDigits = (form.phone || "").replace(/\D/g, "")
              const phoneValid = cleanDigits.length === 10 || (cleanDigits.length === 12 && cleanDigits.startsWith("91"))
              const canSubmit = form.name.trim().length > 0 && phoneValid

              return (
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button onClick={() => setShowAdd(false)} style={{ flex: 1, padding: 10, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)" }}>Cancel</button>
                  <button onClick={addLead} disabled={!canSubmit} className="btn-primary" style={{ flex: 1, height: 40 }}>Add Lead</button>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Upload CSV Dialog */}
      {showUpload && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 540 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Upload Leads CSV</div>
              <button
                type="button"
                onClick={() => { setShowUpload(false); setUploadResult(null); setUploadFile(null); }}
                className="icon-btn"
                style={{ width: 28, height: 28 }}
              >
                <X size={15} />
              </button>
            </div>

            {uploadResult ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ padding: "14px 16px", borderRadius: 10, background: "rgba(45,212,160,0.1)", border: "1px solid rgba(45,212,160,0.25)", color: "var(--accent-green)", fontSize: 13, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <CheckCircle2 size={16} />
                    <span>{uploadResult.created} leads processed</span>
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                    ✓ {uploadResult.created} added · {uploadResult.duplicates ?? 0} duplicates skipped · {uploadResult.invalid ?? 0} invalid numbers
                  </div>
                  {uploadResult.destination === "queue" && (
                    <div style={{ marginTop: 8, fontWeight: 500, color: "var(--text-primary)", fontSize: 12.5 }}>
                      → {uploadResult.queued ?? uploadResult.created} waiting in Call Queue. Open Call Queue to start.
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => { setShowUpload(false); setUploadResult(null); setUploadFile(null); }}
                    className="btn-primary"
                    style={{ height: 36, padding: "0 18px" }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                    Choose file (CSV or TXT, max 2000 rows)
                  </label>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    style={{
                      width: "100%",
                      fontSize: 12.5,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                    }}
                  />
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    Columns expected: name, phone (10 digits). Optional: language, product, notes.
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                    What should happen to these contacts?
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <label style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      cursor: "pointer",
                      fontSize: 13,
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: uploadDestination === "leads" ? "1.5px solid var(--accent-blue)" : "1px solid var(--border)",
                      background: uploadDestination === "leads" ? "rgba(99, 102, 241, 0.08)" : "var(--bg-secondary)",
                      transition: "all 0.15s ease",
                    }}>
                      <input
                        type="radio"
                        name="uploadDestination"
                        value="leads"
                        checked={uploadDestination === "leads"}
                        onChange={() => setUploadDestination("leads")}
                        style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2, cursor: "pointer" }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>Just add to Leads — no calls. Call them later.</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                          Contacts will only be saved in your leads list without scheduling outbound calls.
                        </div>
                      </div>
                    </label>

                    <label style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      cursor: "pointer",
                      fontSize: 13,
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: uploadDestination === "queue" ? "1.5px solid var(--accent-blue)" : "1px solid var(--border)",
                      background: uploadDestination === "queue" ? "rgba(99, 102, 241, 0.08)" : "var(--bg-secondary)",
                      transition: "all 0.15s ease",
                    }}>
                      <input
                        type="radio"
                        name="uploadDestination"
                        value="queue"
                        checked={uploadDestination === "queue"}
                        onChange={() => setUploadDestination("queue")}
                        style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2, cursor: "pointer" }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>Add to Leads and Call Queue — they wait until you press Start.</div>
                        <div style={{ fontSize: 11, color: "var(--accent-yellow)", marginTop: 4 }}>
                          Calls only go out 8:00 AM–7:00 PM, Mon–Sat. Uploaded outside those hours? They&apos;ll wait for the next window.
                        </div>
                      </div>
                    </label>

                    {uploadDestination === "queue" && (
                      <div style={{ marginTop: 6, padding: "12px 14px", borderRadius: 10, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                            What should Priya talk about?
                          </label>
                          <select
                            value={uploadAgendaPreset}
                            onChange={(e) => onSelectUploadPreset(e.target.value)}
                            style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                          >
                            {presets.map((p) => (
                              <option key={p.id} value={p.label}>{p.label}</option>
                            ))}
                            <option value="Custom brief">Custom brief</option>
                          </select>
                        </div>

                        <textarea
                          value={uploadTalkingPoints}
                          onChange={(e) => setUploadTalkingPoints(e.target.value.slice(0, 1000))}
                          rows={3}
                          maxLength={1000}
                          placeholder="e.g. Introduce our balance-transfer offer and ask if their current EMI feels heavy. Don't pitch personal loans."
                          style={{
                            width: "100%",
                            fontSize: 12.5,
                            lineHeight: 1.45,
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid var(--border)",
                            background: "var(--bg-card)",
                            color: "var(--text-primary)",
                            resize: "vertical",
                          }}
                        />

                        {/* Soft compliance warnings */}
                        {checkAgendaRules(uploadTalkingPoints).length > 0 && (
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                            {checkAgendaRules(uploadTalkingPoints).map((w, idx) => (
                              <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: "var(--accent-yellow)", background: "rgba(234,179,8,0.08)", padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(234,179,8,0.2)" }}>
                                <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                                <span>{w.message}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                            Priya opens with this in mind — she&apos;ll say it naturally, in the customer&apos;s language, not word for word.
                          </div>
                          {uploadTalkingPoints.trim() && !presets.some((p) => p.label === uploadAgendaPreset && p.text === uploadTalkingPoints.trim()) && (
                            <button
                              type="button"
                              onClick={() => setShowSavePreset(!showSavePreset)}
                              style={{ fontSize: 11, color: "var(--accent-violet)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                            >
                              Save as preset
                            </button>
                          )}
                        </div>

                        {showSavePreset && (
                          <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                            <input
                              type="text"
                              placeholder="Preset name (e.g. Diwali BT Offer)"
                              value={saveAsPresetName}
                              onChange={(e) => setSaveAsPresetName(e.target.value)}
                              style={{ flex: 1, fontSize: 11.5, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSavePreset(saveAsPresetName, uploadTalkingPoints)}
                              disabled={!saveAsPresetName.trim() || savingPreset}
                              className="btn-primary"
                              style={{ height: 26, fontSize: 11, padding: "0 10px" }}
                            >
                              Save
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => { setShowUpload(false); setUploadFile(null); }}
                    className="btn-ghost"
                    style={{ flex: 1, height: 38 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleUploadCsv}
                    disabled={!uploadFile || uploading}
                    className="btn-primary"
                    style={{ flex: 1, height: 38 }}
                  >
                    {uploading ? "Uploading…" : "Upload"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Lead Modal */}
      {editModalLead && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: "min(460px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Edit Lead Details</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                  {editModalLead.lead_code && <LeadCodeBadge code={editModalLead.lead_code} />}
                  <span>ID: {editModalLead.id.slice(0, 8)}…</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditModalLead(null)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Full Name *</label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="e.g. Rahul Sharma"
                  style={{ width: "100%", paddingRight: 36, height: 38, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", paddingLeft: 10, fontSize: 13 }}
                />
                <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                  <VoiceDictation onTranscript={(t: string) => setEditForm((prev) => ({ ...prev, name: prev.name ? `${prev.name} ${t}` : t }))} title="Speak full name" />
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Phone Number</label>
              <input
                type="text"
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                placeholder="e.g. +91 98765 43210"
                style={{ width: "100%", height: 38, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", paddingLeft: 10, fontSize: 13 }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Address / Location</label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  placeholder="e.g. Andheri East, Mumbai"
                  style={{ width: "100%", paddingRight: 36, height: 38, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", paddingLeft: 10, fontSize: 13 }}
                />
                <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                  <VoiceDictation onTranscript={(t: string) => setEditForm((prev) => ({ ...prev, address: prev.address ? `${prev.address} ${t}` : t }))} title="Speak address" />
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Loan Amount (₹)</label>
                <input
                  type="number"
                  value={editForm.loan_amount}
                  onChange={(e) => setEditForm({ ...editForm, loan_amount: e.target.value })}
                  placeholder="e.g. 5000000"
                  style={{ width: "100%", height: 38, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", paddingLeft: 10, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Product Interest</label>
                <select
                  value={editForm.product_interest}
                  onChange={(e) => setEditForm({ ...editForm, product_interest: e.target.value })}
                  style={{ width: "100%", height: 38, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", paddingLeft: 10, fontSize: 13 }}
                >
                  <option value="">Select product...</option>
                  {editForm.product_interest && !LOAN_TYPES.includes(editForm.product_interest) && (
                    <option value={editForm.product_interest}>{editForm.product_interest}</option>
                  )}
                  {PRODUCT_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.products.map((t) => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Internal Notes</label>
              <div style={{ position: "relative" }}>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  placeholder="Notes about this lead..."
                  rows={3}
                  style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 8, padding: "8px 36px 8px 10px", fontSize: 13, resize: "vertical" }}
                />
                <div style={{ position: "absolute", right: 8, top: 10 }}>
                  <VoiceDictation onTranscript={(t: string) => setEditForm((prev) => ({ ...prev, notes: prev.notes ? `${prev.notes} ${t}` : t }))} title="Dictate notes" />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setEditModalLead(null)}
                disabled={savingEditModal}
                style={{ flex: 1, padding: 10, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEditModal}
                disabled={savingEditModal || !editForm.name.trim()}
                className="btn-primary"
                style={{ flex: 1, height: 40 }}
              >
                {savingEditModal ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call instructions modal */}
      {callTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: "min(460px, calc(100vw - 32px))" }}>
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
              <button onClick={() => dial("auto")} disabled={!!calling} className="btn-primary" style={{ flex: 1, height: 40 }}>
                <Sparkles size={14} strokeWidth={2} /> {calling === `auto-${callTarget.id}` ? "Calling…" : "Smart Dial"}
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", margin: "6px 0 10px", textAlign: "center" }}>
              Smart Dial picks WhatsApp when the lead called us recently (Meta allows the callback), otherwise a regular phone call.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => dial("phone")} disabled={!!calling} style={{ flex: 1, height: 40, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: calling ? 0.5 : 1 }}>
                <Phone size={14} strokeWidth={2} /> {calling === `phone-${callTarget.id}` ? "Calling…" : "Phone Call"}
              </button>
              <button
                onClick={() => dial("whatsapp")}
                disabled={!!calling}
                style={{
                  flex: 1, height: 40, borderRadius: 8, border: "none", cursor: "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  fontSize: 13, fontWeight: 600,
                  background: calling ? "#1f9d55" : "#25D366",
                  color: "#06331d",
                  opacity: calling ? 0.5 : 1,
                }}
              >
                <Phone size={14} strokeWidth={2} /> {calling === `whatsapp-${callTarget.id}` ? "Calling…" : "WhatsApp Call"}
              </button>
            </div>
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

      {/* Send Application Link Modal */}
      {bankLinkTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 26, width: "100%", maxWidth: 440 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <FileText size={18} strokeWidth={2} style={{ color: "var(--accent-cyan)" }} />
                <div style={{ fontWeight: 700, fontSize: 16 }}>Send Application Link</div>
              </div>
              <button
                type="button"
                onClick={() => setBankLinkTarget(null)}
                className="icon-btn"
                style={{ width: 28, height: 28 }}
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 14 }}>
              Customer: <strong style={{ color: "var(--text-primary)" }}>{bankLinkTarget.name || "Customer"}</strong> · {bankLinkTarget.phone || bankLinkTarget.whatsapp_number}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Loan Product</label>
                <select
                  value={bankProduct}
                  onChange={(e) => setBankProduct(e.target.value)}
                  style={{ width: "100%", height: 38, fontSize: 13, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
                >
                  {COMMON_LOAN_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 18 }}>
              💡 Sends Right Agent Group&apos;s loan application link via WhatsApp. When the customer opens it, their name and details are auto-filled, and their submitted application logs directly into your dashboard.
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setBankLinkTarget(null)}
                className="btn-ghost"
                style={{ flex: 1, height: 38 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendBankLink}
                disabled={sendingBankLink}
                className="btn-primary"
                style={{ flex: 1, height: 38 }}
              >
                {sendingBankLink ? "Sending…" : "Send via WhatsApp"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk WhatsApp Campaign Modal */}
      {showBulkWaModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 26, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(37,211,102,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "#25D366" }}>
                  <MessageCircle size={16} strokeWidth={2.4} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>
                  Send Bulk WhatsApp Message
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!bulkWaBusy) {
                    setBulkWaResult(null)
                    setShowBulkWaModal(false)
                  }
                }}
                className="icon-btn"
                style={{ width: 28, height: 28 }}
              >
                <X size={15} />
              </button>
            </div>

            {bulkWaResult ? (
              <div>
                <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
                  <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(34,197,94,0.15)", border: "2px solid #22c55e", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#22c55e", marginBottom: 12 }}>
                    <CheckCircle2 size={26} strokeWidth={2.4} />
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>
                    Bulk WhatsApp Campaign Sent!
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    Results have been saved to your System Audit Log.
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
                  <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Delivered</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#22c55e", marginTop: 4 }}>{bulkWaResult.sentCount}</div>
                  </div>
                  <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Skipped (DND)</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#eab308", marginTop: 4 }}>{bulkWaResult.skippedDnd}</div>
                  </div>
                  <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Failed</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: bulkWaResult.failedCount > 0 ? "#ef4444" : "var(--text-muted)", marginTop: 4 }}>{bulkWaResult.failedCount}</div>
                  </div>
                </div>

                {bulkWaResult.errors && bulkWaResult.errors.length > 0 && (
                  <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 14px", fontSize: 11.5, color: "#f87171", marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                      ⚠️ Meta Rejection Details:
                    </div>
                    {bulkWaResult.errors.map((err, idx) => (
                      <div key={idx} style={{ marginTop: 3, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
                        • {err}
                      </div>
                    ))}
                    {bulkWaResult.errors.some((e) => e.includes("132001") || e.includes("does not exist")) && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                        💡 <strong>Why this failed:</strong> Meta only sends templates that already exist in your Meta WhatsApp Business Manager.
                        <br />• <strong>To test immediately:</strong> Pick <code style={{ color: "#22c55e" }}>hello_world</code> (Lang: <code style={{ color: "#22c55e" }}>en_US</code>) — Meta pre-approves this for instant testing!
                        <br />• <strong>To send custom templates:</strong> Go to <em>Priya&apos;s Script &gt; WhatsApp &amp; Meta Templates</em>, click <em>Copy for Meta Approval</em>, and paste it into your Meta WhatsApp Manager.
                      </div>
                    )}
                    {bulkWaResult.errors.some((e) => e.includes("131030") || e.includes("allowed list")) && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                        💡 <strong>Why this failed:</strong> In Meta Sandbox test mode, you can only send messages to phone numbers added to your Meta Developer Console allowed list (e.g. 6301689511).
                      </div>
                    )}
                  </div>
                )}

                <div style={{ background: "rgba(37,211,102,0.06)", border: "1px solid rgba(37,211,102,0.2)", borderRadius: 10, padding: "12px 14px", fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 18, lineHeight: 1.6 }}>
                  🛡️ <strong>Permanent Audit History:</strong> This summary is saved in <strong>Security &gt; Audit Log</strong> for complete compliance tracking. Outbound messages are recorded in each customer&apos;s history and in <strong>WhatsApp Inbox</strong>, where AI responds to replies automatically.
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setBulkWaResult(null)
                    setShowBulkWaModal(false)
                  }}
                  className="btn-primary"
                  style={{ width: "100%", height: 38, fontSize: 13, fontWeight: 600 }}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 14 }}>
                  Blasting to <strong style={{ color: "var(--accent-green)" }}>{selectedIds.length} selected lead{selectedIds.length === 1 ? "" : "s"}</strong> over official Meta WhatsApp Cloud API.
                </div>

                {/* Send Mode Selector: Meta Template vs Free-form */}
                <div style={{ display: "flex", gap: 6, marginBottom: 14, background: "var(--bg-secondary)", padding: 4, borderRadius: 8, border: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => setBulkWaMode("template")}
                    style={{
                      flex: 1,
                      height: 32,
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: "none",
                      background: bulkWaMode === "template" ? "#25D366" : "transparent",
                      color: bulkWaMode === "template" ? "#06331d" : "var(--text-secondary)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    🛡️ Meta Approved Template
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkWaMode("text")}
                    style={{
                      flex: 1,
                      height: 32,
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: "none",
                      background: bulkWaMode === "text" ? "var(--bg-card)" : "transparent",
                      color: bulkWaMode === "text" ? "var(--text-primary)" : "var(--text-secondary)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    💬 Free-form Text (24h Window)
                  </button>
                </div>

                {bulkWaMode === "template" ? (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ background: "rgba(37,211,102,0.06)", border: "1px solid rgba(37,211,102,0.2)", borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      ✅ <strong>Recommended for Cold &amp; Follow-up Leads:</strong> Meta approved templates deliver 100% reliably even if the customer hasn&apos;t messaged you recently. The CRM automatically fills &#123;&#123;1&#125;&#125; with the customer&apos;s name and maps the action button to their one-time application link.
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4, fontWeight: 500 }}>
                        Meta Template Name
                      </label>
                      <input
                        type="text"
                        value={bulkWaTemplateName}
                        onChange={(e) => setBulkWaTemplateName(e.target.value)}
                        placeholder="e.g. loan_application_form, call_followup, or custom template"
                        style={{
                          width: "100%",
                          height: 36,
                          padding: "0 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--bg-secondary)",
                          color: "var(--text-primary)",
                          fontSize: 12.5,
                        }}
                      />
                    </div>

                    {/* Quick suggestion chips from Meta Catalog */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Choose Template Preset:</span>
                        <span style={{ fontSize: 10, color: "#22c55e", background: "rgba(34,197,94,0.12)", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                          ⚡ hello_world is pre-approved by Meta
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {META_TEMPLATES_CATALOG.map((p) => {
                          const isSelected = bulkWaTemplateName === p.name
                          const isReady = p.name === "hello_world"
                          return (
                            <button
                              key={p.name}
                              type="button"
                              onClick={() => {
                                setBulkWaTemplateName(p.name)
                                if (p.languages[0]?.code) setBulkWaTemplateLang(p.languages[0].code)
                              }}
                              style={{
                                fontSize: 11,
                                padding: "4px 9px",
                                borderRadius: 6,
                                border: isSelected
                                  ? (isReady ? "1px solid #22c55e" : "1px solid #38bdf8")
                                  : (isReady ? "1px solid rgba(34,197,94,0.4)" : "1px solid var(--border)"),
                                background: isSelected
                                  ? (isReady ? "rgba(34,197,94,0.2)" : "rgba(56,189,248,0.18)")
                                  : (isReady ? "rgba(34,197,94,0.06)" : "var(--bg-secondary)"),
                                color: isSelected
                                  ? (isReady ? "#4ade80" : "#38bdf8")
                                  : (isReady ? "#22c55e" : "var(--text-secondary)"),
                                cursor: "pointer",
                                fontWeight: isSelected ? 700 : 500,
                              }}
                            >
                              {p.name === "hello_world" ? "🌍 hello_world (Instant Test)" : `📄 ${p.name}`}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                          Template Language
                        </label>
                        <select
                          value={bulkWaTemplateLang}
                          onChange={(e) => setBulkWaTemplateLang(e.target.value)}
                          style={{ width: "100%", height: 34, fontSize: 12, padding: "0 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                        >
                          <option value="en_US">English US (en_US)</option>
                          <option value="en">English (en)</option>
                          <option value="te">Telugu (te)</option>
                          <option value="hi">Hindi (hi)</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                          Link Loan Product
                        </label>
                        <select
                          value={bulkWaProduct}
                          onChange={(e) => setBulkWaProduct(e.target.value)}
                          style={{ width: "100%", height: 34, fontSize: 12, padding: "0 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                        >
                          {COMMON_LOAN_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Live Meta Template Preview & Copy */}
                    {(() => {
                      const curTpl = META_TEMPLATES_CATALOG.find((t) => t.name === bulkWaTemplateName)
                      if (!curTpl) return null
                      return (
                        <div style={{ marginTop: 12, background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 11.5 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, color: "var(--accent-green)" }}>
                              📋 {curTpl.displayName}
                            </span>
                            <span style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 4, background: curTpl.category === "UTILITY" ? "rgba(59,130,246,0.2)" : "rgba(234,179,8,0.2)", color: curTpl.category === "UTILITY" ? "#60a5fa" : "#facc15", fontWeight: 700 }}>
                              {curTpl.category}
                            </span>
                          </div>
                          <div style={{ color: "#d1d5db", lineHeight: 1.45, whiteSpace: "pre-wrap", fontSize: 11, margin: "6px 0" }}>
                            {curTpl.samplePreview}
                          </div>
                          {curTpl.name !== "hello_world" && (
                            <div style={{ background: "rgba(234,179,8,0.09)", border: "1px solid rgba(234,179,8,0.3)", borderRadius: 6, padding: "6px 10px", margin: "8px 0", fontSize: 11, color: "#facc15", lineHeight: 1.4 }}>
                              ⚠️ <strong>Meta Submission Needed:</strong> Before Meta will deliver &quot;{curTpl.name}&quot;, it must be created in your Meta WhatsApp Manager (click &quot;Copy Format&quot; below). For instant sending right now, choose <strong>🌍 hello_world</strong>!
                            </div>
                          )}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                              {curTpl.pricing}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (typeof navigator !== "undefined" && navigator.clipboard) {
                                  navigator.clipboard.writeText(curTpl.copyTextForMeta)
                                  toast.success(`Copied "${curTpl.name}" format for Meta WhatsApp Manager`)
                                }
                              }}
                              style={{ fontSize: 10.5, color: "#25D366", background: "transparent", border: "none", cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}
                            >
                              📋 Copy Format for Meta Approval
                            </button>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                ) : (
                  <>
                    {/* Quick Template Chips for freeform */}
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginBottom: 6, fontWeight: 500 }}>
                        Quick Message Prompts ({`{name}`} auto-filled)
                      </label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => setBulkWaMessage("Hello {name}, greetings from Right Agent Group! We provide fast-track approval on Personal, Business, and Home Loans with minimal documentation and attractive interest rates.")}
                          style={{ textAlign: "left", fontSize: 11.5, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
                        >
                          🟢 <strong>General Loan Offer:</strong> &quot;Hello {`{name}`}, greetings from Right Agent Group! We provide fast-track approval...&quot;
                        </button>
                        <button
                          type="button"
                          onClick={() => setBulkWaMessage("Hello {name}, this is a gentle follow-up regarding your recent loan inquiry with Right Agent Group. Our loan officer is ready to process your file. Please complete your application below.")}
                          style={{ textAlign: "left", fontSize: 11.5, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
                        >
                          📄 <strong>Application Follow-up:</strong> &quot;Hello {`{name}`}, this is a gentle follow-up regarding your recent loan inquiry...&quot;
                        </button>
                        <button
                          type="button"
                          onClick={() => setBulkWaMessage("Hello {name}, to fast-track your loan file approval, please keep your PAN Card, Aadhaar, and 6 months bank statement ready. Our advisor will guide you through instant sanction.")}
                          style={{ textAlign: "left", fontSize: 11.5, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
                        >
                          📋 <strong>Document Checklist:</strong> &quot;Hello {`{name}`}, to fast-track your loan file approval, please keep your PAN Card...&quot;
                        </button>
                        <button
                          type="button"
                          onClick={() => setBulkWaMessage("Hello {name}, special festive offer! Avail Home and Business Loans starting from 7.25% p.a. through 20+ partner banks in Hyderabad with minimal documentation.")}
                          style={{ textAlign: "left", fontSize: 11.5, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
                        >
                          🎉 <strong>Festive Rate Offer:</strong> &quot;Hello {`{name}`}, special festive offer! Avail Home and Business Loans...&quot;
                        </button>
                        <button
                          type="button"
                          onClick={() => setBulkWaMessage("నమస్కారం {name} గారు, రైట్ ఏజెంట్ గ్రూప్ నుండి మాట్లాడుతున్నాము. మీకు హోమ్ లోన్ లేదా బిజినెస్ లోన్ తక్కువ వడ్డీతో అవసరమా? మా బ్యాంకింగ్ కౌన్సిలర్ మీకు వెంటనే సహాయం చేస్తారు.")}
                          style={{ textAlign: "left", fontSize: 11.5, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
                        >
                          🇮🇳 <strong>Telugu Offer:</strong> &quot;నమస్కారం {`{name}`} గారు, రైట్ ఏజెంట్ గ్రూప్ నుండి...&quot;
                        </button>
                        <button
                          type="button"
                          onClick={() => setBulkWaMessage("नमस्ते {name} जी, राइट एजेंट ग्रुप से नमस्कार। यदि आपको होम, पर्सनल या बिजनेस लोन की आवश्यकता है तो सबसे कम ब्याज दरों पर आवेदन करें।")}
                          style={{ textAlign: "left", fontSize: 11.5, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
                        >
                          🇮🇳 <strong>Hindi Offer:</strong> &quot;नमस्ते {`{name}`} जी, राइट एजेंट ग्रुप से नमस्कार...&quot;
                        </button>
                      </div>
                    </div>

                    {/* Message Body Textarea */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <label style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
                          Message Content *
                        </label>
                        <span style={{ fontSize: 10.5, color: "var(--accent-violet)" }}>Use {`{name}`} for customer&apos;s name</span>
                      </div>
                      <textarea
                        value={bulkWaMessage}
                        onChange={(e) => setBulkWaMessage(e.target.value)}
                        placeholder="Type your WhatsApp message here..."
                        rows={4}
                        style={{
                          width: "100%",
                          fontSize: 12.5,
                          padding: 10,
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--bg-secondary)",
                          color: "var(--text-primary)",
                          resize: "vertical",
                        }}
                      />
                    </div>

                    {/* Include Link Toggle & Product */}
                    <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 12, border: "1px solid var(--border)", marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: bulkWaIncludeLink ? 10 : 0 }}>
                        <input
                          type="checkbox"
                          id="bulkWaIncludeLinkToggle"
                          checked={bulkWaIncludeLink}
                          onChange={(e) => setBulkWaIncludeLink(e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: "#25D366", cursor: "pointer" }}
                        />
                        <label htmlFor="bulkWaIncludeLinkToggle" style={{ fontSize: 12.5, color: "var(--text-primary)", cursor: "pointer", fontWeight: 600 }}>
                          Include Personalized One-Time Application Link
                        </label>
                      </div>

                      {bulkWaIncludeLink && (
                        <div>
                          <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                            Link Loan Product (Directs applicant to this form)
                          </label>
                          <select
                            value={bulkWaProduct}
                            onChange={(e) => setBulkWaProduct(e.target.value)}
                            style={{ width: "100%", height: 34, fontSize: 12, padding: "0 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                          >
                            {COMMON_LOAN_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </>
                )}

            {/* Compliance Note */}
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
              🛡️ DND protection is active. Numbers registered on your DND/suppression list will be skipped automatically to keep your Meta WhatsApp account compliant.
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowBulkWaModal(false)}
                disabled={bulkWaBusy}
                className="btn-ghost"
                style={{ flex: 1, height: 40 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendBulkWaCampaign}
                disabled={bulkWaBusy || !bulkWaMessage.trim()}
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: 8,
                  border: "none",
                  background: "#25D366",
                  color: "#06331d",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  opacity: bulkWaBusy ? 0.7 : 1,
                }}
              >
                <MessageCircle size={16} strokeWidth={2.4} />
                {bulkWaBusy ? "Sending…" : `Send to ${selectedIds.length} Lead${selectedIds.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )}

      {memoryLeadId && (
        <LeadMemoryModal leadId={memoryLeadId} canEdit={canEdit} onClose={() => setMemoryLeadId(null)} />
      )}
    </div>
  )
}
