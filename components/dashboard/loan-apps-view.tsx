"use client"
import { useEffect, useState } from "react"
import { BadgeCheck, Download } from "lucide-react"
import { formatCurrency, timeAgo } from "@/lib/utils"
import { SkeletonList } from "../ui/skeleton"

type LoanApp = {
  id: string; customer_name: string; city: string; loan_type: string
  loan_amount: number; status: string; email: string; address: string; whatsapp_number: string
  employment_type: string; monthly_income: number; form_data: any; submitted_at: string; created_at: string
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

export default function LoanAppsView({ role, initialSearch }: { role: "admin" | "agent" | "viewer"; initialSearch?: string }) {
  const canEdit = role !== "viewer"
  const [apps, setApps] = useState<LoanApp[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState(initialSearch || "")

  // Command-palette jumps re-seed the search box.
  useEffect(() => { if (initialSearch !== undefined) setSearch(initialSearch) }, [initialSearch])

  async function load() {
    setLoading(true)
    const res = await fetch("/api/loans")
    if (res.ok) {
      const data = await res.json()
      setApps(data)
      if (data.length > 0 && !selectedId) setSelectedId(data[0].id)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = apps.filter((a) => !search || a.customer_name?.toLowerCase().includes(search.toLowerCase()))
  const selected = apps.find((a) => a.id === selectedId) || null

  async function markStatus(id: string, status: string) {
    await fetch("/api/loans", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) })
    load()
  }

  let formExtras: Record<string, any> = {}
  if (selected?.form_data) {
    try { formExtras = typeof selected.form_data === "string" ? JSON.parse(selected.form_data) : selected.form_data } catch {}
  }

  return (
    // Mobile: stack list above detail, both naturally scrolling with the page.
    // Desktop (md+): side-by-side 340px list + flexible detail, fixed height.
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
          {!loading && filtered.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No applications submitted yet.</div>}
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
              {selected.status === "qualified" ? (
                <span style={{ color: "#2dd4a0", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(45,212,160,0.1)", border: "1px solid rgba(45,212,160,0.3)", borderRadius: 8, padding: "6px 14px" }}><BadgeCheck size={14} strokeWidth={2} /> Qualified</span>
              ) : canEdit ? (
                <button onClick={() => markStatus(selected.id, "qualified")} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-secondary)", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600 }}>Mark Qualified</button>
              ) : null}
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
  )
}
