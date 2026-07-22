"use client"
import { useEffect, useState } from "react"
import { Lightbulb, Save, RotateCcw, CalendarClock, Timer, RefreshCw, Languages, Sparkles, Check, X } from "lucide-react"

type Script = {
  language: string
  content: string
  updated_at: string
  updated_by: string
}

type Suggestion = {
  id: string
  channel: string
  short_guideline: string
  situation: string
  risk: string
  source_summary: string
  status: string
  applied_to: string[]
  created_at: string
}

const RISK_COLOR: Record<string, string> = { low: "#2dd4a0", medium: "#f7b731", high: "#f87171" }

// ONE SCRIPT MODE — a single base script drives every language. Priya
// automatically replies in English, Roman-script Hinglish, or Tenglish
// depending on what the customer speaks (language rules live in code).
const LANG_LABELS: Record<string, { label: string; short: string; desc: string }> = {
  base: { label: "Universal Script", short: "ALL", desc: "One script for all languages — Priya auto-switches between English, Hinglish, and Tenglish" },
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
  const [selected, setSelected]   = useState<string>("base")
  const [content, setContent]     = useState<string>("")
  const [original, setOriginal]   = useState<string>("")
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [resetting, setResetting] = useState(false)
  const [msg, setMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [charCount, setCharCount] = useState(0)

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [ptLoading, setPtLoading]     = useState(true)
  const [generating, setGenerating]   = useState(false)
  const [actingId, setActingId]       = useState<string | null>(null)
  const [ptMsg, setPtMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null)

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

  async function loadSuggestions() {
    setPtLoading(true)
    try {
      const res = await fetch("/api/prompt-tuner?status=pending")
      if (res.ok) {
        const d = await res.json()
        setSuggestions(d.suggestions || [])
      }
    } catch {}
    setPtLoading(false)
  }

  useEffect(() => { loadSuggestions() }, [])

  async function generateNow() {
    setGenerating(true)
    setPtMsg(null)
    try {
      const res = await fetch("/api/prompt-tuner/generate", { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        setPtMsg({ type: "ok", text: d.generated > 0 ? `Found ${d.generated} new suggestion(s) below.` : "No repeated patterns found across recent calls — nothing to suggest right now." })
        await loadSuggestions()
      } else {
        setPtMsg({ type: "err", text: d.error || "Generation failed" })
      }
    } catch {
      setPtMsg({ type: "err", text: "Generation failed — check the server is running" })
    }
    setGenerating(false)
  }

  async function approveSuggestion(id: string) {
    setActingId(id)
    try {
      const res = await fetch(`/api/prompt-tuner/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      })
      if (res.ok) {
        setPtMsg({ type: "ok", text: "Added to the script." })
        await loadSuggestions()
        // Only pull the freshly-updated script text into the editor if there's
        // no unsaved edit sitting in the textarea — never silently discard one.
        if (content === original) await load()
      } else {
        const d = await res.json().catch(() => ({}))
        setPtMsg({ type: "err", text: d.error || "Could not approve" })
      }
    } catch {
      setPtMsg({ type: "err", text: "Could not approve — try again" })
    }
    setActingId(null)
  }

  async function rejectSuggestion(id: string) {
    setActingId(id)
    try {
      const res = await fetch(`/api/prompt-tuner/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      })
      if (res.ok) await loadSuggestions()
      else { const d = await res.json().catch(() => ({})); setPtMsg({ type: "err", text: d.error || "Could not reject" }) }
    } catch {
      setPtMsg({ type: "err", text: "Could not reject — try again" })
    }
    setActingId(null)
  }

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
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        {["base"].map(lang => {
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

      {/* Prompt Tuner — background-generated script suggestions, human-reviewed */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(139,124,255,0.13)", border: "1px solid rgba(139,124,255,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#a5b0ff" }}>
              <Sparkles size={15} strokeWidth={1.9} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Prompt Tuner</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Reads recent calls weekly for repeated friction — nothing reaches Priya's real script without your approval
              </div>
            </div>
          </div>
          <button onClick={generateNow} disabled={generating} className="btn-ghost" style={{ height: 34 }}>
            <Sparkles size={13} strokeWidth={1.9} /> {generating ? "Analyzing recent calls…" : "Generate Suggestions Now"}
          </button>
        </div>

        {ptMsg && (
          <div style={{
            margin: "12px 20px 0", padding: "10px 16px", borderRadius: 8,
            background: ptMsg.type === "ok" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${ptMsg.type === "ok" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            color: ptMsg.type === "ok" ? "#4ade80" : "#f87171", fontSize: 13, fontWeight: 500,
          }}>
            {ptMsg.text}
          </div>
        )}

        <div style={{ padding: 20 }}>
          {ptLoading && <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, padding: 20 }}>Loading suggestions…</div>}
          {!ptLoading && suggestions.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, padding: 20 }}>
              No pending suggestions. Click "Generate Suggestions Now" or wait for Sunday's automatic scan.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {suggestions.map((s) => (
              <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16, background: "var(--bg-secondary)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{s.short_guideline}</div>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
                    color: RISK_COLOR[s.risk] || "#94a3b8", background: `${RISK_COLOR[s.risk] || "#94a3b8"}1f`,
                    border: `1px solid ${RISK_COLOR[s.risk] || "#94a3b8"}44`, borderRadius: 6, padding: "2px 8px", flexShrink: 0,
                  }}>{s.risk} risk</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                  <strong style={{ color: "var(--text-secondary)" }}>When:</strong> {s.situation}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12 }}>
                  <strong style={{ color: "var(--text-secondary)" }}>Why:</strong> {s.source_summary} · <span style={{ textTransform: "capitalize" }}>{s.channel}</span> · {timeAgo(s.created_at)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Applies to the universal script (all languages)</div>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => rejectSuggestion(s.id)}
                    disabled={actingId === s.id}
                    className="btn-ghost"
                    style={{ height: 30, fontSize: 12 }}
                  ><X size={12} strokeWidth={2} /> Dismiss</button>
                  <button
                    onClick={() => approveSuggestion(s.id)}
                    disabled={actingId === s.id}
                    className="btn-primary"
                    style={{ height: 30, fontSize: 12, padding: "0 14px" }}
                  ><Check size={12} strokeWidth={2.2} /> {actingId === s.id ? "Adding…" : "Add to Script"}</button>
                </div>
              </div>
            ))}
          </div>
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
                The exact instruction Priya follows on every call and WhatsApp chat — she auto-switches language to match the customer
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
