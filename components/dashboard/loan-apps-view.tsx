"use client"

import React, { useEffect, useState, useCallback, useMemo } from "react"
import {
  ExternalLink, CheckCircle2, Clock, Eye, AlertCircle, RefreshCw,
  Search, Landmark, DollarSign, Check, X, Filter, Plus, Pencil, Trash2,
  Copy, Link2, FileText, Globe, Layers, ArrowUpRight
} from "lucide-react"
import { formatCurrency, timeAgo, formatDateTime } from "@/lib/utils"
import { usePolling } from "@/lib/use-poll"
import { SkeletonList } from "../ui/skeleton"
import { useToast } from "../ui/toast"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

interface LoanLink {
  id: string
  bank: string
  product: string
  url: string
  active: boolean
  created_at: string
}

const COMMON_LOAN_TYPES = [
  "Home Loan",
  "Personal Loan",
  "Business Loan",
  "Loan Against Property",
  "Education Loan",
  "Car Loan",
  "Mortgage Loan",
  "Gold Loan",
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
  }, [loadInternalApps, loadLinks])

  usePolling(loadInternalApps, 15000)

  // Update internal customer application status (Team Members Only)
  async function updateInternalAppStatus(id: string, newStatus: string) {
    setUpdatingAppId(id)
    try {
      const res = await fetch("/api/loans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          status: newStatus,
        }),
      })
      if (res.ok) {
        toast.success(`Application marked as ${newStatus.toUpperCase()}`)
        setInternalApps((prev) =>
          prev.map((app) => (app.id === id ? { ...app, status: newStatus } : app))
        )
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
      if (statusFilter === "pending" && !/pending|review|new/i.test(app.status || "")) return false
      if (statusFilter === "sanctioned" && !/sanctioned|approved/i.test(app.status || "")) return false
      if (statusFilter === "disbursed" && !/disbursed/i.test(app.status || "")) return false
      if (statusFilter === "rejected" && !/rejected|lost/i.test(app.status || "")) return false

      // Search filter
      if (!search.trim()) return true
      const s = search.toLowerCase()
      return (
        (app.customer_name || "").toLowerCase().includes(s) ||
        (app.phone || "").toLowerCase().includes(s) ||
        (app.loan_type || "").toLowerCase().includes(s) ||
        (app.city || "").toLowerCase().includes(s)
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setActiveTab("apps")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              border: activeTab === "apps" ? "1px solid var(--accent-violet)" : "1px solid var(--border)",
              background: activeTab === "apps" ? "rgba(139,124,255,0.12)" : "var(--bg-secondary)",
              color: activeTab === "apps" ? "var(--accent-violet)" : "var(--text-secondary)",
            }}
          >
            <FileText size={15} strokeWidth={2} />
            Customer Applications
            <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 10, background: activeTab === "apps" ? "var(--accent-violet)" : "rgba(255,255,255,0.1)", color: "#fff" }}>
              {internalApps.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("links")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              border: activeTab === "links" ? "1px solid var(--accent-cyan)" : "1px solid var(--border)",
              background: activeTab === "links" ? "rgba(56,189,248,0.12)" : "var(--bg-secondary)",
              color: activeTab === "links" ? "var(--accent-cyan)" : "var(--text-secondary)",
            }}
          >
            <Link2 size={15} strokeWidth={2} />
            Loan Type Links & Routing
            <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 10, background: activeTab === "links" ? "var(--accent-cyan)" : "rgba(255,255,255,0.1)", color: "#000", fontWeight: 700 }}>
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

              <div style={{ display: "flex", gap: 4, overflowX: "auto", flexWrap: "nowrap", alignItems: "center", paddingBottom: 2 }}>
                {[
                  { id: "all", label: "All" },
                  { id: "pending", label: "Under Review" },
                  { id: "sanctioned", label: "Sanctioned" },
                  { id: "disbursed", label: "Disbursed" },
                  { id: "rejected", label: "Rejected" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    style={{
                      height: 32,
                      padding: "0 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 7,
                      border: statusFilter === tab.id ? "1px solid rgba(139,124,255,0.4)" : "1px solid transparent",
                      background: statusFilter === tab.id ? "rgba(139,124,255,0.12)" : "transparent",
                      color: statusFilter === tab.id ? "var(--accent-violet)" : "var(--text-secondary)",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      cursor: "pointer",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
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
                      <th style={{ padding: "10px 16px" }}>Status</th>
                      <th style={{ padding: "10px 16px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApps.map((app) => {
                      const st = (app.status || "pending").toLowerCase()
                      const isSanctioned = st === "sanctioned" || st === "approved"
                      const isRejected = st === "rejected" || st === "lost"
                      const isDisbursed = st === "disbursed"
                      const statusColor = isSanctioned
                        ? "var(--accent-cyan)"
                        : isDisbursed
                        ? "var(--accent-green)"
                        : isRejected
                        ? "var(--accent-red)"
                        : "var(--accent-yellow)"
                      const statusBg = isSanctioned
                        ? "rgba(56,189,248,0.15)"
                        : isDisbursed
                        ? "rgba(34,197,94,0.15)"
                        : isRejected
                        ? "rgba(239,68,68,0.12)"
                        : "rgba(234,179,8,0.12)"

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
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                <select
                                  value={st === "approved" ? "sanctioned" : st}
                                  disabled={updatingAppId === app.id}
                                  onChange={(e) => updateInternalAppStatus(app.id, e.target.value)}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: 6,
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    background: statusBg,
                                    color: statusColor,
                                    border: `1px solid ${statusColor}40`,
                                    cursor: "pointer",
                                    outline: "none",
                                  }}
                                  title="Update Sanction Status (Team Members Only)"
                                >
                                  <option value="pending" style={{ background: "var(--bg-card)", color: "var(--text-primary)" }}>
                                    ⏳ Under Review / Pending
                                  </option>
                                  <option value="sanctioned" style={{ background: "var(--bg-card)", color: "var(--text-primary)" }}>
                                    ✅ Sanctioned
                                  </option>
                                  <option value="rejected" style={{ background: "var(--bg-card)", color: "var(--text-primary)" }}>
                                    ❌ Not Sanctioned / Rejected
                                  </option>
                                  <option value="disbursed" style={{ background: "var(--bg-card)", color: "var(--text-primary)" }}>
                                    💰 Disbursed
                                  </option>
                                </select>
                                <span style={{ fontSize: 9, color: "var(--text-muted)", opacity: 0.75, letterSpacing: "0.02em" }}>
                                  Staff Action Only
                                </span>
                              </div>
                            ) : (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: statusBg, color: statusColor }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
                                {st}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
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
                <select
                  value={linkFormProduct}
                  onChange={(e) => setLinkFormProduct(e.target.value)}
                  style={{ width: "100%", height: 38, fontSize: 13, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
                >
                  {COMMON_LOAN_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  <option value="custom">✏️ Other / Custom Loan Type…</option>
                </select>

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
                  placeholder="e.g. Right Agent Group, SBI Portal, Internal Form"
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

    </div>
  )
}
