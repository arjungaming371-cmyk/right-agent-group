"use client"
import { useEffect, useState } from "react"
import { X, Brain, Lock, RefreshCw, Phone, MessageCircle, StickyNote, ArrowDownLeft, ArrowUpRight } from "lucide-react"
import { timeAgo } from "@/lib/utils"
import { useToast } from "../ui/toast"

type MemoryData = {
  lead: { id: string; name: string; phone: string; address: string; whatsapp_number: string; product_interest: string }
  memory: {
    facts: Record<string, any>
    locked_facts: string[]
    summary: string
    sentiment: string
    sentiment_history: { sentiment: string; at: string }[]
    stage: string
    last_analysis_at: string | null
    updated_at: string | null
  }
  timeline: { channel: string; direction: string; occurred_at: string; one_line_summary: string }[]
}

const FACT_FIELDS: { key: string; label: string; type: "text" | "number" | "array" }[] = [
  { key: "loan_amount_needed", label: "Loan Amount Needed (₹)", type: "number" },
  { key: "loan_type", label: "Loan Type", type: "text" },
  { key: "employment_type", label: "Employment Type", type: "text" },
  { key: "monthly_income", label: "Monthly Income (₹)", type: "number" },
  { key: "existing_loans", label: "Existing Loans", type: "text" },
  { key: "cibil_mentioned", label: "CIBIL Score", type: "text" },
  { key: "property_details", label: "Property Details", type: "text" },
  { key: "urgency_level", label: "Urgency", type: "text" },
  { key: "preferred_language", label: "Preferred Language", type: "text" },
  { key: "best_time_to_call", label: "Best Time to Call", type: "text" },
  { key: "family_references", label: "Family References", type: "text" },
  { key: "objections_raised", label: "Objections Raised", type: "array" },
  { key: "competitors_mentioned", label: "Competitors Mentioned", type: "array" },
]

const STAGES = ["new", "contacted", "interested", "docs_pending", "negotiating", "converted", "lost", "do_not_call"]

const SENTIMENT_COLOR: Record<string, string> = {
  positive: "#2dd4a0",
  neutral: "#64708c",
  frustrated: "#f7b731",
  hostile: "#f87171",
}

const STAGE_COLOR: Record<string, string> = {
  new: "#64708c", contacted: "#38bdf8", interested: "#8b7cff", docs_pending: "#f7b731",
  negotiating: "#f7b731", converted: "#2dd4a0", lost: "#94a3b8", do_not_call: "#f87171",
}

function fieldToString(v: any, type: "text" | "number" | "array"): string {
  if (v === null || v === undefined) return ""
  if (type === "array") return Array.isArray(v) ? v.join(", ") : String(v)
  return String(v)
}

export default function LeadMemoryModal({ leadId, canEdit, onClose }: { leadId: string; canEdit: boolean; onClose: () => void }) {
  const toast = useToast()
  const [data, setData] = useState<MemoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [summaryDraft, setSummaryDraft] = useState("")
  const [stageDraft, setStageDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/leads/${leadId}/memory`)
    if (res.ok) {
      const d: MemoryData = await res.json()
      setData(d)
      const nextDrafts: Record<string, string> = {}
      for (const f of FACT_FIELDS) nextDrafts[f.key] = fieldToString(d.memory.facts?.[f.key], f.type)
      setDrafts(nextDrafts)
      setDirty(new Set())
      setSummaryDraft(d.memory.summary || "")
      setStageDraft(d.memory.stage || "new")
    } else {
      toast.error("Could not load lead memory")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [leadId])

  function editField(key: string, value: string) {
    setDrafts((d) => ({ ...d, [key]: value }))
    setDirty((d) => new Set(d).add(key))
  }

  async function unlockField(key: string) {
    const res = await fetch(`/api/leads/${leadId}/memory`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unlockKeys: [key] }),
    })
    if (res.ok) { toast.success(`${key} unlocked — AI can update it again`); load() }
    else toast.error("Could not unlock field")
  }

  async function save() {
    if (!data) return
    setSaving(true)
    const facts: Record<string, any> = {}
    for (const f of FACT_FIELDS) {
      if (!dirty.has(f.key)) continue
      const raw = drafts[f.key]?.trim() ?? ""
      if (f.type === "number") facts[f.key] = raw === "" ? null : Number(raw)
      else if (f.type === "array") facts[f.key] = raw === "" ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean)
      else facts[f.key] = raw === "" ? null : raw
    }
    const body: any = {}
    if (Object.keys(facts).length) body.facts = facts
    if (summaryDraft !== data.memory.summary) body.summary = summaryDraft
    if (stageDraft !== data.memory.stage) body.stage = stageDraft

    if (Object.keys(body).length === 0) { setSaving(false); toast.success("Nothing to save"); return }

    const res = await fetch(`/api/leads/${leadId}/memory`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (res.ok) { toast.success("Lead memory updated"); load() }
    else { const d = await res.json().catch(() => ({})); toast.error(d.error || "Save failed") }
  }

  async function reanalyze() {
    setReanalyzing(true)
    const res = await fetch(`/api/leads/${leadId}/memory/reanalyze`, { method: "POST" })
    const d = await res.json().catch(() => ({}))
    setReanalyzing(false)
    if (res.ok) { toast.success("Re-analysis complete"); load() }
    else toast.error(d.error || "Re-analysis failed")
  }

  const CHANNEL_ICON: Record<string, any> = { voice: Phone, whatsapp: MessageCircle, manual: StickyNote }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, width: 720, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(139,124,255,0.15)", border: "1px solid rgba(139,124,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Brain size={17} strokeWidth={1.9} style={{ color: "#a5b0ff" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{data?.lead?.name || "Lead Memory"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{data?.lead?.phone}</div>
          </div>
          {data && (
            <span style={{ background: `${STAGE_COLOR[stageDraft] || "#64708c"}1f`, color: STAGE_COLOR[stageDraft] || "#64708c", border: `1px solid ${STAGE_COLOR[stageDraft] || "#64708c"}44`, borderRadius: 7, padding: "4px 10px", fontSize: 11.5, fontWeight: 600, textTransform: "capitalize" }}>
              {stageDraft.replace(/_/g, " ")}
            </span>
          )}
          <button onClick={onClose} className="icon-btn" aria-label="Close"><X size={16} /></button>
        </div>

        <div style={{ overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 20 }}>
          {loading && <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: 30 }}>Loading memory…</div>}

          {!loading && data && (
            <>
              {/* Stage + sentiment trend */}
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: 6 }}>STAGE</div>
                  <select
                    value={stageDraft}
                    disabled={!canEdit}
                    onChange={(e) => setStageDraft(e.target.value)}
                    style={{ height: 32, fontSize: 12.5, width: "100%" }}
                  >
                    {STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: 6 }}>SENTIMENT TREND</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, height: 32 }}>
                    {data.memory.sentiment_history.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No history yet</span>}
                    {data.memory.sentiment_history.slice(-12).map((s, i) => (
                      <div
                        key={i}
                        title={`${s.sentiment} — ${new Date(s.at).toLocaleString()}`}
                        style={{ width: 10, height: 10, borderRadius: "50%", background: SENTIMENT_COLOR[s.sentiment] || "#64708c", flexShrink: 0 }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Rolling summary */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: 6 }}>RELATIONSHIP SUMMARY</div>
                <textarea
                  value={summaryDraft}
                  disabled={!canEdit}
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  rows={4}
                  placeholder="No summary yet — Priya builds this automatically after calls and WhatsApp chats."
                  style={{ width: "100%", background: "#0d1422", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 8, padding: 10, fontSize: 13, resize: "vertical" }}
                />
              </div>

              {/* Known facts */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: 8 }}>KNOWN FACTS</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {FACT_FIELDS.map((f) => {
                    const locked = data.memory.locked_facts?.includes(f.key)
                    return (
                      <div key={f.key}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                          <label style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{f.label}</label>
                          {locked && (
                            <button
                              onClick={() => canEdit && unlockField(f.key)}
                              title="Locked by a manual edit — AI will not overwrite this. Click to unlock."
                              style={{ background: "none", border: "none", padding: 0, display: "flex", cursor: canEdit ? "pointer" : "default" }}
                            >
                              <Lock size={11} style={{ color: "#f7b731" }} />
                            </button>
                          )}
                        </div>
                        <input
                          value={drafts[f.key] ?? ""}
                          disabled={!canEdit}
                          onChange={(e) => editField(f.key, e.target.value)}
                          placeholder="—"
                          style={{ width: "100%", height: 30, fontSize: 12.5 }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Unified timeline */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: 8 }}>UNIFIED TIMELINE</div>
                {data.timeline.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No interactions logged yet.</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                  {data.timeline.map((t, i) => {
                    const Icon = CHANNEL_ICON[t.channel] || StickyNote
                    const DirIcon = t.direction === "in" ? ArrowDownLeft : ArrowUpRight
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 7, background: "rgba(139,124,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                          <Icon size={12} style={{ color: "#a5b0ff" }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ color: "var(--text-primary)" }}>{t.one_line_summary}</span>
                        </div>
                        <DirIcon size={12} style={{ color: "var(--text-muted)", marginTop: 3, flexShrink: 0 }} />
                        <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap", marginTop: 2 }}>{timeAgo(t.occurred_at)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer actions */}
        {!loading && data && (
          <div style={{ display: "flex", gap: 10, padding: "16px 22px", borderTop: "1px solid var(--border)" }}>
            <button
              onClick={reanalyze}
              disabled={reanalyzing}
              className="btn-ghost"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, opacity: reanalyzing ? 0.6 : 1 }}
            >
              <RefreshCw size={13} strokeWidth={2} className={reanalyzing ? "spin" : ""} />
              {reanalyzing ? "Re-analyzing…" : "Re-analyze"}
            </button>
            <div style={{ flex: 1 }} />
            {canEdit && (
              <button onClick={save} disabled={saving} className="btn-primary" style={{ height: 36 }}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
