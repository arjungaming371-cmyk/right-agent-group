"use client"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
import { useEffect, useState } from "react"
import { BadgeCheck, Download, PenLine, Check, X, History, Plus, Settings2, FileText, User, Phone, MapPin } from "lucide-react"
import { formatCurrency, timeAgo, formatDateTime } from "@/lib/utils"
import { usePolling } from "@/lib/use-poll"
import { SkeletonList } from "../ui/skeleton"
import { useToast } from "../ui/toast"
import { calculateEMI, totalInterest, formatINR, BEST_RATES, detectLoanType } from "@/lib/finance"
import LoanFormCustomizerModal from "./loan-form-customizer-modal"
import VoiceDictation from "../ui/voice-dictation"

function EmiEstimate({ loanAmount, loanType }: { loanAmount: number; loanType: string }) {
  const canonical = detectLoanType(loanType) || "Home Loan"
  const rate = BEST_RATES[canonical] || BEST_RATES["Home Loan"]
  const tenureMonths = rate.maxTenureYears * 12
  const emi = calculateEMI(loanAmount, rate.ratePct, tenureMonths)
  const interest = totalInterest(loanAmount, emi, tenureMonths)
  return (
    <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 14, display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--accent-green)" }}>{formatINR(emi)}<span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}> /month</span></div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>at {rate.ratePct}% p.a. ({rate.lender}) over {rate.maxTenureYears} years</div>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{formatINR(interest)}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>total interest over the loan</div>
      </div>
    </div>
  )
}

type LoanApp = {
  id: string; customer_name: string; city: string; loan_type: string
  loan_amount: number; loan_tenure?: number; status: string; email: string; address: string; whatsapp_number: string
  employment_type: string; monthly_income: number; pan_number?: string; form_data: any; submitted_at: string; created_at: string
  last_edited_at?: string | null
}

type EditRequest = {
  id: string; loan_application_id: string; lead_name: string | null; customer_name: string | null
  proposed_by: string; reason: string | null
  previous_values: { field: string; value: any }; proposed_values: { field: string; value: any }
  created_at: string; status: string; reviewed_by?: string | null; reviewed_at?: string | null
}

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  pending:      { bg: "rgba(234,179,8,0.15)",   color: "var(--accent-yellow)", label: "Pending Review" },
  under_review: { bg: "rgba(59,130,246,0.15)",  color: "var(--accent-blue)",   label: "Under Review" },
  approved:     { bg: "rgba(34,197,94,0.15)",   color: "var(--accent-green)",  label: "Approved" },
  rejected:     { bg: "rgba(239,68,68,0.15)",   color: "var(--accent-red)",    label: "Rejected" },
}

function fieldLabel(field: string): string {
  const map: Record<string, string> = {
    customer_name: "Customer Name",
    loan_amount: "Loan Amount",
    loan_type: "Loan Type",
    loan_tenure: "Loan Tenure",
    city: "City",
    address: "Address",
    email: "Email",
    whatsapp_number: "WhatsApp",
    employment_type: "Employment",
    monthly_income: "Monthly Income",
    pan_number: "PAN Number",
  }
  return map[field] || field.replace(/_/g, " ")
}

export default function LoanAppsView({ role, initialSearch }: { role: Role; initialSearch?: string }) {
  const canEdit = role !== "viewer"
  const toast = useToast()
  const [apps, setApps] = useState<LoanApp[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState(initialSearch || "")
  const [pendingEdits, setPendingEdits] = useState<EditRequest[]>([])
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [history, setHistory] = useState<EditRequest[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [showCustomizer, setShowCustomizer] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newApp, setNewApp] = useState({
    customer_name: "",
    whatsapp_number: "",
    loan_type: "Home Loan",
    loan_amount: "",
    loan_tenure: "120",
    employment_type: "Salaried",
    monthly_income: "",
    city: "",
    pan_number: "",
    address: "",
    status: "pending",
  })

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const res = await fetch("/api/loans")
      if (res.ok) {
        const data = await res.json()
        setApps(data)
        if (data.length > 0 && !selectedId) setSelectedId(data[0].id)
      } else {
        setLoadError(`Could not load applications (HTTP ${res.status}). Check server logs.`)
      }
    } catch {
      setLoadError("Could not load applications — network error.")
    }
    setLoading(false)
  }

  async function loadPendingEdits() {
    if (!canEdit) return
    try {
      const res = await fetch("/api/loans/edit-requests?status=pending")
      if (res.ok) setPendingEdits(await res.json())
    } catch {}
  }

  useEffect(() => {
    load()
    loadPendingEdits()
  }, [])

  usePolling(() => { load(true); loadPendingEdits() }, 15000)

  const filtered = apps.filter((a) => !search || a.customer_name?.toLowerCase().includes(search.toLowerCase()) || a.whatsapp_number?.includes(search))
  const selected = apps.find((a) => a.id === selectedId) || null

  async function markStatus(id: string, status: string) {
    await fetch("/api/loans", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) })
    load(true)
  }

  async function reviewEditRequest(id: string, action: "approve" | "reject") {
    setReviewing(id)
    try {
      const res = await fetch(`/api/loans/edit-requests/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed")
      toast.success(action === "approve" ? "Change applied" : "Request rejected")
      setPendingEdits((prev) => prev.filter((e) => e.id !== id))
      if (action === "approve") load(true)
    } catch (e: any) {
      toast.error(e.message || "Couldn't review this request")
    }
    setReviewing(null)
  }

  async function openHistory(applicationId: string) {
    setHistoryFor(applicationId)
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/loans/edit-requests?status=all&applicationId=${applicationId}`)
      if (res.ok) setHistory(await res.json())
    } catch {}
    setHistoryLoading(false)
  }

  async function handleAddLoan(e: React.FormEvent) {
    e.preventDefault()
    if (!newApp.customer_name.trim() || !newApp.whatsapp_number.trim()) {
      toast.error("Customer name and phone number required")
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: newApp.customer_name.trim(),
          whatsapp_number: newApp.whatsapp_number.trim(),
          loan_type: newApp.loan_type,
          loan_amount: newApp.loan_amount ? Number(newApp.loan_amount) : 0,
          loan_tenure: newApp.loan_tenure ? Number(newApp.loan_tenure) : 12,
          employment_type: newApp.employment_type,
          monthly_income: newApp.monthly_income ? Number(newApp.monthly_income) : null,
          city: newApp.city.trim() || null,
          address: newApp.address.trim() || null,
          pan_number: newApp.pan_number.trim().toUpperCase() || null,
          status: newApp.status,
          submitted_at: new Date().toISOString(),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || "Failed to create application")
      }
      const created = await res.json()
      toast.success("New loan application added successfully!")
      setShowAddModal(false)
      setNewApp({
        customer_name: "",
        whatsapp_number: "",
        loan_type: "Home Loan",
        loan_amount: "",
        loan_tenure: "120",
        employment_type: "Salaried",
        monthly_income: "",
        city: "",
        pan_number: "",
        address: "",
        status: "pending",
      })
      await load()
      if (created?.id) setSelectedId(created.id)
    } catch (err: any) {
      toast.error(err.message || "Failed to add application")
    } finally {
      setAdding(false)
    }
  }

  let formExtras: Record<string, any> = {}
  if (selected?.form_data) {
    try { formExtras = typeof selected.form_data === "string" ? JSON.parse(selected.form_data) : selected.form_data } catch {}
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {canEdit && pendingEdits.length > 0 && (
        <div style={{ background: "rgba(247,183,49,0.06)", border: "1px solid rgba(247,183,49,0.25)", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontWeight: 700, fontSize: 14, color: "var(--accent-yellow)" }}>
            <PenLine size={16} strokeWidth={2.2} /> Priya flagged {pendingEdits.length} application correction{pendingEdits.length > 1 ? "s" : ""} — needs your review
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pendingEdits.map((e) => (
              <div key={e.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{e.customer_name || e.lead_name || "Unknown"}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {fieldLabel(e.previous_values.field)}:
                    <span style={{ color: "var(--accent-red)", textDecoration: "line-through" }}>{String(e.previous_values.value ?? "—")}</span>
                    →
                    <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>{String(e.proposed_values.value)}</span>
                  </div>
                  {e.reason && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, fontStyle: "italic" }}>"{e.reason}"</div>}
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                    Flagged by Priya on {e.proposed_by === "priya_voice" ? "a call" : "WhatsApp"} · {timeAgo(e.created_at)} · {formatDateTime(e.created_at)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => reviewEditRequest(e.id, "approve")}
                    disabled={reviewing === e.id}
                    style={{ background: "rgba(45,212,160,0.12)", border: "1px solid rgba(45,212,160,0.3)", color: "var(--accent-green)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5, opacity: reviewing === e.id ? 0.5 : 1 }}
                  ><Check size={13} strokeWidth={2.2} /> Approve</button>
                  <button
                    onClick={() => reviewEditRequest(e.id, "reject")}
                    disabled={reviewing === e.id}
                    style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.28)", color: "var(--accent-red)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5, opacity: reviewing === e.id ? 0.5 : 1 }}
                  ><X size={13} strokeWidth={2.2} /> Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-4 md:h-[calc(100vh-160px)] md:grid-cols-[340px_1fr]">
        {/* List */}
        <div className="max-h-[360px] md:max-h-none" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Loan Applications</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {canEdit && (
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="btn-primary"
                    style={{ height: 28, padding: "0 10px", fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 4 }}
                    title="Add new application manually"
                  >
                    <Plus size={13} strokeWidth={2.5} /> Add Loan +
                  </button>
                )}
                {(role === "admin" || role === "branch_manager") && (
                  <button
                    onClick={() => setShowCustomizer(true)}
                    className="icon-btn"
                    style={{ width: 28, height: 28 }}
                    title="Customize WhatsApp Loan Form"
                    aria-label="Customize WhatsApp Loan Form"
                  >
                    <Settings2 size={13.5} strokeWidth={2} />
                  </button>
                )}
                <a href="/api/loans/export" className="icon-btn" style={{ width: 28, height: 28 }} title="Export all loan applications as CSV" aria-label="Export CSV">
                  <Download size={13.5} strokeWidth={2} />
                </a>
              </div>
            </div>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                placeholder="Search name or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: "100%", height: 34, fontSize: 12.5, paddingRight: 34 }}
              />
              <div style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)" }}>
                <VoiceDictation
                  onTranscript={(spoken) => setSearch(prev => (prev ? `${prev} ${spoken}` : spoken))}
                  size={14}
                  style={{ width: 28, height: 28, border: "none", background: "transparent" }}
                  title="Speak to search applications"
                />
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading && <SkeletonList rows={4} />}
            {!loading && loadError && <div style={{ padding: 30, textAlign: "center", color: "var(--accent-red)", fontSize: 13 }}>{loadError}</div>}
            {!loading && !loadError && filtered.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No applications found.</div>}
            {filtered.map((app) => (
              <div
                key={app.id}
                onClick={() => setSelectedId(app.id)}
                style={{
                  padding: "12px 16px", borderBottom: "1px solid var(--border-light)", cursor: "pointer",
                  background: selectedId === app.id ? "var(--overlay-soft)" : "transparent",
                  borderLeft: selectedId === app.id ? "3px solid var(--accent-violet)" : "3px solid transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{app.customer_name}</div>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                    background: (STATUS_COLORS[app.status] || STATUS_COLORS.pending).bg,
                    color: (STATUS_COLORS[app.status] || STATUS_COLORS.pending).color,
                    textTransform: "uppercase", letterSpacing: "0.04em",
                  }}>
                    {app.status?.replace("_", " ")}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {app.loan_type} · {formatCurrency(app.loan_amount)}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", justifyContent: "space-between" }}>
                  <span>{app.city || "—"}</span>
                  <span>{timeAgo(app.submitted_at || app.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, overflowY: "auto" }}>
          {!selected ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 13 }}>
              Select an application to view details
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{selected.customer_name}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
                    Submitted {formatDateTime(selected.submitted_at || selected.created_at)} ({timeAgo(selected.submitted_at || selected.created_at)})
                    {selected.last_edited_at && <> · edited {timeAgo(selected.last_edited_at)}</>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={() => openHistory(selected.id)}
                    className="btn-ghost"
                    style={{ height: 32, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <History size={13} /> History
                  </button>
                  {canEdit && (
                    <select
                      value={selected.status}
                      onChange={(e) => markStatus(selected.id, e.target.value)}
                      style={{ height: 32, fontSize: 12, fontWeight: 600, padding: "0 10px" }}
                    >
                      <option value="pending">Pending</option>
                      <option value="under_review">Under Review</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  )}
                </div>
              </div>

              {/* Quick stats cards */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Loan Type</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{selected.loan_type}</div>
                </div>
                <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Requested Amount</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, color: "var(--accent-green)" }}>{formatCurrency(selected.loan_amount)}</div>
                </div>
                <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tenure</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{selected.loan_tenure ? `${selected.loan_tenure} Mo` : "—"}</div>
                </div>
                <div style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Monthly Income</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{selected.monthly_income ? formatINR(selected.monthly_income) : "—"}</div>
                </div>
              </div>

              {selected.loan_amount > 0 && (
                <EmiEstimate loanAmount={selected.loan_amount} loanType={selected.loan_type} />
              )}

              {/* Applicant Details */}
              <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Applicant Information</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2" style={{ fontSize: 12.5 }}>
                  <div><span style={{ color: "var(--text-muted)" }}>WhatsApp / Phone:</span> <span style={{ fontWeight: 600 }}>{selected.whatsapp_number}</span></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Email:</span> <span style={{ fontWeight: 600 }}>{selected.email || "—"}</span></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Employment:</span> <span style={{ fontWeight: 600 }}>{selected.employment_type || "—"}</span></div>
                  <div><span style={{ color: "var(--text-muted)" }}>PAN Card:</span> <span style={{ fontWeight: 600, letterSpacing: "0.04em" }}>{selected.pan_number || "—"}</span></div>
                  <div><span style={{ color: "var(--text-muted)" }}>City:</span> <span style={{ fontWeight: 600 }}>{selected.city || "—"}</span></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Address:</span> <span style={{ fontWeight: 600 }}>{selected.address || "—"}</span></div>
                </div>
              </div>

              {/* Extra customized fields if submitted */}
              {Object.keys(formExtras).length > 0 && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Additional Form Responses</div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2" style={{ fontSize: 12 }}>
                    {Object.entries(formExtras).map(([k, v]) => (
                      <div key={k}>
                        <span style={{ color: "var(--text-muted)", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}:</span>{" "}
                        <span style={{ fontWeight: 600 }}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Loan Application Modal */}
      {showAddModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16,
        }}>
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16,
            maxWidth: 540, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column",
            boxShadow: "0 24px 48px rgba(0,0,0,0.4)", overflow: "hidden",
          }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(34,197,94,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-green)" }}>
                  <Plus size={16} strokeWidth={2.4} />
                </span>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Add Loan Application +</div>
              </div>
              <button onClick={() => setShowAddModal(false)} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddLoan} style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                    Customer Name *
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      required
                      value={newApp.customer_name}
                      onChange={(e) => setNewApp({ ...newApp, customer_name: e.target.value })}
                      placeholder="e.g. Rahul Sharma"
                      style={{ width: "100%", height: 38, paddingRight: 34 }}
                    />
                    <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                      <VoiceDictation onTranscript={(t: string) => setNewApp((prev) => ({ ...prev, customer_name: prev.customer_name ? `${prev.customer_name} ${t}` : t }))} title="Speak customer name" />
                    </div>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                    WhatsApp / Phone *
                  </label>
                  <input
                    required
                    value={newApp.whatsapp_number}
                    onChange={(e) => setNewApp({ ...newApp, whatsapp_number: e.target.value })}
                    placeholder="e.g. 9876543210"
                    style={{ width: "100%", height: 38 }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                    Loan Type
                  </label>
                  <select
                    value={newApp.loan_type}
                    onChange={(e) => setNewApp({ ...newApp, loan_type: e.target.value })}
                    style={{ width: "100%", height: 38 }}
                  >
                    <option value="Home Loan">Home Loan</option>
                    <option value="Business Loan">Business Loan</option>
                    <option value="Personal Loan">Personal Loan</option>
                    <option value="Loan Against Property (LAP)">Loan Against Property (LAP)</option>
                    <option value="Education Loan">Education Loan</option>
                    <option value="Vehicle Loan">Vehicle Loan</option>
                    <option value="Gold Loan">Gold Loan</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                    Loan Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={newApp.loan_amount}
                    onChange={(e) => setNewApp({ ...newApp, loan_amount: e.target.value })}
                    placeholder="e.g. 2500000"
                    style={{ width: "100%", height: 38 }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                    Tenure (Months)
                  </label>
                  <input
                    type="number"
                    value={newApp.loan_tenure}
                    onChange={(e) => setNewApp({ ...newApp, loan_tenure: e.target.value })}
                    placeholder="e.g. 120"
                    style={{ width: "100%", height: 38 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                    Monthly Income (₹)
                  </label>
                  <input
                    type="number"
                    value={newApp.monthly_income}
                    onChange={(e) => setNewApp({ ...newApp, monthly_income: e.target.value })}
                    placeholder="e.g. 75000"
                    style={{ width: "100%", height: 38 }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                    Employment Type
                  </label>
                  <select
                    value={newApp.employment_type}
                    onChange={(e) => setNewApp({ ...newApp, employment_type: e.target.value })}
                    style={{ width: "100%", height: 38 }}
                  >
                    <option value="Salaried">Salaried</option>
                    <option value="Self-Employed">Self-Employed</option>
                    <option value="Business Owner">Business Owner</option>
                    <option value="Retired">Retired</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                    PAN Number
                  </label>
                  <input
                    value={newApp.pan_number}
                    onChange={(e) => setNewApp({ ...newApp, pan_number: e.target.value.toUpperCase() })}
                    placeholder="e.g. ABCDE1234F"
                    style={{ width: "100%", height: 38 }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                    City
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      value={newApp.city}
                      onChange={(e) => setNewApp({ ...newApp, city: e.target.value })}
                      placeholder="e.g. Hyderabad"
                      style={{ width: "100%", height: 38, paddingRight: 34 }}
                    />
                    <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                      <VoiceDictation onTranscript={(t: string) => setNewApp((prev) => ({ ...prev, city: prev.city ? `${prev.city} ${t}` : t }))} title="Speak city" />
                    </div>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                    Initial Status
                  </label>
                  <select
                    value={newApp.status}
                    onChange={(e) => setNewApp({ ...newApp, status: e.target.value })}
                    style={{ width: "100%", height: 38 }}
                  >
                    <option value="pending">Pending</option>
                    <option value="under_review">Under Review</option>
                    <option value="approved">Approved</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                  Residential Address
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    value={newApp.address}
                    onChange={(e) => setNewApp({ ...newApp, address: e.target.value })}
                    placeholder="Plot/Flat No, Street, Landmark"
                    style={{ width: "100%", height: 38, paddingRight: 34 }}
                  />
                  <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                    <VoiceDictation onTranscript={(t: string) => setNewApp((prev) => ({ ...prev, address: prev.address ? `${prev.address} ${t}` : t }))} title="Speak address" />
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn-ghost" style={{ height: 38, padding: "0 16px" }}>
                  Cancel
                </button>
                <button type="submit" disabled={adding} className="btn-primary" style={{ height: 38, padding: "0 22px", opacity: adding ? 0.6 : 1 }}>
                  {adding ? "Saving…" : "Add Application +"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp Form Customizer Modal */}
      {showCustomizer && (
        <LoanFormCustomizerModal
          onClose={() => setShowCustomizer(false)}
        />
      )}

      {/* Edit History Modal */}
      {historyFor && (
        <div
          onClick={() => setHistoryFor(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}><History size={16} strokeWidth={2.2} /> Edit history</div>
              <button onClick={() => setHistoryFor(null)} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
            </div>
            {historyLoading && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}
            {!historyLoading && history.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No edit history for this application.</div>}
            {!historyLoading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {history.map((h) => (
                  <div key={h.id} style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12, fontSize: 12.5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{fieldLabel(h.previous_values.field)}:</span>
                      <span style={{ color: "var(--accent-red)", textDecoration: "line-through" }}>{String(h.previous_values.value ?? "—")}</span>
                      →
                      <span style={{ color: h.status === "approved" ? "var(--accent-green)" : "var(--text-muted)", fontWeight: 600 }}>{String(h.proposed_values.value)}</span>
                      <span style={{
                        marginLeft: "auto", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                        color: h.status === "approved" ? "var(--accent-green)" : h.status === "rejected" ? "var(--accent-red)" : "var(--accent-yellow)",
                      }}>{h.status}</span>
                    </div>
                    {h.reason && <div style={{ color: "var(--text-muted)", fontStyle: "italic", marginBottom: 4 }}>"{h.reason}"</div>}
                    <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                      Proposed {timeAgo(h.created_at)} ({formatDateTime(h.created_at)}) by Priya ({h.proposed_by === "priya_voice" ? "call" : "WhatsApp"})
                      {h.reviewed_by && <> · reviewed by {h.reviewed_by} {timeAgo(h.reviewed_at!)} ({formatDateTime(h.reviewed_at!)})</>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
