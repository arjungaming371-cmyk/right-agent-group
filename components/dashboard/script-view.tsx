"use client"
import { useEffect, useState } from "react"
import { Lightbulb, Save, RotateCcw, CalendarClock, Timer, RefreshCw, Languages } from "lucide-react"

type Script = {
  language: string
  content: string
  updated_at: string
  updated_by: string
}

const LANG_LABELS: Record<string, { label: string; short: string; desc: string }> = {
  english: { label: "English",  short: "EN", desc: "Used when customer speaks English" },
  hindi:   { label: "Hindi",    short: "हि",  desc: "Used when customer speaks Hindi" },
  telugu:  { label: "Telugu",   short: "తె",  desc: "Used when customer speaks Telugu" },
}

const TIPS = [
  "Tell Priya WHO she is: her name, company name, city",
  "Tell Priya WHAT to collect: name, address, WhatsApp number",
  "Tell Priya HOW to handle objections: fraud questions, busy customers",
  "Tell Priya what NOT to say: no OTP, no guaranteed approval",
  "Keep rules short and clear — one rule per line works best",
  "Changes take effect within 5 minutes on the next call",
  "If you break something, click Reset to Default",
]

function timeAgo(dateStr: string) {
  if (!dateStr) return "—"
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function ScriptView() {
  const [scripts, setScripts]     = useState<Script[]>([])
  const [selected, setSelected]   = useState<string>("english")
  const [content, setContent]     = useState<string>("")
  const [original, setOriginal]   = useState<string>("")
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [resetting, setResetting] = useState(false)
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [charCount, setCharCount] = useState(0)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/script")
      const data = await res.json()
      if (res.ok && data.scripts) {
        setScripts(data.scripts)
        const current = data.scripts.find((s: Script) => s.language === selected)
        if (current) {
          setContent(current.content)
          setOriginal(current.content)
          setCharCount(current.content.length)
        }
      }
    } catch {
      setMsg({ type: "err", text: "Could not load scripts. Check your database connection." })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function switchLanguage(lang: string) {
    const s = scripts.find(x => x.language === lang)
    if (s) {
      setSelected(lang)
      setContent(s.content)
      setOriginal(s.content)
      setCharCount(s.content.length)
      setMsg(null)
    }
  }

  async function save() {
    if (!content.trim()) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch("/api/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: selected, content }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg({ type: "ok", text: "Script saved! Priya will use this on the next call (within 5 minutes)." })
        setOriginal(content)
        await load()
      } else {
        setMsg({ type: "err", text: `${data.error}` })
      }
    } catch {
      setMsg({ type: "err", text: "Save failed. Please try again." })
    }
    setSaving(false)
  }

  async function resetToDefault() {
    if (!confirm(`Reset the ${LANG_LABELS[selected]?.label} script to the original default? Your changes will be lost.`)) return
    setResetting(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/script?language=${selected}`, { method: "DELETE" })
      const data = await res.json()
      if (res.ok) {
        setMsg({ type: "ok", text: "Reset to default script successfully." })
        await load()
      } else {
        setMsg({ type: "err", text: `${data.error}` })
      }
    } catch {
      setMsg({ type: "err", text: "Reset failed. Please try again." })
    }
    setResetting(false)
  }

  const isDirty      = content !== original
  const currentScript = scripts.find(s => s.language === selected)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {["english","hindi","telugu"].map(lang => {
          const sc = scripts.find(s => s.language === lang)
          const meta = LANG_LABELS[lang]
          return (
            <div
              key={lang}
              onClick={() => switchLanguage(lang)}
              style={{
                background: selected === lang ? "linear-gradient(135deg, rgba(139,124,255,0.1), rgba(56,189,248,0.04))" : "var(--bg-card)",
                border: `1.5px solid ${selected === lang ? "rgba(139,124,255,0.5)" : "var(--border)"}`,
                borderRadius: 13, padding: 20, cursor: "pointer", transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 8 }}>
                <span style={{
                  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700,
                  background: selected === lang ? "var(--gradient-brand)" : "rgba(255,255,255,0.05)",
                  color: selected === lang ? "#fff" : "var(--text-secondary)",
                  border: selected === lang ? "none" : "1px solid var(--border)",
                }}>{meta.short}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: selected === lang ? "#a5b0ff" : "var(--text-primary)" }}>{meta.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{meta.desc}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Last updated: {sc ? timeAgo(sc.updated_at) : "—"}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                {sc ? `${sc.content.length.toLocaleString()} characters` : "—"}
              </div>
            </div>
          )
        })}
      </div>

      {/* Tips box */}
      <div style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, padding: "14px 20px" }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "#8ba3ff", display: "flex", alignItems: "center", gap: 6 }}><Lightbulb size={14} strokeWidth={2} /> How to write a good script</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px" }}>
          {TIPS.map((t, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "2px 0", display: "flex", gap: 7, alignItems: "baseline" }}>
              <span style={{ color: i < 5 ? "#2dd4a0" : "#f7b731", flexShrink: 0 }}>•</span>{t}
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>

        {/* Editor topbar */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-secondary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(139,124,255,0.13)", border: "1px solid rgba(139,124,255,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#a5b0ff" }}>
              <Languages size={15} strokeWidth={1.9} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                Priya's Script — {LANG_LABELS[selected]?.label}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                This is the exact instruction Priya follows on every {LANG_LABELS[selected]?.label} call
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isDirty && (
              <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>● Unsaved changes</span>
            )}
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{charCount.toLocaleString()} chars</span>
            <button onClick={resetToDefault} disabled={resetting} className="btn-ghost" style={{ height: 34 }}>
              <RotateCcw size={13} strokeWidth={1.9} /> {resetting ? "Resetting…" : "Reset to Default"}
            </button>
            <button
              onClick={save}
              disabled={saving || !isDirty}
              className={isDirty ? "btn-primary" : "btn-ghost"}
              style={{ height: 34, padding: "0 18px" }}
            >
              <Save size={13.5} strokeWidth={2} /> {saving ? "Saving…" : "Save Script"}
            </button>
          </div>
        </div>

        {/* Message */}
        {msg && (
          <div style={{
            margin: "12px 20px 0",
            padding: "10px 16px",
            borderRadius: 8,
            background: msg.type === "ok" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${msg.type === "ok" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            color: msg.type === "ok" ? "#4ade80" : "#f87171",
            fontSize: 13, fontWeight: 500,
          }}>
            {msg.text}
          </div>
        )}

        {/* Textarea */}
        <div style={{ padding: 20 }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading script…</div>
          ) : (
            <textarea
              value={content}
              onChange={e => { setContent(e.target.value); setCharCount(e.target.value.length) }}
              spellCheck={false}
              style={{
                width: "100%",
                height: 480,
                background: "#0d1117",
                border: "1px solid var(--border)",
                borderRadius: 10,
                color: "#e2e8f0",
                padding: 16,
                fontSize: 13,
                fontFamily: "monospace",
                lineHeight: 1.7,
                resize: "vertical",
              }}
            />
          )}
        </div>

        {/* Footer info */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 24, fontSize: 12, color: "var(--text-muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarClock size={12.5} strokeWidth={1.8} /> Last saved: {currentScript ? timeAgo(currentScript.updated_at) : "never"}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Timer size={12.5} strokeWidth={1.8} /> Changes take effect within 5 minutes</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><RefreshCw size={12.5} strokeWidth={1.8} /> Priya checks for updates automatically</span>
        </div>
      </div>
    </div>
  )
}
