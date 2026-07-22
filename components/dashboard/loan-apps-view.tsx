"use client"
import { useEffect, useState } from "react"
import { BadgeCheck, Download, PenLine, Check, X, History } from "lucide-react"
import { formatCurrency, timeAgo } from "@/lib/utils"
import { SkeletonList } from "../ui/skeleton"
import { useToast } from "../ui/toast"

type LoanApp = {
  id: string; customer_name: string; city: string; loan_type: string
  loan_amount: number; status: string; email: string; address: string; whatsapp_number: string
  employment_type: string; monthly_income: number; form_data: any; submitted_at: string; created_at: string
  last_edited_at?: string | null
}

type EditRequest = {
  id: string; loan_application_id: string; lead_name: string | null; customer_name: string | null
  proposed_by: string; reason: string | null
  previous_values: { field: string; value: any }; proposed_values: { field: string; value: any }
  status: "pending" | "approved" | "rejected"; reviewed_by: string | null; reviewed_at: string | null
  created_at: string
}

function fieldLabel(field: string): string {
  return field.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

function Avatar({ name }: { name: string }) {
  const initials = (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
  const colors = ["#1d4ed8", "#7c3aed", "#0891b2", "#047857", "#b45309"]
  return (
    <div style={{ width: 36, height: 36, borderRadius: "50%", background: colors[(name || "?").charCodeAt(0) % colors.length], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "white", flexShrink: 0 }}>
      {initials}
    </div>
  )
}

export default function LoanAppsView({ role, initialSearch }: { role: "admin" | "agent" | "viewer" | "developer"; initialSearch?: string }) {
  const canEdit = role !== "viewer"
  const toast = useToast()
  const [apps, setApps] = useState<LoanApp[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState(initialSearch || "")
  const [pendingEdits, setPendingEdits] = useState<EditRequest[]>([])
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null) // application id
  const [history, setHistory] = useState<EditRequest[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Command-palette jumps re-seed the search box.
  useEffect(() => { if (initialSearch !== undefined) setSearch(initialSearch) }, [initialSearch])

  async function load() {
    setLoading(true)
    setLoadError("")
    try {
      const res = await fetch("/api/loans")
      if (res.ok) {
        const data = await res.json()
        setApps(data)
        if (data.length > 0 && !selectedId) setSelectedId(data[0].id)
      } else {
        // A failed fetch is NOT "no applications" — say so, or a server bug
        // reads as an empty database (which is exactly what happened once).
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
    const t = setInterval(loadPendingEdits, 15000)
    return () => clearInterval(t)
  }, [])

  const filtered = apps.filter((a) => !search || a.customer_name?.toLowerCase().includes(search.toLowerCase()))
  const selected = apps.find((a) => a.id === selectedId) || null

  async function markStatus(id: string, status: string) {
    await fetch("/api/loans", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) })
    load()
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
      if (action === "approve") load() // refresh the applied field in the list/detail
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

  let formExtras: Record<string, any> = {}
  if (selected?.form_data) {
    try { formExtras = typeof selected.form_data === "string" ? JSON.parse(selected.form_data) : selected.form_data } catch {}
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    {canEdit && pendingEdits.length > 0 && (
      <div style={{ background: "rgba(247,183,49,0.06)", border: "1px solid rgba(247,183,49,0.25)", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontWeight: 700, fontSize: 14, color: "#f7b731" }}>
          <PenLine size={16} strokeWidth={2.2} /> Priya flagged {pendingEdits.length} application correction{pendingEdits.length > 1 ? "s" : ""} — needs your review
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {pendingEdits.map((e) => (
            <div key={e.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{e.customer_name || e.lead_name || "Unknown"}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {fieldLabel(e.previous_values.field)}:
                  <span style={{ color: "#f87171", textDecoration: "line-through" }}>{String(e.previous_values.value ?? "—")}</span>
                  →
                  <span style={{ color: "#2dd4a0", fontWeight: 600 }}>{String(e.proposed_values.value)}</span>
                </div>
                {e.reason && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, fontStyle: "italic" }}>"{e.reason}"</div>}
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                  Flagged by Priya on {e.proposed_by === "priya_voice" ? "a call" : "WhatsApp"} · {timeAgo(e.created_at)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => reviewEditRequest(e.id, "approve")}
                  disabled={reviewing === e.id}
                  style={{ background: "rgba(45,212,160,0.12)", border: "1px solid rgba(45,212,160,0.3)", color: "#2dd4a0", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5, opacity: reviewing === e.id ? 0.5 : 1 }}
                ><Check size={13} strokeWidth={2.2} /> Approve</button>
                <button
                  onClick={() => reviewEditRequest(e.id, "reject")}
                  disabled={reviewing === e.id}
                  style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.28)", color: "#f87171", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5, opacity: reviewing === e.id ? 0.5 : 1 }}
                ><X size={13} strokeWidth={2.2} /> Reject</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
    {/* Mobile: stack list above detail, both naturally scrolling with the page.
        Desktop (md+): side-by-side 340px list + flexible detail, fixed height. */}
    <div className="grid grid-cols-1 gap-4 md:h-[calc(100vh-160px)] md:grid-cols-[340px_1fr]">
      {/* List */}
      <div className="max-h-[360px] md:max-h-none" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Loan Applications</div>
            <a href="/api/loans/export" className="icon-btn" title="Export all loan applications as CSV" aria-label="Export CSV">
              <Download size={14} strokeWidth={2} />
            </a>
          </div>
          <input placeholder="Search name..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", height: 34, fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <SkeletonList rows={4} />}
          {!loading && loadError && <div style={{ padding: 30, textAlign: "center", color: "#f87171", fontSize: 13 }}>{loadError}</div>}
          {!loading && !loadError && filtered.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No applications submitted yet.</div>}
          {filtered.map((app) => (
            <div
              key={app.id}
              onClick={() => setSelectedId(app.id)}
              style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-light)", cursor: "pointer", background: selectedId === app.id ? "rgba(59,130,246,0.08)" : "transparent" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar name={app.customer_name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{app.customer_name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{app.loan_type} · {timeAgo(app.submitted_at || app.created_at)}</div>
                </div>
                {app.status === "qualified" && <BadgeCheck size={15} strokeWidth={2} style={{ color: "#2dd4a0", flexShrink: 0 }} />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflowY: "auto" }}>
        {!selected ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Select an application to view details.</div>
        ) : (
          <div style={{ padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Avatar name={selected.customer_name} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{selected.customer_name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Applied {timeAgo(selected.submitted_at || selected.created_at)}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {selected.last_edited_at && (
                  <button
                    onClick={() => openHistory(selected.id)}
                    title={`Edited ${timeAgo(selected.last_edited_at)}`}
                    style={{ background: "rgba(247,183,49,0.1)", border: "1px solid rgba(247,183,49,0.28)", color: "#f7b731", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}
                  ><History size={13} strokeWidth={2.2} /> Edited</button>
                )}
                {selected.status === "qualified" ? (
                  <span style={{ color: "#2dd4a0", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(45,212,160,0.1)", border: "1px solid rgba(45,212,160,0.3)", borderRadius: 8, padding: "6px 14px" }}><BadgeCheck size={14} strokeWidth={2} /> Qualified</span>
                ) : canEdit ? (
                  <button onClick={() => markStatus(selected.id, "qualified")} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-secondary)", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600 }}>Mark Qualified</button>
                ) : null}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[
                ["Loan Type", selected.loan_type],
                ["Loan Amount", selected.loan_amount ? formatCurrency(selected.loan_amount) : "—"],
                ["Monthly Income", selected.monthly_income ? formatCurrency(selected.monthly_income) : "—"],
                ["Employment", selected.employment_type || "—"],
                ["Email", selected.email || "—"],
                ["WhatsApp", selected.whatsapp_number || "—"],
                ["City", selected.city || "—"],
                ["Address", selected.address || "—"],
              ].map(([l, v]) => (
                <div key={l as string} style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{l}</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{v as string}</div>
                </div>
              ))}
            </div>

            {Object.keys(formExtras).length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>ADDITIONAL SUBMITTED FIELDS</div>
                <pre style={{ fontSize: 12, color: "var(--text-secondary)", background: "var(--bg-secondary)", borderRadius: 8, padding: 14, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                  {JSON.stringify(formExtras, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

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
                    <span style={{ color: "#f87171", textDecoration: "line-through" }}>{String(h.previous_values.value ?? "—")}</span>
                    →
                    <span style={{ color: h.status === "approved" ? "#2dd4a0" : "var(--text-muted)", fontWeight: 600 }}>{String(h.proposed_values.value)}</span>
                    <span style={{
                      marginLeft: "auto", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                      color: h.status === "approved" ? "#2dd4a0" : h.status === "rejected" ? "#f87171" : "#f7b731",
                    }}>{h.status}</span>
                  </div>
                  {h.reason && <div style={{ color: "var(--text-muted)", fontStyle: "italic", marginBottom: 4 }}>"{h.reason}"</div>}
                  <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    Proposed {timeAgo(h.created_at)} by Priya ({h.proposed_by === "priya_voice" ? "call" : "WhatsApp"})
                    {h.reviewed_by && <> · reviewed by {h.reviewed_by} {timeAgo(h.reviewed_at!)}</>}
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
