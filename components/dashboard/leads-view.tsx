"use client"
import { useEffect, useState } from "react"
import { Users, Target, IndianRupee, BadgeCheck, Phone, MessageCircle, RotateCcw, Plus, Search, Link2, Check, Download, Brain } from "lucide-react"
import { formatCurrency, timeAgo } from "@/lib/utils"
import { useToast } from "../ui/toast"
import { Skeleton } from "../ui/skeleton"
import LeadMemoryModal from "./lead-memory-modal"

import { PRODUCT_GROUPS, LOAN_TYPES } from "@/lib/products"

type Lead = {
  id: string; name: string; phone: string; address: string; whatsapp_number: string
  product_interest: string; status: string; interested: string; loan_amount: number; language: string
  call_count: number; created_at: string; updated_at: string; score: number
  form_token: string | null; form_used_at: string | null; form_sent_at: string | null
  form_completed: boolean
}

// Shows exactly what the WhatsApp form link is doing for this lead:
// nothing sent yet / sent & waiting / submitted. Click copies the link.
function FormLinkCell({ lead }: { lead: Lead }) {
  const [copied, setCopied] = useState(false)
  if (!lead.form_token) return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>

  const submitted = lead.form_completed || !!lead.form_used_at
  const tone = submitted ? "#2dd4a0" : "#f7b731"
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
  const tone = score >= 70 ? "#2dd4a0" : score >= 40 ? "#f7b731" : "#64708c"
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: tone, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums" }}>{score}</span>
    </div>
  )
}

const INTERESTED_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  interested:     { bg: "rgba(34,197,94,0.15)",  color: "#4ade80", label: "Interested" },
  not_interested: { bg: "rgba(239,68,68,0.15)",  color: "#f87171", label: "Not Interested" },
  unknown:        { bg: "rgba(100,116,139,0.15)",color: "#94a3b8", label: "Unknown" },
}

function Avatar({ name }: { name: string }) {
  const initials = (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
  const colors = ["#1d4ed8", "#7c3aed", "#0891b2", "#047857", "#b45309"]
  const color = colors[(name || "?").charCodeAt(0) % colors.length]
  return (
    <div style={{ width: 36, height: 36, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "white", flexShrink: 0 }}>
      {initials}
    </div>
  )
}

export default function LeadsView({ role, initialSearch }: { role: "admin" | "agent" | "viewer" | "developer"; initialSearch?: string }) {
  const canEdit = role !== "viewer"
  const toast = useToast()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(initialSearch || "")

  // Command-palette jumps re-seed the search box.
  useEffect(() => { if (initialSearch !== undefined) setSearch(initialSearch) }, [initialSearch])
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

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set("search", search)
    if (ageFilter !== "all") params.set("age", ageFilter)
    if (amountFilter !== "all") params.set("amount", amountFilter)
    if (loanTypeFilter !== "all") params.set("loanType", loanTypeFilter)
    if (interestedFilter !== "all") params.set("interested", interestedFilter)
    const res = await fetch(`/api/leads?${params.toString()}`)
    if (res.ok) setLeads(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [search, ageFilter, amountFilter, loanTypeFilter, interestedFilter])

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
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: callTarget.id, phone: callTarget.phone, language: callTarget.language || "telugu", instructions: callInstructions }),
    })
    const data = await res.json()
    setCalling(null)
    setCallTarget(null)
    setCallInstructions("")
    if (res.ok) { toast.success("AI call started — Priya is dialing now"); load() }
    else toast.error(data.error || "Call failed")
  }

  async function sendWa() {
    if (!waTarget || !waText.trim()) return
    setWaSending(true)
    const to = waTarget.whatsapp_number || waTarget.phone
    const res = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, message: waText, leadId: waTarget.id }),
    })
    const data = await res.json()
    setWaSending(false)
    if (res.ok) { setWaTarget(null); setWaText(""); toast.success("WhatsApp message sent") }
    else toast.error(data.error === "WHATSAPP_NOT_CONFIGURED" ? data.message : data.error || "Send failed")
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
        <Card label="Total Leads" value={totalLeads.toLocaleString()} icon={Users} tone="#8b7cff" />
        <Card label="Interested" value={interestedCount.toLocaleString()} icon={Target} tone="#38bdf8" />
        <Card label="Pipeline Value" value={formatCurrency(pipelineValue)} icon={IndianRupee} tone="#f7b731" />
        <Card label="Qualified" value={qualified.toLocaleString()} icon={BadgeCheck} tone="#2dd4a0" />
      </div>

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          {/* Single compact filter row */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", width: 200 }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input
                placeholder="Search name or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: "100%", height: 34, fontSize: 12.5, paddingLeft: 30 }}
              />
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
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{leads.length} shown</div>
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
        <table style={{ width: "100%", minWidth: 780, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
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
                {Array.from({ length: 9 }).map((_, j) => (
                  <td key={j} style={{ padding: "14px 16px" }}><Skeleton w={j === 8 ? 68 : 52} h={12} /></td>
                ))}
              </tr>
            ))}
            {!loading && leads.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No leads match these filters.</td></tr>
            )}
            {leads.map((lead) => {
              const ist = INTERESTED_STYLES[lead.interested] ?? INTERESTED_STYLES.unknown
              return (
                <tr key={lead.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={lead.name} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{lead.name || "Unknown"}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{lead.phone}</div>
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
                  <td style={{ padding: "14px 16px", color: "var(--text-muted)", fontSize: 12 }}>{timeAgo(lead.updated_at || lead.created_at)}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {canEdit && (
                        <>
                          <button
                            onClick={() => { setCallTarget(lead); setCallInstructions("") }}
                            disabled={!lead.phone || calling === lead.id}
                            title="Call with AI"
                            style={{ background: "rgba(139,124,255,0.12)", border: "1px solid rgba(139,124,255,0.28)", color: "#a5b0ff", borderRadius: 9, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: calling === lead.id ? 0.5 : 1 }}
                          ><Phone size={14} strokeWidth={1.9} /></button>
                          <button
                            onClick={() => setWaTarget(lead)}
                            disabled={!lead.phone && !lead.whatsapp_number}
                            title="Send WhatsApp"
                            style={{ background: "rgba(45,212,160,0.1)", border: "1px solid rgba(45,212,160,0.28)", color: "#2dd4a0", borderRadius: 9, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          ><MessageCircle size={14} strokeWidth={1.9} /></button>
                        </>
                      )}
                      <button
                        onClick={() => setMemoryLeadId(lead.id)}
                        title="View Lead Memory"
                        style={{ background: "rgba(247,183,49,0.1)", border: "1px solid rgba(247,183,49,0.28)", color: "#f7b731", borderRadius: 9, width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
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

      {/* Add Lead modal */}
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 440 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Add New Lead</div>
            {[["name", "Full Name *"], ["phone", "Phone *"], ["address", "Address"], ["loan_amount", "Loan Amount (₹)"]].map(([k, l]) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>{l}</label>
                <input value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
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
            <textarea
              value={callInstructions}
              onChange={(e) => setCallInstructions(e.target.value)}
              placeholder="e.g. Follow up on his home loan enquiry, mention the 8.4% rate offer"
              rows={4}
              style={{ width: "100%", background: "#0d1422", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 8, padding: 10, fontSize: 13, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setCallTarget(null)} style={{ flex: 1, padding: 10, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)" }}>Cancel</button>
              <button onClick={startCall} disabled={calling === callTarget.id} className="btn-primary" style={{ flex: 1, height: 40 }}>
                <Phone size={14} strokeWidth={2} /> {calling === callTarget.id ? "Calling…" : "Start Call"}
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
            <textarea
              value={waText}
              onChange={(e) => setWaText(e.target.value)}
              placeholder="Type a WhatsApp message…"
              rows={4}
              style={{ width: "100%", background: "#0d1422", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 8, padding: 10, fontSize: 13, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setWaTarget(null)} style={{ flex: 1, padding: 10, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)" }}>Cancel</button>
              <button onClick={sendWa} disabled={waSending || !waText.trim()} style={{ flex: 1, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "linear-gradient(135deg, #2dd4a0, #16a37b)", border: "none", borderRadius: 10, color: "white", fontWeight: 600, fontSize: 13, boxShadow: "0 4px 16px -4px rgba(45,212,160,0.45)", opacity: waSending || !waText.trim() ? 0.5 : 1 }}>
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
