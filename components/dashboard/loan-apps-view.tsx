"use client"

import React, { useEffect, useState, useCallback, useMemo } from "react"
import {
  ExternalLink, CheckCircle2, Clock, Eye, AlertCircle, RefreshCw,
  Plus, Search, Landmark, ArrowRight, DollarSign, Copy, Check,
  Sparkles, Trash2, X, Filter, ChevronRight
} from "lucide-react"
import { formatCurrency, timeAgo, formatDateTime } from "@/lib/utils"
import { usePolling } from "@/lib/use-poll"
import { SkeletonList } from "../ui/skeleton"
import { useToast } from "../ui/toast"
import { useEscapeDismiss } from "../ui/interactive"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

type LinkSend = {
  id: string
  token: string
  lead_id: string | null
  lead_name: string | null
  lead_phone: string | null
  lead_city: string | null
  lead_loan_amount: number | null
  bank: string
  product: string
  channel: string
  sent_by: string | null
  sent_at: string
  clicked_at: string | null
  applied_at: string | null
  sanctioned_at: string | null
  disbursed_at: string | null
  loan_amount: number | null
  notes: string | null
  status: "sent" | "opened" | "applied" | "sanctioned" | "disbursed" | "lost"
  target_bank_url?: string | null
}

type BankLink = {
  id: string
  bank: string
  product: string
  url: string
  active: boolean
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  sent: { label: "Link Sent", color: "var(--accent-blue)", bg: "rgba(59,130,246,0.12)" },
  opened: { label: "Opened / Clicked", color: "var(--accent-yellow)", bg: "rgba(234,179,8,0.12)" },
  applied: { label: "Applied at Bank", color: "var(--accent-violet)", bg: "rgba(139,124,255,0.15)" },
  sanctioned: { label: "Sanctioned", color: "var(--accent-cyan)", bg: "rgba(56,189,248,0.15)" },
  disbursed: { label: "Disbursed", color: "var(--accent-green)", bg: "rgba(34,197,94,0.15)" },
  lost: { label: "Dropped / Rejected", color: "var(--accent-red)", bg: "rgba(239,68,68,0.12)" },
}

export default function LoanAppsView({ role, initialSearch }: { role: Role; initialSearch?: string }) {
  const canEdit = role !== "viewer"
  const toast = useToast()

  const [links, setLinks] = useState<LinkSend[]>([])
  const [stats, setStats] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(initialSearch || "")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [actingId, setActingId] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  // Bank library modal
  const [showLibrary, setShowLibrary] = useState(false)
  useEscapeDismiss(showLibrary, () => setShowLibrary(false))
  const [library, setLibrary] = useState<BankLink[]>([])
  const [newBank, setNewBank] = useState({ bank: "", product: "Home Loan", url: "" })
  const [savingBank, setSavingBank] = useState(false)

  // Disbursed modal
  const [disburseTarget, setDisburseTarget] = useState<LinkSend | null>(null)
  const [disburseAmount, setDisburseAmount] = useState<string>("")

  const loadData = useCallback(async () => {
    try {
      const q = new URLSearchParams()
      if (statusFilter !== "all") q.set("status", statusFilter)
      if (search.trim()) q.set("search", search.trim())

      const res = await fetch(`/api/links/sends?${q.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setLinks(data.links || [])
        setStats(data.stats || {})
      }
    } catch {
      // keep previous state
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search])

  const loadLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/links/library")
      if (res.ok) setLibrary(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (showLibrary) loadLibrary()
  }, [showLibrary, loadLibrary])

  usePolling(loadData, 15000)

  // Update link status
  async function updateStatus(id: string, newStatus: string, loanAmount?: number) {
    setActingId(id)
    try {
      const res = await fetch("/api/links/sends", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          status: newStatus,
          loan_amount: loanAmount !== undefined ? loanAmount : undefined,
        }),
      })
      if (res.ok) {
        toast.success(`Status updated to ${STATUS_CONFIG[newStatus]?.label || newStatus}`)
        loadData()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Could not update the loan status")
      }
    } catch {
      toast.error("Failed to update status")
    } finally {
      setActingId(null)
    }
  }

  async function handleAddBank() {
    if (!newBank.bank.trim() || !newBank.url.trim()) return
    setSavingBank(true)
    try {
      const res = await fetch("/api/links/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newBank),
      })
      if (res.ok) {
        toast.success(`Added ${newBank.bank} ${newBank.product} link`)
        setNewBank({ bank: "", product: "Home Loan", url: "" })
        loadLibrary()
      } else {
        toast.error("Failed to add bank link")
      }
    } catch {
      toast.error("Failed to add bank link")
    } finally {
      setSavingBank(false)
    }
  }

  async function handleDeleteBank(id: string) {
    try {
      const res = await fetch(`/api/links/library?id=${id}`, { method: "DELETE" })
      if (res.ok) {
        toast.success("Bank link removed")
        loadLibrary()
      }
    } catch {
      toast.error("Could not remove bank link")
    }
  }

  function copyLink(token: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    const url = `${origin}/l/${token}`
    navigator.clipboard.writeText(url)
    setCopiedToken(token)
    toast.success("Short link copied to clipboard")
    setTimeout(() => setCopiedToken(null), 2000)
  }

  // Calculate commission estimate (~0.6% average DSA payout)
  const totalDisbursed = Number(stats.disbursed_volume || 0)
  const estCommission = totalDisbursed * 0.006

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Top Banner & Financial Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4 }}>Links Sent</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>{stats.total || 0}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Across all products</div>
        </div>

        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4 }}>Opened by Leads</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent-yellow)" }}>
            {stats.opened || 0}
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)", marginLeft: 6 }}>
              ({stats.total > 0 ? Math.round(((stats.opened || 0) / stats.total) * 100) : 0}%)
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Clicked redirect link</div>
        </div>

        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4 }}>Applied & In Progress</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent-violet)" }}>
            {(stats.applied || 0) - (stats.disbursed || 0)}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            {stats.sanctioned || 0} already sanctioned
          </div>
        </div>

        <div className="card" style={{ padding: "16px 20px", background: "linear-gradient(145deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02))", borderColor: "rgba(34,197,94,0.25)" }}>
          <div style={{ fontSize: 12, color: "var(--accent-green)", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <DollarSign size={13} strokeWidth={2.2} /> Total Disbursed
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
            {totalDisbursed > 0 ? formatCurrency(totalDisbursed) : "₹0"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--accent-green)", marginTop: 4, fontWeight: 500 }}>
            Est. Commission: ~{formatCurrency(estCommission)}
          </div>
        </div>
      </div>

      {/* Control bar */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 260 }}>
          <div style={{ position: "relative", width: "100%", maxWidth: 360 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search lead, phone, bank, or product…"
              style={{ width: "100%", height: 34, fontSize: 12.5, paddingLeft: 32, paddingRight: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
            />
          </div>

          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {[
              { id: "all", label: "All" },
              { id: "sent", label: "Sent" },
              { id: "opened", label: "Opened" },
              { id: "applied", label: "Applied" },
              { id: "sanctioned", label: "Sanctioned" },
              { id: "disbursed", label: "Disbursed" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                style={{
                  height: 32,
                  padding: "0 11px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 7,
                  border: statusFilter === tab.id ? "1px solid rgba(139,124,255,0.4)" : "1px solid transparent",
                  background: statusFilter === tab.id ? "rgba(139,124,255,0.12)" : "transparent",
                  color: statusFilter === tab.id ? "var(--accent-violet)" : "var(--text-secondary)",
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
            onClick={() => setShowLibrary(true)}
            className="btn-ghost"
            style={{ height: 34, fontSize: 12, padding: "0 12px", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Landmark size={14} /> Bank Library
          </button>

          <button
            type="button"
            onClick={loadData}
            className="icon-btn"
            title="Refresh"
            style={{ width: 34, height: 34 }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Main Link Sends Table */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 24 }}><SkeletonList rows={6} /></div>
        ) : links.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
            <Landmark size={36} strokeWidth={1.5} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>No bank application links sent yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Open any lead in the Leads tab and click &quot;Send Bank Link&quot; to send official bank application links.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 840, borderCollapse: "collapse", textAlign: "left", fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <th style={{ padding: "10px 16px" }}>Lead & Contact</th>
                  <th style={{ padding: "10px 16px" }}>Bank & Product</th>
                  <th style={{ padding: "10px 16px" }}>Tracking Link</th>
                  <th style={{ padding: "10px 16px" }}>Timeline</th>
                  <th style={{ padding: "10px 16px" }}>Status</th>
                  <th style={{ padding: "10px 16px", textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {links.map((item) => {
                  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.sent
                  const isActing = actingId === item.id

                  return (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                      {/* Lead */}
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{item.lead_name || "Unknown Lead"}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                          {item.lead_phone || "—"} {item.lead_city ? `· ${item.lead_city}` : ""}
                        </div>
                      </td>

                      {/* Bank & Product */}
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ padding: "2px 7px", borderRadius: 5, background: "var(--overlay-soft)", color: "var(--text-primary)", fontSize: 11.5 }}>
                            {item.bank}
                          </span>
                          <span>{item.product}</span>
                        </div>
                        {item.target_bank_url && (
                          <a
                            href={item.target_bank_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--accent-blue)", marginTop: 3, textDecoration: "none" }}
                          >
                            Bank portal <ExternalLink size={10} />
                          </a>
                        )}
                      </td>

                      {/* Tracking link */}
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <code style={{ fontSize: 11.5, padding: "2px 6px", background: "var(--bg-secondary)", borderRadius: 4, border: "1px solid var(--border)" }}>
                            /l/{item.token}
                          </code>
                          <button
                            type="button"
                            onClick={() => copyLink(item.token)}
                            className="icon-btn"
                            title="Copy link"
                            style={{ width: 24, height: 24 }}
                          >
                            {copiedToken === item.token ? <Check size={12} color="var(--accent-green)" /> : <Copy size={12} />}
                          </button>
                        </div>
                      </td>

                      {/* Timeline */}
                      <td style={{ padding: "12px 16px", fontSize: 11.5 }}>
                        <div style={{ color: "var(--text-secondary)" }}>
                          Sent {timeAgo(item.sent_at)} {item.sent_by ? `by ${item.sent_by.split("@")[0]}` : ""}
                        </div>
                        {item.clicked_at ? (
                          <div style={{ color: "var(--accent-yellow)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                            <Eye size={11} /> Clicked {timeAgo(item.clicked_at)}
                          </div>
                        ) : (
                          <div style={{ color: "var(--text-muted)", marginTop: 2 }}>Not clicked yet</div>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "3px 9px",
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 600,
                            background: cfg.bg,
                            color: cfg.color,
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.color }} />
                          {cfg.label}
                        </span>
                        {item.loan_amount && (
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent-green)", marginTop: 4 }}>
                            {formatCurrency(item.loan_amount)}
                          </div>
                        )}
                      </td>

                      {/* Quick Status Action Stepper */}
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        {canEdit && (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {item.status === "sent" && (
                              <button
                                type="button"
                                disabled={isActing}
                                onClick={() => updateStatus(item.id, "applied")}
                                className="btn-ghost"
                                style={{ height: 28, fontSize: 11.5, padding: "0 8px" }}
                                title="Mark as submitted to bank"
                              >
                                Mark Applied
                              </button>
                            )}

                            {item.status === "opened" && (
                              <button
                                type="button"
                                disabled={isActing}
                                onClick={() => updateStatus(item.id, "applied")}
                                className="btn-ghost"
                                style={{ height: 28, fontSize: 11.5, padding: "0 8px", color: "var(--accent-violet)" }}
                                title="Customer submitted form to bank"
                              >
                                Mark Applied
                              </button>
                            )}

                            {item.status === "applied" && (
                              <button
                                type="button"
                                disabled={isActing}
                                onClick={() => updateStatus(item.id, "sanctioned")}
                                className="btn-ghost"
                                style={{ height: 28, fontSize: 11.5, padding: "0 8px", color: "var(--accent-cyan)" }}
                                title="Bank sanctioned the loan"
                              >
                                Sanctioned
                              </button>
                            )}

                            {item.status === "sanctioned" && (
                              <button
                                type="button"
                                disabled={isActing}
                                onClick={() => {
                                  setDisburseTarget(item)
                                  setDisburseAmount(item.lead_loan_amount ? String(item.lead_loan_amount) : "")
                                }}
                                className="btn-primary"
                                style={{ height: 28, fontSize: 11.5, padding: "0 10px" }}
                                title="Bank disbursed loan amount"
                              >
                                Disburse
                              </button>
                            )}

                            {item.status === "disbursed" && (
                              <span style={{ fontSize: 11.5, color: "var(--accent-green)", fontWeight: 600 }}>
                                Completed ✓
                              </span>
                            )}

                            {item.status !== "disbursed" && item.status !== "lost" && (
                              <button
                                type="button"
                                disabled={isActing}
                                onClick={() => updateStatus(item.id, "lost")}
                                className="icon-btn"
                                title="Mark lost / dropped"
                                style={{ width: 28, height: 28, color: "var(--text-muted)" }}
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Disbursed Amount Entry Modal */}
      {disburseTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: "var(--text-primary)" }}>Mark Loan Disbursed</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              Enter the final disbursed loan amount for {disburseTarget.lead_name || "this customer"} ({disburseTarget.bank}).
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                Disbursed Amount (₹)
              </label>
              <input
                type="number"
                value={disburseAmount}
                onChange={(e) => setDisburseAmount(e.target.value)}
                placeholder="2500000"
                style={{ width: "100%", height: 38, fontSize: 14, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
              />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setDisburseTarget(null)}
                className="btn-ghost"
                style={{ flex: 1, height: 38 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const amt = disburseAmount ? parseFloat(disburseAmount) : undefined
                  updateStatus(disburseTarget.id, "disbursed", amt)
                  setDisburseTarget(null)
                }}
                className="btn-primary"
                style={{ flex: 1, height: 38 }}
              >
                Confirm Disbursed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bank Library Modal */}
      {showLibrary && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 640, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Landmark size={18} strokeWidth={2} style={{ color: "var(--accent-violet)" }} />
                <div style={{ fontWeight: 700, fontSize: 16 }}>Bank Link Library</div>
              </div>
              <button
                type="button"
                onClick={() => setShowLibrary(false)}
                className="icon-btn"
                style={{ width: 28, height: 28 }}
              >
                <X size={15} />
              </button>
            </div>

            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              Official loan application URLs. When you or Priya send a link to a lead, it creates a short redirect that logs click analytics before sending the customer straight to the bank portal.
            </p>

            {/* Add Bank Form */}
            {canEdit && (
              <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 14, marginBottom: 18, border: "1px solid var(--border-light)" }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Add Lender Application Link</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <input
                    value={newBank.bank}
                    onChange={(e) => setNewBank({ ...newBank, bank: e.target.value })}
                    placeholder="Bank / NBFC Name (e.g. SBI)"
                    style={{ height: 34, fontSize: 12.5, padding: "0 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
                  />
                  <select
                    value={newBank.product}
                    onChange={(e) => setNewBank({ ...newBank, product: e.target.value })}
                    style={{ height: 34, fontSize: 12.5, padding: "0 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
                  >
                    <option value="Home Loan">Home Loan</option>
                    <option value="Personal Loan">Personal Loan</option>
                    <option value="Business Loan">Business Loan</option>
                    <option value="Loan Against Property">Loan Against Property</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    value={newBank.url}
                    onChange={(e) => setNewBank({ ...newBank, url: e.target.value })}
                    placeholder="Official URL (e.g. https://homeloans.sbi/)"
                    style={{ flex: 1, height: 34, fontSize: 12.5, padding: "0 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
                  />
                  <button
                    type="button"
                    onClick={handleAddBank}
                    disabled={!newBank.bank.trim() || !newBank.url.trim() || savingBank}
                    className="btn-primary"
                    style={{ height: 34, padding: "0 14px", fontSize: 12 }}
                  >
                    {savingBank ? "Saving…" : "Add"}
                  </button>
                </div>
              </div>
            )}

            {/* List */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {library.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-secondary)",
                    fontSize: 12.5,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      {b.bank} <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>· {b.product}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--accent-blue)", marginTop: 2, wordBreak: "break-all" }}>
                      {b.url}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
                    <a
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="icon-btn"
                      title="Test URL"
                      style={{ width: 28, height: 28 }}
                    >
                      <ExternalLink size={13} />
                    </a>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleDeleteBank(b.id)}
                        className="icon-btn"
                        title="Delete"
                        style={{ width: 28, height: 28, color: "var(--text-muted)" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
