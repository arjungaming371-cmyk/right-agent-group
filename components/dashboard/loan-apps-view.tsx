"use client"

import React, { useEffect, useState, useCallback, useMemo } from "react"
import {
  ExternalLink, CheckCircle2, Clock, Eye, AlertCircle, RefreshCw,
  Search, Landmark, DollarSign, Check, X, Filter, Plus, Pencil, Trash2,
  Copy, Link2, FileText, Globe, Layers, ArrowUpRight, MessageSquare,
  Settings2, Tag, ChevronDown, History, Info
} from "lucide-react"
import { formatCurrency, timeAgo, formatDateTime } from "@/lib/utils"
import { usePolling, broadcastCrmSync } from "@/lib/use-poll"
import { SkeletonList } from "../ui/skeleton"
import { useToast } from "../ui/toast"
import CustomSelect from "../ui/custom-select"
import { COMMON_LOAN_TYPES } from "@/lib/products"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

interface LoanLink {
  id: string
  bank: string
  product: string
  url: string
  active: boolean
  created_at: string
}

export interface CustomStatus {
  id: string
  label: string
  color: string
  bg_color: string
  icon: string
  category: "pending" | "sanctioned" | "rejected" | "disbursed"
  is_default: boolean
  sort_order: number
}

const STATUS_COLOR_PRESETS = [
  { name: "Violet", color: "#8B5CF6", bg: "rgba(139,92,246,0.15)" },
  { name: "Blue", color: "#3B82F6", bg: "rgba(59,130,246,0.15)" },
  { name: "Cyan", color: "#06B6D4", bg: "rgba(6,182,212,0.15)" },
  { name: "Emerald", color: "#10B981", bg: "rgba(16,185,129,0.15)" },
  { name: "Amber", color: "#F59E0B", bg: "rgba(245,158,11,0.15)" },
  { name: "Rose", color: "#F43F5E", bg: "rgba(244,63,94,0.15)" },
  { name: "Orange", color: "#F97316", bg: "rgba(249,115,22,0.15)" },
]

const QUICK_REJECTION_REASONS = [
  "Low CIBIL score (below 650)",
  "Salary below minimum criteria (< ₹25,000/mo)",
  "Existing EMIs exceed 50% of monthly income",
  "Incomplete documents / salary slips not provided",
  "Past loan default or write-off in CIBIL report",
  "Company not in bank approved category list",
]

const QUICK_PENDING_REASONS = [
  "3 months bank statements pending from customer",
  "Address / KYC verification in progress",
  "Waiting for bank underwriter review",
  "Customer requested call back tomorrow",
  "Co-applicant documents requested",
]

export default function LoanAppsView({ role, initialSearch }: { role: Role; initialSearch?: string }) {
  const canEdit = role !== "viewer"
  const toast = useToast()

  // Tab: "apps" (Customer Applications) | "links" (Loan Type Links & Routing)
  const [activeTab, setActiveTab] = useState<"apps" | "links">("apps")

  // Applications state
  const [search, setSearch] = useState(initialSearch || "")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [internalApps, setInternalApps] = useState<any[]>([])
  const [loadingInternal, setLoadingInternal] = useState(false)
  const [updatingAppId, setUpdatingAppId] = useState<string | null>(null)

  // Statuses state (Default + Custom)
  const [statuses, setStatuses] = useState<CustomStatus[]>([
    { id: "pending", label: "Under Review / Pending", color: "#EAB308", bg_color: "rgba(234,179,8,0.15)", icon: "⏳", category: "pending", is_default: true, sort_order: 1 },
    { id: "sanctioned", label: "Sanctioned", color: "#38BDF8", bg_color: "rgba(56,189,248,0.15)", icon: "✅", category: "sanctioned", is_default: true, sort_order: 2 },
    { id: "rejected", label: "Not Sanctioned / Rejected", color: "#EF4444", bg_color: "rgba(239,68,68,0.15)", icon: "❌", category: "rejected", is_default: true, sort_order: 3 },
    { id: "disbursed", label: "Disbursed", color: "#22C55E", bg_color: "rgba(34,197,94,0.15)", icon: "💰", category: "disbursed", is_default: true, sort_order: 4 },
  ])
  const [showManageStatusModal, setShowManageStatusModal] = useState(false)
  const [newStatusLabel, setNewStatusLabel] = useState("")
  const [newStatusIcon, setNewStatusIcon] = useState("📌")
  const [newStatusColor, setNewStatusColor] = useState("#8B5CF6")
  const [newStatusCategory, setNewStatusCategory] = useState<"pending" | "sanctioned" | "rejected" | "disbursed">("pending")
  const [savingCustomStatus, setSavingCustomStatus] = useState(false)

  // Remark & Status Change Modal state
  const [activeRemarkApp, setActiveRemarkApp] = useState<any | null>(null)
  const [targetStatus, setTargetStatus] = useState<string>("pending")
  const [statusReasonText, setStatusReasonText] = useState("")
  const [remarkText, setRemarkText] = useState("")
  const [savingRemark, setSavingRemark] = useState(false)

  // History timeline modal state
  const [viewHistoryApp, setViewHistoryApp] = useState<any | null>(null)

  // Loan Type Links state
  const [links, setLinks] = useState<LoanLink[]>([])
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [linkSearch, setLinkSearch] = useState("")

  // Add / Edit Modal state
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [editingLink, setEditingLink] = useState<LoanLink | null>(null)
  const [linkFormProduct, setLinkFormProduct] = useState("Home Loan")
  const [customProduct, setCustomProduct] = useState("")
  const [linkFormUrl, setLinkFormUrl] = useState("")
  const [linkFormBank, setLinkFormBank] = useState("Right Agent Group")
  const [linkFormActive, setLinkFormActive] = useState(true)
  const [savingLink, setSavingLink] = useState(false)
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null)

  // Load statuses
  const loadStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/loans/statuses")
      if (res.ok) {
        const d = await res.json()
        if (Array.isArray(d.statuses) && d.statuses.length > 0) {
          setStatuses(d.statuses)
        }
      }
    } catch {}
  }, [])

  // Load customer loan applications
  const loadInternalApps = useCallback(async () => {
    setLoadingInternal(true)
    try {
      const res = await fetch("/api/loans")
      if (res.ok) {
        const data = await res.json()
        setInternalApps(Array.isArray(data) ? data : [])
      }
    } catch {} finally {
      setLoadingInternal(false)
    }
  }, [])

  // Load loan type links
  const loadLinks = useCallback(async () => {
    setLoadingLinks(true)
    try {
      const res = await fetch("/api/links/library?all=true")
      if (res.ok) {
        const data = await res.json()
        setLinks(Array.isArray(data) ? data : [])
      }
    } catch {} finally {
      setLoadingLinks(false)
    }
  }, [])

  useEffect(() => {
    loadInternalApps()
    loadLinks()
    loadStatuses()
  }, [loadInternalApps, loadLinks, loadStatuses])

  usePolling(loadInternalApps, 15000)

  // Helper to get status metadata
  function getStatusMeta(statusKey?: string) {
    const k = (statusKey || "pending").toLowerCase()
    const found = statuses.find((s) => s.id === k)
    if (found) return found
    if (/sanctioned|approved/i.test(k)) {
      return { id: k, label: "Sanctioned", color: "#38BDF8", bg_color: "rgba(56,189,248,0.15)", icon: "✅", category: "sanctioned", is_default: true, sort_order: 2 }
    }
    if (/rejected|lost/i.test(k)) {
      return { id: k, label: "Not Sanctioned / Rejected", color: "#EF4444", bg_color: "rgba(239,68,68,0.15)", icon: "❌", category: "rejected", is_default: true, sort_order: 3 }
    }
    if (/disbursed/i.test(k)) {
      return { id: k, label: "Disbursed", color: "#22C55E", bg_color: "rgba(34,197,94,0.15)", icon: "💰", category: "disbursed", is_default: true, sort_order: 4 }
    }
    return { id: k, label: k.replace(/_/g, " "), color: "#EAB308", bg_color: "rgba(234,179,8,0.15)", icon: "⏳", category: "pending", is_default: false, sort_order: 99 }
  }

  // Open the remark & status update modal
  function openRemarkModal(app: any, initialNewStatus?: string) {
    setActiveRemarkApp(app)
    setTargetStatus(initialNewStatus || app.status || "pending")
    setStatusReasonText(app.status_reason || "")
    setRemarkText(app.remarks || "")
  }

  // Save Remarks & Status
  async function handleSaveRemark(e: React.FormEvent) {
    e.preventDefault()
    if (!activeRemarkApp) return
    setSavingRemark(true)
    try {
      const res = await fetch("/api/loans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeRemarkApp.id,
          status: targetStatus,
          status_reason: statusReasonText.trim() || null,
          remarks: remarkText.trim() || null,
        }),
      })
      if (res.ok) {
        toast.success(`Application updated with remarks & status`)
        setInternalApps((prev) =>
          prev.map((a) =>
            a.id === activeRemarkApp.id
              ? {
                  ...a,
                  status: targetStatus,
                  status_reason: statusReasonText.trim() || null,
                  remarks: remarkText.trim() || null,
                  status_history: [
                    ...(a.status_history || []),
                    {
                      status: targetStatus,
                      status_reason: statusReasonText.trim() || null,
                      remarks: remarkText.trim() || null,
                      updated_at: new Date().toISOString(),
                    },
                  ],
                }
              : a
          )
        )
        setActiveRemarkApp(null)
        broadcastCrmSync()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Failed to save remarks")
      }
    } catch {
      toast.error("Network error saving remarks")
    } finally {
      setSavingRemark(false)
    }
  }

  // Create new custom status
  async function handleCreateCustomStatus(e: React.FormEvent) {
    e.preventDefault()
    if (!newStatusLabel.trim()) return
    setSavingCustomStatus(true)
    try {
      const preset = STATUS_COLOR_PRESETS.find((p) => p.color === newStatusColor) || STATUS_COLOR_PRESETS[0]
      const res = await fetch("/api/loans/statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newStatusLabel.trim(),
          icon: newStatusIcon || "📌",
          color: preset.color,
          bg_color: preset.bg,
          category: newStatusCategory,
        }),
      })
      const d = await res.json()
      if (res.ok) {
        toast.success(`Created status "${newStatusLabel}"`)
        setNewStatusLabel("")
        loadStatuses()
      } else {
        toast.error(d.error || "Failed to create status")
      }
    } catch {
      toast.error("Network error creating status")
    } finally {
      setSavingCustomStatus(false)
    }
  }

  // Delete custom status
  async function handleDeleteCustomStatus(id: string, label: string) {
    if (!confirm(`Are you sure you want to delete status "${label}"?`)) return
    try {
      const res = await fetch(`/api/loans/statuses?id=${id}`, { method: "DELETE" })
      if (res.ok) {
        toast.success(`Deleted status "${label}"`)
        setStatuses((prev) => prev.filter((s) => s.id !== id))
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Failed to delete status")
      }
    } catch {
      toast.error("Network error deleting status")
    }
  }

  // Update internal customer application status directly (Quick Select)
  async function updateInternalAppStatus(app: any, newStatus: string) {
    // If selected "manage", open status management modal
    if (newStatus === "__manage__") {
      setShowManageStatusModal(true)
      return
    }

    // If changing to rejected or custom, open the modal with reason input
    if (newStatus === "rejected" || !["pending", "sanctioned", "disbursed"].includes(newStatus)) {
      openRemarkModal(app, newStatus)
      return
    }

    setUpdatingAppId(app.id)
    try {
      const res = await fetch("/api/loans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: app.id,
          status: newStatus,
        }),
      })
      if (res.ok) {
        toast.success(`Application marked as ${newStatus.toUpperCase()}`)
        setInternalApps((prev) =>
          prev.map((a) => (a.id === app.id ? { ...a, status: newStatus } : a))
        )
        broadcastCrmSync()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Could not update status")
      }
    } catch {
      toast.error("Network error updating application")
    } finally {
      setUpdatingAppId(null)
    }
  }

  // Open modal to add link
  function openAddLinkModal() {
    setEditingLink(null)
    setLinkFormProduct("Home Loan")
    setCustomProduct("")
    setLinkFormUrl("")
    setLinkFormBank("Right Agent Group")
    setLinkFormActive(true)
    setShowLinkModal(true)
  }

  // Open modal to edit existing link
  function openEditLinkModal(link: LoanLink) {
    setEditingLink(link)
    if (COMMON_LOAN_TYPES.includes(link.product)) {
      setLinkFormProduct(link.product)
      setCustomProduct("")
    } else {
      setLinkFormProduct("custom")
      setCustomProduct(link.product)
    }
    setLinkFormUrl(link.url)
    setLinkFormBank(link.bank || "Right Agent Group")
    setLinkFormActive(link.active)
    setShowLinkModal(true)
  }

  // Save (Create or Update) Link
  async function handleSaveLink(e: React.FormEvent) {
    e.preventDefault()
    const product = linkFormProduct === "custom" ? customProduct.trim() : linkFormProduct
    const url = linkFormUrl.trim()
    const bank = linkFormBank.trim() || "Right Agent Group"

    if (!product) {
      toast.error("Please enter or select a Loan Type")
      return
    }
    if (!url) {
      toast.error("Please enter the Application Link URL")
      return
    }

    setSavingLink(true)
    try {
      if (editingLink) {
        // Update existing link (PATCH)
        const res = await fetch("/api/links/library", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingLink.id,
            bank,
            product,
            url,
            active: linkFormActive,
          }),
        })
        const d = await res.json()
        if (res.ok) {
          toast.success(`Updated ${product} application link`)
          setShowLinkModal(false)
          loadLinks()
          broadcastCrmSync()
        } else {
          toast.error(d.error || "Failed to update link")
        }
      } else {
        // Create new link (POST)
        const res = await fetch("/api/links/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bank,
            product,
            url,
            active: linkFormActive,
          }),
        })
        const d = await res.json()
        if (res.ok) {
          toast.success(`Added ${product} application link`)
          setShowLinkModal(false)
          loadLinks()
          broadcastCrmSync()
        } else {
          toast.error(d.error || "Failed to add link")
        }
      }
    } catch {
      toast.error("Failed to save application link")
    } finally {
      setSavingLink(false)
    }
  }

  // Delete Link
  async function handleDeleteLink(id: string, product: string) {
    if (!confirm(`Are you sure you want to delete the application link for ${product}?`)) return
    setDeletingLinkId(id)
    try {
      const res = await fetch(`/api/links/library?id=${id}`, {
        method: "DELETE",
      })
      if (res.ok) {
        toast.success(`Deleted application link for ${product}`)
        setLinks((prev) => prev.filter((l) => l.id !== id))
        broadcastCrmSync()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Failed to delete link")
      }
    } catch {
      toast.error("Network error deleting link")
    } finally {
      setDeletingLinkId(null)
    }
  }

  // Toggle active status directly
  async function toggleLinkActive(link: LoanLink) {
    try {
      const res = await fetch("/api/links/library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: link.id,
          active: !link.active,
        }),
      })
      if (res.ok) {
        toast.success(`${link.product} link is now ${!link.active ? "ACTIVE" : "INACTIVE"}`)
        setLinks((prev) =>
          prev.map((l) => (l.id === link.id ? { ...l, active: !l.active } : l))
        )
        broadcastCrmSync()
      } else {
        toast.error("Failed to toggle status")
      }
    } catch {
      toast.error("Failed to toggle status")
    }
  }

  // Copy URL to clipboard
  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text)
    toast.success(`Copied ${label} link to clipboard`)
  }

  const internalStats = useMemo(() => {
    const total = internalApps.length
    const approved = internalApps.filter((a) => /approved|sanctioned/i.test(a.status || "")).length
    const pending = internalApps.filter((a) => /pending|review|new/i.test(a.status || "")).length
    const disbursed = internalApps.filter((a) => /disbursed/i.test(a.status || "")).length
    const totalVolume = internalApps.reduce((acc, a) => acc + (Number(a.loan_amount) || 0), 0)
    const approvedVolume = internalApps
      .filter((a) => /approved|sanctioned|disbursed/i.test(a.status || ""))
      .reduce((acc, a) => acc + (Number(a.loan_amount) || 0), 0)

    return {
      total,
      approved,
      pending,
      disbursed,
      totalVolume,
      approvedVolume: approvedVolume || totalVolume,
    }
  }, [internalApps])

  const filteredApps = useMemo(() => {
    return internalApps.filter((app) => {
      // Status filter
      if (statusFilter !== "all") {
        const appSt = (app.status || "pending").toLowerCase()
        if (statusFilter === "pending" && !/pending|review|new/i.test(appSt)) return false
        if (statusFilter === "sanctioned" && !/sanctioned|approved/i.test(appSt)) return false
        if (statusFilter === "disbursed" && !/disbursed/i.test(appSt)) return false
        if (statusFilter === "rejected" && !/rejected|lost/i.test(appSt)) return false
        if (!["pending", "sanctioned", "disbursed", "rejected"].includes(statusFilter) && appSt !== statusFilter.toLowerCase()) return false
      }

      // Search filter
      if (!search.trim()) return true
      const s = search.toLowerCase()
      return (
        (app.customer_name || "").toLowerCase().includes(s) ||
        (app.phone || "").toLowerCase().includes(s) ||
        (app.loan_type || "").toLowerCase().includes(s) ||
        (app.city || "").toLowerCase().includes(s) ||
        (app.status_reason || "").toLowerCase().includes(s) ||
        (app.remarks || "").toLowerCase().includes(s)
      )
    })
  }, [internalApps, statusFilter, search])

  const filteredLinks = useMemo(() => {
    if (!linkSearch.trim()) return links
    const s = linkSearch.toLowerCase()
    return links.filter(
      (l) =>
        (l.product || "").toLowerCase().includes(s) ||
        (l.bank || "").toLowerCase().includes(s) ||
        (l.url || "").toLowerCase().includes(s)
    )
  }, [links, linkSearch])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Primary Tab Navigation: Customer Applications vs Loan Type Links */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, borderBottom: "1px solid var(--border)", paddingBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setActiveTab("apps")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 38,
              padding: "0 16px",
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.15s",
              border: activeTab === "apps" ? "none" : "1px solid var(--border)",
              background: activeTab === "apps" ? "var(--gradient-brand)" : "var(--bg-card)",
              color: activeTab === "apps" ? "#fff" : "var(--text-secondary)",
            }}
          >
            <FileText size={15} strokeWidth={2} />
            Customer Applications
            <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 10, background: activeTab === "apps" ? "rgba(255,255,255,0.22)" : "var(--overlay-chip)", color: activeTab === "apps" ? "#fff" : "var(--text-primary)", fontWeight: 700 }}>
              {internalApps.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("links")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 38,
              padding: "0 16px",
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.15s",
              border: activeTab === "links" ? "none" : "1px solid var(--border)",
              background: activeTab === "links" ? "var(--gradient-brand)" : "var(--bg-card)",
              color: activeTab === "links" ? "#fff" : "var(--text-secondary)",
            }}
          >
            <Link2 size={15} strokeWidth={2} />
            Loan Type Links &amp; Routing
            <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 10, background: activeTab === "links" ? "rgba(255,255,255,0.22)" : "var(--overlay-chip)", color: activeTab === "links" ? "#fff" : "var(--text-primary)", fontWeight: 700 }}>
              {links.length}
            </span>
          </button>
        </div>

        {activeTab === "links" && canEdit && (
          <button
            type="button"
            onClick={openAddLinkModal}
            className="btn-primary"
            style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", fontSize: 12.5 }}
          >
            <Plus size={15} strokeWidth={2.2} />
            Add Loan Link
          </button>
        )}
      </div>

      {/* ======================================================== */}
      {/* TAB 1: CUSTOMER APPLICATIONS */}
      {/* ======================================================== */}
      {activeTab === "apps" && (
        <>
          {/* Top Banner & Financial Metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <div className="card" style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4 }}>
                Customer Applications
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
                {internalStats.total}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                Submitted via WhatsApp, Web & Ads
              </div>
            </div>

            <div className="card" style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4 }}>
                Approved / Sanctioned
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent-green)" }}>
                {internalStats.approved}
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)", marginLeft: 6 }}>
                  ({internalStats.total > 0 ? Math.round((internalStats.approved / internalStats.total) * 100) : 0}%)
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                Verified & credit eligible
              </div>
            </div>

            <div className="card" style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4 }}>
                Under Review / In Progress
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent-violet)" }}>
                {internalStats.pending}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                {internalStats.approved} ready for bank login
              </div>
            </div>

            <div className="card" style={{ padding: "16px 20px", background: "linear-gradient(145deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02))", borderColor: "rgba(34,197,94,0.25)" }}>
              <div style={{ fontSize: 12, color: "var(--accent-green)", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                <DollarSign size={13} strokeWidth={2.2} /> Pipeline / Approved Volume
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
                {formatCurrency(internalStats.approvedVolume)}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--accent-green)", marginTop: 4, fontWeight: 500 }}>
                Est. DSA Payout: ~{formatCurrency(Math.round(internalStats.approvedVolume * 0.015))}
              </div>
            </div>
          </div>

          {/* Control bar */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1, minWidth: 260 }}>
              <div style={{ position: "relative", width: "100%", maxWidth: 300, minWidth: 200 }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search applicant, phone, loan type…"
                  style={{ width: "100%", height: 34, fontSize: 12.5, paddingLeft: 32, paddingRight: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
                />
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", paddingBottom: 2 }}>
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  style={{
                    height: 32,
                    padding: "0 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 7,
                    border: statusFilter === "all" ? "1px solid rgba(139,124,255,0.4)" : "1px solid transparent",
                    background: statusFilter === "all" ? "rgba(139,124,255,0.12)" : "transparent",
                    color: statusFilter === "all" ? "var(--accent-violet)" : "var(--text-secondary)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    cursor: "pointer",
                  }}
                >
                  All
                </button>
                {statuses.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStatusFilter(s.id)}
                    style={{
                      height: 32,
                      padding: "0 10px",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 7,
                      border: statusFilter === s.id ? `1px solid ${s.color}60` : "1px solid transparent",
                      background: statusFilter === s.id ? s.bg_color : "transparent",
                      color: statusFilter === s.id ? s.color : "var(--text-secondary)",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>{s.icon}</span>
                    <span>{s.label}</span>
                  </button>
                ))}

                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowManageStatusModal(true)}
                    className="btn-ghost"
                    style={{
                      height: 32,
                      padding: "0 10px",
                      fontSize: 11.5,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      cursor: "pointer",
                      borderRadius: 7,
                      border: "1px dashed var(--border)",
                      color: "var(--accent-violet)",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                    title="Manage / Add / Delete Custom Statuses"
                  >
                    <Settings2 size={13} />
                    Customize Statuses
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={loadInternalApps}
                className="icon-btn"
                title="Refresh Applications"
                style={{ width: 34, height: 34, cursor: "pointer" }}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* Main Table: Customer Loan Applications */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {loadingInternal ? (
              <div style={{ padding: 24 }}><SkeletonList rows={6} /></div>
            ) : filteredApps.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
                <Landmark size={36} strokeWidth={1.5} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>No customer loan applications found</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  Applications submitted by customers on Right Agent Group forms will appear here.
                </div>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 1040, borderCollapse: "collapse", textAlign: "left", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      <th style={{ padding: "10px 16px" }}>Applicant & Contact</th>
                      <th style={{ padding: "10px 16px" }}>Loan Type & City</th>
                      <th style={{ padding: "10px 16px" }}>Requested Amount</th>
                      <th style={{ padding: "10px 16px" }}>Submitted</th>
                      <th style={{ padding: "10px 16px" }}>Status & Officer Remarks</th>
                      <th style={{ padding: "10px 16px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApps.map((app) => {
                      const st = (app.status || "pending").toLowerCase()
                      const meta = getStatusMeta(st)

                      return (
                        <tr key={app.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                          <td style={{ padding: "12px 16px" }}>
                            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{app.customer_name || "Applicant"}</div>
                            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{app.phone || "—"}</div>
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <div style={{ fontWeight: 600 }}>{app.loan_type || "Loan"}</div>
                            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{app.city || "—"}</div>
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <span style={{ fontWeight: 700, color: "var(--accent-green)", fontSize: 13 }}>
                              {app.loan_amount ? formatCurrency(app.loan_amount) : "—"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: 11.5, color: "var(--text-muted)" }}>
                            <div>{timeAgo(app.submitted_at || app.created_at)}</div>
                            <div style={{ fontSize: 10, opacity: 0.75 }}>{formatDateTime(app.submitted_at || app.created_at)}</div>
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            {canEdit ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 5, maxWidth: 230 }}>
                                <CustomSelect
                                  value={st}
                                  disabled={updatingAppId === app.id}
                                  onChange={(val) => updateInternalAppStatus(app, val)}
                                  compact
                                  title="Update Status (AI voice & WhatsApp bot will answer customer according to this status)"
                                  triggerStyle={{
                                    background: meta.bg_color,
                                    color: meta.color,
                                    borderColor: `${meta.color}45`,
                                    fontWeight: 600,
                                  }}
                                  options={[
                                    ...statuses.map((s) => ({
                                      value: s.id,
                                      label: s.label,
                                      dotColor: s.color,
                                    })),
                                    {
                                      value: "__manage__",
                                      label: "Customize Statuses...",
                                      icon: <Settings2 size={13} />,
                                      accent: true,
                                      dividerBefore: true,
                                    },
                                  ]}
                                />

                                {/* Officer Reason / Remarks snippet */}
                                {app.status_reason && (
                                  <div
                                    onClick={() => openRemarkModal(app)}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 4,
                                      fontSize: 10.5,
                                      color: meta.color,
                                      background: meta.bg_color,
                                      padding: "2px 6px",
                                      borderRadius: 4,
                                      cursor: "pointer",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                    title={`Reason: ${app.status_reason} (Click to edit)`}
                                  >
                                    <span>⚠️</span>
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{app.status_reason}</span>
                                  </div>
                                )}

                                {app.remarks && (
                                  <div
                                    onClick={() => openRemarkModal(app)}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 4,
                                      fontSize: 10,
                                      color: "var(--text-muted)",
                                      cursor: "pointer",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                    title={`Telecaller Note: ${app.remarks} (Click to edit)`}
                                  >
                                    <MessageSquare size={10} />
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{app.remarks}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: meta.bg_color, color: meta.color }}>
                                  <span>{meta.icon}</span>
                                  {meta.label}
                                </span>
                                {app.status_reason && (
                                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{app.status_reason}</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => openRemarkModal(app)}
                                  className="btn-ghost"
                                  style={{ height: 28, fontSize: 11, padding: "0 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                                  title="Add Telecaller Call Note / Reason"
                                >
                                  <MessageSquare size={12} />
                                  Remark / Note
                                </button>
                              )}

                              {Array.isArray(app.status_history) && app.status_history.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setViewHistoryApp(app)}
                                  className="icon-btn"
                                  style={{ width: 28, height: 28, cursor: "pointer" }}
                                  title="View Timeline History"
                                >
                                  <History size={13} />
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  window.dispatchEvent(new CustomEvent("rag:navigate", { detail: { view: "leads", search: app.phone || app.customer_name } }))
                                }}
                                className="btn-ghost"
                                style={{ height: 28, fontSize: 11.5, padding: "0 10px", cursor: "pointer" }}
                                title="View Lead in CRM"
                              >
                                View in CRM
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ======================================================== */}
      {/* TAB 2: LOAN TYPE LINKS & ROUTING (User Customizable) */}
      {/* ======================================================== */}
      {activeTab === "links" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Educational info card */}
          <div style={{ background: "rgba(56,189,248,0.07)", border: "1px solid rgba(56,189,248,0.25)", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "flex-start", gap: 12 }}>
            <Globe size={20} strokeWidth={2} style={{ color: "var(--accent-cyan)", flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--text-primary)" }}>Dynamic Loan Link Routing:</strong> Enter your custom loan application link for any loan type below. When Priya or your agents send an application link via WhatsApp for that loan type, the customer&apos;s link will automatically open the URL configured here. You can change or delete links at any time. If no link is entered for a loan type, the system defaults to Right Agent Group&apos;s internal form (<code style={{ color: "var(--accent-cyan)" }}>/apply</code>).
            </div>
          </div>

          {/* Search bar & Refresh */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 320 }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input
                type="text"
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                placeholder="Search loan type, link URL, provider…"
                style={{ width: "100%", height: 34, fontSize: 12.5, paddingLeft: 32, paddingRight: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={loadLinks}
                className="icon-btn"
                title="Refresh Links"
                style={{ width: 34, height: 34, cursor: "pointer" }}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* Links List */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {loadingLinks ? (
              <div style={{ padding: 24 }}><SkeletonList rows={4} /></div>
            ) : filteredLinks.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
                <Link2 size={36} strokeWidth={1.5} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>No custom loan links configured yet</div>
                <div style={{ fontSize: 12, marginTop: 4, maxWidth: 440, margin: "4px auto 16px" }}>
                  Right now, all loan types route to Right Agent Group&apos;s standard online application form (<code style={{ color: "var(--accent-cyan)" }}>/apply</code>). Click below to add a custom link for any loan type.
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={openAddLinkModal}
                    className="btn-primary"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", fontSize: 12.5 }}
                  >
                    <Plus size={14} strokeWidth={2.2} /> Add Loan Link
                  </button>
                )}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 880, borderCollapse: "collapse", textAlign: "left", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      <th style={{ padding: "10px 16px" }}>Loan Type</th>
                      <th style={{ padding: "10px 16px" }}>Provider / Label</th>
                      <th style={{ padding: "10px 16px" }}>Destination Application Link</th>
                      <th style={{ padding: "10px 16px" }}>Status</th>
                      <th style={{ padding: "10px 16px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLinks.map((link) => (
                      <tr key={link.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: link.active ? "var(--accent-green)" : "var(--text-muted)" }} />
                            <strong style={{ color: "var(--text-primary)", fontSize: 13 }}>{link.product}</strong>
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>
                          {link.bank || "Right Agent Group"}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 420 }}>
                            <span
                              style={{
                                fontFamily: "monospace",
                                fontSize: 12,
                                background: "var(--bg-secondary)",
                                border: "1px solid var(--border)",
                                padding: "3px 8px",
                                borderRadius: 6,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                display: "inline-block",
                                maxWidth: 340,
                                color: "var(--accent-cyan)",
                              }}
                              title={link.url}
                            >
                              {link.url}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(link.url, link.product)}
                              className="icon-btn"
                              title="Copy Application Link"
                              style={{ width: 26, height: 26, flexShrink: 0 }}
                            >
                              <Copy size={13} />
                            </button>
                            <a
                              href={link.url.startsWith("/") ? link.url : link.url}
                              target="_blank"
                              rel="noreferrer"
                              className="icon-btn"
                              title="Test Link in New Tab"
                              style={{ width: 26, height: 26, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                            >
                              <ArrowUpRight size={13} />
                            </a>
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => toggleLinkActive(link)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "3px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: "pointer",
                                border: link.active ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(255,255,255,0.15)",
                                background: link.active ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.05)",
                                color: link.active ? "var(--accent-green)" : "var(--text-muted)",
                              }}
                              title="Click to toggle Active / Inactive"
                            >
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: link.active ? "var(--accent-green)" : "var(--text-muted)" }} />
                              {link.active ? "Active" : "Disabled"}
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, color: link.active ? "var(--accent-green)" : "var(--text-muted)" }}>
                              {link.active ? "Active" : "Disabled"}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          {canEdit && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <button
                                type="button"
                                onClick={() => openEditLinkModal(link)}
                                className="icon-btn"
                                title="Edit / Change Link"
                                style={{ width: 28, height: 28, color: "var(--accent-violet)" }}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteLink(link.id, link.product)}
                                disabled={deletingLinkId === link.id}
                                className="icon-btn"
                                title="Delete Link"
                                style={{ width: 28, height: 28, color: "var(--accent-red)" }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ADD / EDIT LOAN LINK */}
      {/* ======================================================== */}
      {showLinkModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 26, width: "100%", maxWidth: 460 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Link2 size={18} strokeWidth={2.2} style={{ color: "var(--accent-cyan)" }} />
                <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>
                  {editingLink ? "Edit Loan Application Link" : "Add Loan Application Link"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="icon-btn"
                style={{ width: 28, height: 28 }}
              >
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleSaveLink} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 500 }}>
                  Loan Type / Category *
                </label>
                <CustomSelect
                  value={linkFormProduct}
                  onChange={(val) => setLinkFormProduct(val)}
                  triggerStyle={{ height: 38, fontSize: 13 }}
                  options={[
                    ...COMMON_LOAN_TYPES.map((t) => ({ value: t, label: t })),
                    {
                      value: "custom",
                      label: "Other / Custom Loan Type…",
                      icon: <Pencil size={12} />,
                      accent: true,
                      dividerBefore: true,
                    },
                  ]}
                />

                {linkFormProduct === "custom" && (
                  <input
                    type="text"
                    value={customProduct}
                    onChange={(e) => setCustomProduct(e.target.value)}
                    placeholder="Enter custom loan type (e.g. Doctor Loan, Machinery Loan)"
                    style={{ width: "100%", height: 36, fontSize: 12.5, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", marginTop: 8 }}
                    required
                  />
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 500 }}>
                  Application Link URL *
                </label>
                <input
                  type="text"
                  value={linkFormUrl}
                  onChange={(e) => setLinkFormUrl(e.target.value)}
                  placeholder="Paste URL (e.g. https://... or /apply)"
                  style={{ width: "100%", height: 38, fontSize: 13, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
                  required
                />
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, display: "block" }}>
                  Customers requesting this loan type on WhatsApp or voice will be directed to this exact URL.
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 500 }}>
                  Provider / Label (Optional)
                </label>
                <input
                  type="text"
                  value={linkFormBank}
                  onChange={(e) => setLinkFormBank(e.target.value)}
                  placeholder="e.g. Right Agent Group, Google Form, Internal Portal"
                  style={{ width: "100%", height: 36, fontSize: 12.5, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
                <input
                  type="checkbox"
                  id="linkActiveToggle"
                  checked={linkFormActive}
                  onChange={(e) => setLinkFormActive(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "var(--accent-cyan)", cursor: "pointer" }}
                />
                <label htmlFor="linkActiveToggle" style={{ fontSize: 12.5, color: "var(--text-primary)", cursor: "pointer" }}>
                  Active (Priya and tracking redirects will use this link)
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="btn-ghost"
                  style={{ flex: 1, height: 38 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingLink}
                  className="btn-primary"
                  style={{ flex: 1, height: 38 }}
                >
                  {savingLink ? "Saving…" : editingLink ? "Update Link" : "Save Link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: UPDATE STATUS & TELECALLER REMARK */}
      {/* ======================================================== */}
      {activeRemarkApp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 26, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MessageSquare size={18} strokeWidth={2.2} style={{ color: "var(--accent-violet)" }} />
                <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>
                  Update Status & Call Remark
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveRemarkApp(null)}
                className="icon-btn"
                style={{ width: 28, height: 28 }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Applicant Summary */}
            <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 13 }}>
                  {activeRemarkApp.customer_name || "Applicant"}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  {activeRemarkApp.phone || "No phone"} • {activeRemarkApp.loan_type || "Loan"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700, color: "var(--accent-green)", fontSize: 14 }}>
                  {activeRemarkApp.loan_amount ? formatCurrency(activeRemarkApp.loan_amount) : "—"}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                  {activeRemarkApp.city || "—"}
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveRemark} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Status Select */}
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 6, fontWeight: 500 }}>
                  Application Status *
                </label>
                <select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value)}
                  style={{
                    width: "100%",
                    height: 38,
                    fontSize: 13,
                    padding: "0 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontWeight: 600,
                  }}
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.icon} {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Reason / Rejection Reason */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <label style={{ fontSize: 12, color: targetStatus === "rejected" ? "var(--accent-red)" : "var(--text-muted)", fontWeight: 600 }}>
                    {targetStatus === "rejected" ? "Rejection Reason (Customer-Facing) *" : "Status Reason / Condition"}
                  </label>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Priya/AI will explain this to customer</span>
                </div>
                <input
                  type="text"
                  value={statusReasonText}
                  onChange={(e) => setStatusReasonText(e.target.value)}
                  placeholder={
                    targetStatus === "rejected"
                      ? "e.g. CIBIL score is 610 (min required: 700), salary slips missing"
                      : "e.g. 3 months bank statements required, approved at 11.5% ROI"
                  }
                  style={{
                    width: "100%",
                    height: 36,
                    fontSize: 12.5,
                    padding: "0 10px",
                    borderRadius: 8,
                    border: targetStatus === "rejected" ? "1px solid rgba(239,68,68,0.5)" : "1px solid var(--border)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                  }}
                />

                {/* Quick Reason Chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                  {(targetStatus === "rejected" ? QUICK_REJECTION_REASONS : QUICK_PENDING_REASONS).map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setStatusReasonText(reason)}
                      style={{
                        fontSize: 10.5,
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: statusReasonText === reason ? "rgba(139,124,255,0.2)" : "rgba(255,255,255,0.04)",
                        color: statusReasonText === reason ? "var(--accent-violet)" : "var(--text-muted)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      + {reason}
                    </button>
                  ))}
                </div>
              </div>

              {/* Internal Conversation Notes / Telecaller Remark */}
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 500 }}>
                  Telecaller Call Notes / Detailed Remarks
                </label>
                <textarea
                  value={remarkText}
                  onChange={(e) => setRemarkText(e.target.value)}
                  placeholder="What happened on the call? e.g. Spoke to customer, he promised to send ITR by evening. Ready to add co-applicant if needed."
                  rows={3}
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

              {/* Informational AI Badge */}
              <div style={{ background: "rgba(139,124,255,0.08)", border: "1px solid rgba(139,124,255,0.25)", borderRadius: 8, padding: "10px 12px", display: "flex", gap: 8, alignItems: "flex-start" }}>
                <Info size={15} style={{ color: "var(--accent-violet)", flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                  <strong>Voicebot & WhatsApp Integration:</strong> If this customer calls our WhatsApp number or texts asking why their loan was rejected or what is the status, <strong>Priya will automatically explain this exact reason</strong> to them in Telugu, Hindi, or English!
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setActiveRemarkApp(null)}
                  className="btn-ghost"
                  style={{ flex: 1, height: 38 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRemark}
                  className="btn-primary"
                  style={{ flex: 1, height: 38 }}
                >
                  {savingRemark ? "Saving…" : "Save & Update"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: CUSTOM STATUS MANAGEMENT */}
      {/* ======================================================== */}
      {showManageStatusModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 26, width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Settings2 size={18} strokeWidth={2.2} style={{ color: "var(--accent-violet)" }} />
                <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>
                  Customize Application Statuses
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowManageStatusModal(false)}
                className="icon-btn"
                style={{ width: 28, height: 28 }}
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              Create or remove custom loan stages suited for your DSA process (e.g., <em>Bank Login Done, Field Verification, Documents Pending</em>).
            </div>

            {/* Existing Statuses List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>
                Current Statuses ({statuses.length})
              </div>
              {statuses.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "var(--bg-secondary)",
                    border: `1px solid ${s.color}30`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 16 }}>{s.icon}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12.5, color: s.color }}>{s.label}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        Category: {s.category} {s.is_default && "• (System Default)"}
                      </div>
                    </div>
                  </div>

                  {!s.is_default ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomStatus(s.id, s.label)}
                      className="icon-btn"
                      style={{ color: "var(--accent-red)", width: 28, height: 28 }}
                      title="Delete this custom status"
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : (
                    <span style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>Locked</span>
                  )}
                </div>
              ))}
            </div>

            {/* Add New Status Form */}
            <form onSubmit={handleCreateCustomStatus} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <Plus size={14} style={{ color: "var(--accent-green)" }} /> Add New Custom Status
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>
                    Status Name *
                  </label>
                  <input
                    type="text"
                    value={newStatusLabel}
                    onChange={(e) => setNewStatusLabel(e.target.value)}
                    placeholder="e.g. Bank Login Done, Field Verification, Co-Applicant Needed"
                    style={{ width: "100%", height: 36, fontSize: 12.5, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                    required
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>
                      Icon / Emoji
                    </label>
                    <select
                      value={newStatusIcon}
                      onChange={(e) => setNewStatusIcon(e.target.value)}
                      style={{ width: "100%", height: 36, fontSize: 13, padding: "0 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                    >
                      {["📌", "📄", "🏦", "🔍", "⚠️", "📞", "⭐", "🤝", "⏳", "✅", "❌", "💰"].map((emoji) => (
                        <option key={emoji} value={emoji}>{emoji} Icon</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>
                      Category
                    </label>
                    <select
                      value={newStatusCategory}
                      onChange={(e) => setNewStatusCategory(e.target.value as any)}
                      style={{ width: "100%", height: 36, fontSize: 12.5, padding: "0 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
                    >
                      <option value="pending">In Progress / Pending</option>
                      <option value="sanctioned">Approved / Sanctioned</option>
                      <option value="rejected">Rejected / Not Sanctioned</option>
                      <option value="disbursed">Disbursed</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginBottom: 6 }}>
                    Color Theme
                  </label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {STATUS_COLOR_PRESETS.map((p) => (
                      <button
                        key={p.color}
                        type="button"
                        onClick={() => setNewStatusColor(p.color)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: newStatusColor === p.color ? `2px solid ${p.color}` : "1px solid var(--border)",
                          background: newStatusColor === p.color ? p.bg : "transparent",
                          color: p.color,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingCustomStatus || !newStatusLabel.trim()}
                  className="btn-primary"
                  style={{ height: 36, fontSize: 12.5, marginTop: 4 }}
                >
                  {savingCustomStatus ? "Adding…" : "Add Custom Status"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: STATUS & REMARKS HISTORY TIMELINE */}
      {/* ======================================================== */}
      {viewHistoryApp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 26, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <History size={18} strokeWidth={2.2} style={{ color: "var(--accent-cyan)" }} />
                <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>
                  Application Update History
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewHistoryApp(null)}
                className="icon-btn"
                style={{ width: 28, height: 28 }}
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{viewHistoryApp.customer_name}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{viewHistoryApp.phone} • {viewHistoryApp.loan_type}</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative", paddingLeft: 12 }}>
              <div style={{ position: "absolute", left: 16, top: 8, bottom: 8, width: 2, background: "var(--border)" }} />

              {Array.isArray(viewHistoryApp.status_history) && viewHistoryApp.status_history.length > 0 ? (
                viewHistoryApp.status_history.slice().reverse().map((entry: any, idx: number) => {
                  const meta = getStatusMeta(entry.status)
                  return (
                    <div key={idx} style={{ position: "relative", paddingLeft: 20 }}>
                      <div style={{ position: "absolute", left: -1, top: 4, width: 10, height: 10, borderRadius: "50%", background: meta.color }} />
                      <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <span>{meta.icon}</span> {meta.label}
                          </span>
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            {entry.updated_at ? formatDateTime(entry.updated_at) : "Recent"}
                          </span>
                        </div>

                        {entry.status_reason && (
                          <div style={{ fontSize: 11, color: meta.color, marginBottom: 2 }}>
                            <strong>Reason:</strong> {entry.status_reason}
                          </div>
                        )}

                        {entry.remarks && (
                          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                            <strong>Note:</strong> {entry.remarks}
                          </div>
                        )}

                        <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 4, opacity: 0.7 }}>
                          Logged by: {entry.updated_by || "Staff"}
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 12, textAlign: "center" }}>
                  No historical entries recorded yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}


    </div>
  )
}
