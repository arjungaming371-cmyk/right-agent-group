"use client"
// Global search (Ctrl+K) — searches leads, loan applications, and calls live,
// plus quick view navigation. Opened from the topbar search button or keyboard.

import { useEffect, useMemo, useRef, useState } from "react"
import { Search, Users, FileText, Phone, ArrowRight, CornerDownLeft } from "lucide-react"
import type { ViewKey } from "../dashboard/shell"
import VoiceDictation from "./voice-dictation"

type Result = {
  id: string
  group: "Views" | "Leads" | "Loan Applications" | "Calls"
  title: string
  sub: string
  view: ViewKey
  search?: string
  icon: typeof Users
}

type Props = {
  open: boolean
  onClose: () => void
  onNavigate: (view: ViewKey, search?: string) => void
  /** view keys this user's role is allowed to see */
  allowedViews: ViewKey[]
}

const VIEW_ACTIONS: { key: ViewKey; label: string }[] = [
  { key: "analytics", label: "Analytics" },
  { key: "leads", label: "Leads" },
  { key: "loans", label: "Loan Applications" },
  { key: "voice", label: "Voice Logs" },
  { key: "whatsapp", label: "WhatsApp Chat" },
  { key: "comms", label: "Communication Log" },
  { key: "security", label: "Security" },
  { key: "upload", label: "Upload & Data" },
  { key: "script", label: "Priya's Script" },
]

export default function CommandPalette({ open, onClose, onNavigate, allowedViews }: Props) {
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const [leads, setLeads] = useState<any[]>([])
  const [loans, setLoans] = useState<any[]>([])
  const [calls, setCalls] = useState<any[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Fetch fresh data each time the palette opens (cheap: three list endpoints).
  useEffect(() => {
    if (!open) return
    setQ("")
    setActive(0)
    setTimeout(() => inputRef.current?.focus(), 10)
    Promise.all([
      fetch("/api/leads").then(r => (r.ok ? r.json() : [])),
      fetch("/api/loans").then(r => (r.ok ? r.json() : [])),
      fetch("/api/calls").then(r => (r.ok ? r.json() : [])),
    ]).then(([l, lo, c]) => {
      setLeads(Array.isArray(l) ? l : [])
      setLoans(Array.isArray(lo) ? lo : [])
      setCalls(Array.isArray(c) ? c : [])
    }).catch(() => {})
  }, [open])

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase()
    const out: Result[] = []

    for (const v of VIEW_ACTIONS) {
      if (!allowedViews.includes(v.key)) continue
      if (needle && !v.label.toLowerCase().includes(needle)) continue
      out.push({ id: `view-${v.key}`, group: "Views", title: v.label, sub: "Go to view", view: v.key, icon: ArrowRight })
    }

    if (needle) {
      for (const l of leads) {
        const name = (l.name || "").toLowerCase()
        const phone = (l.phone || "").toLowerCase()
        if (!name.includes(needle) && !phone.includes(needle)) continue
        out.push({ id: `lead-${l.id}`, group: "Leads", title: l.name || l.phone, sub: `${l.phone}${l.product_interest ? " · " + l.product_interest : ""}`, view: "leads", search: l.name || l.phone, icon: Users })
        if (out.length > 40) break
      }
      for (const a of loans) {
        const name = (a.customer_name || "").toLowerCase()
        if (!name.includes(needle)) continue
        out.push({ id: `loan-${a.id}`, group: "Loan Applications", title: a.customer_name, sub: `${a.loan_type || "Loan"}${a.loan_amount ? " · ₹" + Number(a.loan_amount).toLocaleString("en-IN") : ""}`, view: "loans", search: a.customer_name, icon: FileText })
        if (out.length > 50) break
      }
      for (const c of calls) {
        const name = (c.leads?.name || "").toLowerCase()
        const phone = (c.phone || "").toLowerCase()
        if (!name.includes(needle) && !phone.includes(needle)) continue
        out.push({ id: `call-${c.id}`, group: "Calls", title: c.leads?.name || c.phone, sub: `${c.direction || "call"} · ${c.outcome || c.status || ""}`, view: "voice", icon: Phone })
        if (out.length > 60) break
      }
    }
    return out.slice(0, 24)
  }, [q, leads, loans, calls, allowedViews])

  // Clamp the active row whenever results shrink.
  useEffect(() => { setActive(a => Math.min(a, Math.max(0, results.length - 1))) }, [results.length])

  function pick(r: Result) {
    onNavigate(r.view, r.search)
    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); pick(results[active]) }
    else if (e.key === "Escape") onClose()
  }

  // Keep the active row scrolled into view during keyboard navigation.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (!open) return null

  let lastGroup = ""
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(3,5,10,0.72)", backdropFilter: "blur(3px)", zIndex: 2500, display: "flex", justifyContent: "center", paddingTop: "14vh" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 600, maxWidth: "calc(100vw - 32px)", height: "fit-content", maxHeight: "58vh",
          /* Themed surface — see the note in toast.tsx: a hardcoded dark
             panel under themed text breaks light theme. var(--bg-card) is
             the elevated surface token and resolves in both themes. */
          background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16,
          boxShadow: "0 24px 80px -16px rgba(0,0,0,0.8), 0 0 0 1px rgba(139,124,255,0.06)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          animation: "paletteIn 0.16s cubic-bezier(0.21,1.02,0.73,1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "15px 18px", borderBottom: "1px solid var(--border-light)" }}>
          <Search size={17} strokeWidth={2} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search leads, applications, calls…"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 15, padding: 0 }}
          />
          <VoiceDictation
            onTranscript={(spoken) => {
              setQ(prev => (prev ? `${prev} ${spoken}` : spoken))
            }}
            size={15}
            style={{ width: 28, height: 28, border: "none", background: "transparent" }}
            title="Speak to search"
          />
          <span className="kbd">esc</span>
        </div>

        <div ref={listRef} style={{ overflowY: "auto", padding: "6px 8px 10px" }}>
          {results.length === 0 && (
            <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              No matches for “{q}”.
            </div>
          )}
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null
            lastGroup = r.group
            const isActive = i === active
            const Icon = r.icon
            return (
              <div key={r.id}>
                {header && (
                  <div style={{ padding: "10px 10px 5px", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    {header}
                  </div>
                )}
                <button
                  data-idx={i}
                  onClick={() => pick(r)}
                  onMouseMove={() => setActive(i)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 12,
                    padding: "9px 10px", borderRadius: 10, textAlign: "left",
                    background: isActive ? "rgba(139,124,255,0.13)" : "transparent",
                    border: isActive ? "1px solid rgba(139,124,255,0.22)" : "1px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--overlay-hover)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: isActive ? "var(--accent-violet)" : "var(--text-muted)", flexShrink: 0 }}>
                    <Icon size={14} strokeWidth={1.9} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 550, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textTransform: "capitalize" }}>{r.sub}</span>
                  </span>
                  {isActive && <CornerDownLeft size={13} strokeWidth={2} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
