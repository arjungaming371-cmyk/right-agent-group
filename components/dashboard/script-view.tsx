"use client"
import { useEffect, useState } from "react"
import { Lightbulb, Save, RotateCcw, CalendarClock, Timer, RefreshCw, Languages, Sparkles, Check, X, Phone, MessageCircle, Instagram, ScrollText, Info } from "lucide-react"
import { formatDateTime } from "@/lib/utils"

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

const RISK_COLOR: Record<string, string> = { low: "var(--accent-green)", medium: "var(--accent-yellow)", high: "var(--accent-red)" }

// ONE SCRIPT MODE — a single base script drives every language. Priya
// automatically replies in English, Roman-script Hinglish, or Tenglish
// depending on what the customer speaks (language rules live in code).
const LANG_LABELS: Record<string, { label: string; short: string; desc: string }> = {
  base: { label: "Universal Script", short: "ALL", desc: "One script for all languages — Priya auto-switches between English, Hinglish, and Tenglish" },
}

// ── Tabbed omnichannel editor (2026-09-26) ────────────────────────────────
// Tab 1 edits the ai_scripts 'base' row. Tabs 2-4 edit the JSON surfaces
// ('voice_openers', 'voice_closings', 'whatsapp_fallbacks',
// 'instagram_dm'/'instagram_comment'); each tab shows the SAVED row when one
// exists and the shipped defaults otherwise, with its own Save + Reset.
type TabId = "base" | "voice" | "whatsapp" | "instagram"

const TABS: { id: TabId; label: string; short: string; desc: string; icon: any; color: string }[] = [
  { id: "base", label: "Universal Script", short: "ALL", desc: "The one script behind every call and chat", icon: ScrollText, color: "var(--accent-violet)" },
  { id: "voice", label: "Voice Call Lines", short: "CALL", desc: "Openers + closings Priya speaks on phone & WhatsApp calls", icon: Phone, color: "var(--accent-cyan)" },
  { id: "whatsapp", label: "WhatsApp Templates", short: "WA", desc: "Fallback texts sent when Meta templates aren't approved yet", icon: MessageCircle, color: "var(--accent-green)" },
  { id: "instagram", label: "Instagram Prompts", short: "IG", desc: "DM persona, comment replies, first-touch DM", icon: Instagram, color: "var(--accent-yellow)" },
]

type SectionDef = { key: string; label: string; hint: string }

const OPENER_SECTIONS: SectionDef[] = [
  { key: "cold", label: "Cold call — name not known", hint: "First-ever outbound call to a fresh lead" },
  { key: "cold_named", label: "Cold call — name known", hint: "Use {name} where the lead's name is spoken" },
  { key: "returning", label: "Repeat call — name not known", hint: "Second+ attempt on the same lead" },
  { key: "returning_named", label: "Repeat call — name known", hint: "Warm follow-up; supports {name}" },
  { key: "inbound", label: "Inbound call — name not known", hint: "They called us — receptionist, not pitch" },
  { key: "inbound_named", label: "Inbound call — name known", hint: "Supports {name}" },
]

const CLOSING_SECTIONS: SectionDef[] = [
  { key: "qualified", label: "Qualified — link closing", hint: "Spoken when the application link is sent" },
  { key: "sign_off", label: "Customer goodbye sign-off", hint: "Spoken when the CUSTOMER says bye first" },
]

const WA_SECTIONS: SectionDef[] = [
  { key: "form_link", label: "Application form link", hint: "Sent when the template isn't approved yet. Tokens: {name} {brand} {link}" },
  { key: "call_followup", label: "Post-call follow-up", hint: "After any completed call. Tokens: {name} {brand}" },
  { key: "missed_call", label: "Missed-call follow-up", hint: "After busy / no-answer. Tokens: {name} {brand}" },
]

const IG_DM_SECTIONS: SectionDef[] = [
  { key: "system_prompt", label: "DM persona", hint: "Who Priya is in Instagram DMs" },
  { key: "reply_rules", label: "DM reply rules", hint: "Length and behaviour rules appended to every DM turn" },
]

const IG_COMMENT_SECTIONS: SectionDef[] = [
  { key: "system_prompt", label: "Comment reply persona", hint: "Public reply on post comments. Supports {username}" },
  { key: "reply_rules", label: "Comment reply rules", hint: "Length / behaviour of the public reply" },
  { key: "first_dm", label: "First DM to commenter", hint: "Private DM sent after a public reply. Supports {username}" },
]

const LANG_COLS: { key: string; label: string }[] = [
  { key: "english", label: "English" },
  { key: "hindi", label: "Hindi (Devanagari)" },
  { key: "telugu", label: "Telugu" },
]

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

function parseJsonSafe(content: string | undefined, fallback: string): Record<string, any> {
  const src = content && content.trim() ? content : fallback
  try {
    const parsed = JSON.parse(src)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : JSON.parse(fallback)
  } catch {
    try { return JSON.parse(fallback) } catch { return {} }
  }
}

export default function ScriptView() {
  const [scripts, setScripts]       = useState<Script[]>([])
  const [defaults, setDefaults]     = useState<Record<string, string>>({})
  const [tab, setTab]               = useState<TabId>("base")
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [resetting, setResetting]   = useState(false)
  const [msg, setMsg]               = useState<{ type: "ok" | "err"; text: string } | null>(null)

  // Base tab editor state
  const [selected, setSelected]     = useState<string>("base")
  const [content, setContent]       = useState<string>("")
  const [original, setOriginal]     = useState<string>("")

  // JSON tab state: current edit values + snapshot of what's saved (or default)
  const [voiceOpeners, setVoiceOpeners]     = useState<Record<string, any>>({})
  const [voiceClosings, setVoiceClosings]   = useState<Record<string, any>>({})
  const [waFallbacks, setWaFallbacks]       = useState<Record<string, any>>({})
  const [igDm, setIgDm]                     = useState<Record<string, any>>({})
  const [igComment, setIgComment]           = useState<Record<string, any>>({})
  const [saved, setSaved]                   = useState<Record<string, string>>({})

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [ptLoading, setPtLoading]     = useState(true)
  const [generating, setGenerating]   = useState(false)
  const [actingId, setActingId]       = useState<string | null>(null)
  const [ptMsg, setPtMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null)

  function applyLoaded(rows: Script[], defs: Record<string, string>) {
    setScripts(rows)
    setDefaults(defs)
    const savedMap: Record<string, string> = {}
    for (const s of rows) savedMap[s.language] = s.content
    setSaved(savedMap)
    const baseRow = rows.find((s) => s.language === "base")
    if (baseRow) { setContent(baseRow.content); setOriginal(baseRow.content) }
    setVoiceOpeners(parseJsonSafe(savedMap.voice_openers, defs.voice_openers))
    setVoiceClosings(parseJsonSafe(savedMap.voice_closings, defs.voice_closings))
    setWaFallbacks(parseJsonSafe(savedMap.whatsapp_fallbacks, defs.whatsapp_fallbacks))
    setIgDm(parseJsonSafe(savedMap.instagram_dm, defs.instagram_dm))
    setIgComment(parseJsonSafe(savedMap.instagram_comment, defs.instagram_comment))
  }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/script")
      const data = await res.json()
      if (res.ok && data.scripts) applyLoaded(data.scripts, data.defaults || {})
      else setMsg({ type: "err", text: "Could not load scripts. Check your database connection." })
    } catch {
      setMsg({ type: "err", text: "Could not load scripts. Check your database connection." })
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener("rag:refresh", handler)
    return () => window.removeEventListener("rag:refresh", handler)
  }, [])

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

  // ── Save / Reset per tab ────────────────────────────────────────────────
  const baseDirty = content !== original
  const voiceDirty = JSON.stringify(voiceOpeners) !== JSON.stringify(parseJsonSafe(saved.voice_openers, defaults.voice_openers)) ||
    JSON.stringify(voiceClosings) !== JSON.stringify(parseJsonSafe(saved.voice_closings, defaults.voice_closings))
  const waDirty = JSON.stringify(waFallbacks) !== JSON.stringify(parseJsonSafe(saved.whatsapp_fallbacks, defaults.whatsapp_fallbacks))
  const igDirty = JSON.stringify(igDm) !== JSON.stringify(parseJsonSafe(saved.instagram_dm, defaults.instagram_dm)) ||
    JSON.stringify(igComment) !== JSON.stringify(parseJsonSafe(saved.instagram_comment, defaults.instagram_comment))
  const tabDirty = tab === "base" ? baseDirty : tab === "voice" ? voiceDirty : tab === "whatsapp" ? waDirty : igDirty

  async function saveKey(language: string, payload: unknown) {
    const res = await fetch("/api/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, content: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || "Save failed")
    }
  }

  async function save() {
    setSaving(true)
    setMsg(null)
    try {
      if (tab === "base") {
        if (!content.trim()) { setSaving(false); return }
        await saveKey("base", content)
        setOriginal(content)
        setMsg({ type: "ok", text: "Script saved! Priya will use this on the next call (within 5 minutes)." })
      } else if (tab === "voice") {
        await saveKey("voice_openers", voiceOpeners)
        await saveKey("voice_closings", voiceClosings)
        setMsg({ type: "ok", text: "Voice lines saved! Priya speaks them from the next call (within 5 minutes)." })
      } else if (tab === "whatsapp") {
        await saveKey("whatsapp_fallbacks", waFallbacks)
        setMsg({ type: "ok", text: "WhatsApp templates saved! Used on the next fallback send (within 5 minutes)." })
      } else {
        await saveKey("instagram_dm", igDm)
        await saveKey("instagram_comment", igComment)
        setMsg({ type: "ok", text: "Instagram prompts saved! Applied from the next DM/comment (within 5 minutes)." })
      }
      await load()
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Save failed. Please try again." })
    }
    setSaving(false)
  }

  async function resetToDefault() {
    const keys = tab === "base" ? ["base"]
      : tab === "voice" ? ["voice_openers", "voice_closings"]
      : tab === "whatsapp" ? ["whatsapp_fallbacks"]
      : ["instagram_dm", "instagram_comment"]
    if (!confirm(`Reset the ${TABS.find((t) => t.id === tab)?.label} to the original default? Your changes will be lost.`)) return
    setResetting(true)
    setMsg(null)
    try {
      for (const k of keys) {
        const res = await fetch(`/api/script?language=${k}`, { method: "DELETE" })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || "Reset failed")
        }
      }
      setMsg({ type: "ok", text: "Reset to default successfully." })
      await load()
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Reset failed. Please try again." })
    }
    setResetting(false)
  }

  // ── Shared renderers ────────────────────────────────────────────────────
  function SectionGrid({ sections, value, onChange, langs }: {
    sections: SectionDef[]
    value: Record<string, any>
    onChange: (path: string, lang: string | null, text: string) => void
    langs?: boolean
  }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {sections.map((s) => (
          <div key={s.key}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 7 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--text-primary)" }}>{s.label}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{s.hint}</div>
            </div>
            {langs ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {LANG_COLS.map((c) => (
                  <div key={c.key}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>{c.label}</div>
                    <textarea
                      value={(value?.[s.key]?.[c.key] as string) || ""}
                      onChange={(e) => onChange(s.key, c.key, e.target.value)}
                      spellCheck={false}
                      rows={3}
                      style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", padding: 10, fontSize: 12.5, lineHeight: 1.55, resize: "vertical" }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <textarea
                value={(value?.[s.key] as string) || ""}
                onChange={(e) => onChange(s.key, null, e.target.value)}
                spellCheck={false}
                rows={2}
                style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", padding: 10, fontSize: 12.5, lineHeight: 1.55, resize: "vertical" }}
              />
            )}
          </div>
        ))}
      </div>
    )
  }

  function setNested(state: Record<string, any>, setState: (v: Record<string, any>) => void, key: string, lang: string | null, text: string) {
    if (lang) {
      setState({ ...state, [key]: { ...(state[key] || {}), [lang]: text } })
    } else {
      setState({ ...state, [key]: text })
    }
  }

  const lastSavedRow = scripts.filter((s) => (tab === "base" ? ["base"] : tab === "voice" ? ["voice_openers", "voice_closings"] : tab === "whatsapp" ? ["whatsapp_fallbacks"] : ["instagram_dm", "instagram_comment"]).includes(s.language))
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0]

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Tab bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {TABS.map((t) => {
          const active = tab === t.id
          const Icon = t.icon
          return (
            <div
              key={t.id}
              onClick={() => { setTab(t.id); setMsg(null) }}
              style={{
                background: active ? "linear-gradient(135deg, rgba(139,124,255,0.1), rgba(56,189,248,0.04))" : "var(--bg-card)",
                border: `1.5px solid ${active ? "rgba(139,124,255,0.5)" : "var(--border)"}`,
                borderRadius: 13, padding: 16, cursor: "pointer", transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{
                  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: active ? "var(--gradient-brand)" : `${t.color}1a`,
                  color: active ? "#fff" : t.color, border: active ? "none" : `1px solid ${t.color}30`,
                }}><Icon size={15} strokeWidth={2} /></span>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: active ? "var(--accent-violet)" : "var(--text-primary)" }}>{t.label}</div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.desc}</div>
            </div>
          )
        })}
      </div>

      {/* Tips (base tab only) */}
      {tab === "base" && (
        <div style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, padding: "14px 20px" }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: "var(--accent-blue)", display: "flex", alignItems: "center", gap: 6 }}><Lightbulb size={14} strokeWidth={2} /> How to write a good script</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px" }}>
            {TIPS.map((t, i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "2px 0", display: "flex", gap: 7, alignItems: "baseline" }}>
                <span style={{ color: i < 5 ? "var(--accent-green)" : "var(--accent-yellow)", flexShrink: 0 }}>•</span>{t}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt Tuner — applies to the universal script, so base tab only */}
      {tab === "base" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(139,124,255,0.13)", border: "1px solid rgba(139,124,255,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-violet)" }}>
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
              color: ptMsg.type === "ok" ? "var(--accent-green)" : "var(--accent-red)", fontSize: 13, fontWeight: 500,
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
                      color: RISK_COLOR[s.risk] || "var(--text-secondary)", background: `${RISK_COLOR[s.risk] || "var(--text-secondary)"}1f`,
                      border: `1px solid ${RISK_COLOR[s.risk] || "var(--text-secondary)"}44`, borderRadius: 6, padding: "2px 8px", flexShrink: 0,
                    }}>{s.risk} risk</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                    <strong style={{ color: "var(--text-secondary)" }}>When:</strong> {s.situation}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12 }}>
                    <strong style={{ color: "var(--text-secondary)" }}>Why:</strong> {s.source_summary} · <span style={{ textTransform: "capitalize" }}>{s.channel}</span> · {timeAgo(s.created_at)} · {formatDateTime(s.created_at)}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Applies to the universal script (all languages)</div>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => rejectSuggestion(s.id)} disabled={actingId === s.id} className="btn-ghost" style={{ height: 30, fontSize: 12 }}>
                      <X size={12} strokeWidth={2} /> Dismiss</button>
                    <button onClick={() => approveSuggestion(s.id)} disabled={actingId === s.id} className="btn-primary" style={{ height: 30, fontSize: 12, padding: "0 14px" }}>
                      <Check size={12} strokeWidth={2.2} /> {actingId === s.id ? "Adding…" : "Add to Script"}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Editor card */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-secondary)", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(139,124,255,0.13)", border: "1px solid rgba(139,124,255,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-violet)" }}>
              <Languages size={15} strokeWidth={1.9} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {tab === "base" ? "Priya's Script — Universal Script" : TABS.find((t) => t.id === tab)?.label}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {tab === "base" && "The exact instruction Priya follows on every call and WhatsApp chat — she auto-switches language to match the customer"}
                {tab === "voice" && "The fixed lines spoken before/after the AI conversation — edited per scenario and language"}
                {tab === "whatsapp" && "Free-form texts used only when the Meta template isn't approved (or the 24h window is open)"}
                {tab === "instagram" && "Persona + rules for DMs, public comment replies, and the private first-DM to commenters"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {tabDirty && <span style={{ fontSize: 12, color: "var(--accent-yellow)", fontWeight: 600 }}>● Unsaved changes</span>}
            <button onClick={resetToDefault} disabled={resetting} className="btn-ghost" style={{ height: 34 }}>
              <RotateCcw size={13} strokeWidth={1.9} /> {resetting ? "Resetting…" : "Reset to Default"}
            </button>
            <button onClick={save} disabled={saving || !tabDirty} className={tabDirty ? "btn-primary" : "btn-ghost"} style={{ height: 34, padding: "0 18px" }}>
              <Save size={13.5} strokeWidth={2} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {msg && (
          <div style={{
            margin: "12px 20px 0",
            padding: "10px 16px",
            borderRadius: 8,
            background: msg.type === "ok" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${msg.type === "ok" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            color: msg.type === "ok" ? "var(--accent-green)" : "var(--accent-red)",
            fontSize: 13, fontWeight: 500,
          }}>
            {msg.text}
          </div>
        )}

        <div style={{ padding: 20 }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading script…</div>
          ) : tab === "base" ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              style={{
                width: "100%",
                height: 480,
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                color: "var(--text-primary)",
                padding: 16,
                fontSize: 13,
                fontFamily: "monospace",
                lineHeight: 1.7,
                resize: "vertical",
              }}
            />
          ) : tab === "voice" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--text-muted)", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8, padding: "8px 12px" }}>
                <Info size={13} strokeWidth={2} style={{ flexShrink: 0, color: "var(--accent-blue)" }} />
                Spoken lines are TTS-read: write Hindi in Devanagari and Telugu in Telugu script (native voice), keep English loanwords in English letters — exactly as the defaults do.
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12, color: "var(--text-primary)", letterSpacing: "0.02em" }}>OPENERS — the first line of the call</div>
                <SectionGrid sections={OPENER_SECTIONS} value={voiceOpeners} langs onChange={(k, lang, text) => setNested(voiceOpeners, setVoiceOpeners, k, lang, text)} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12, color: "var(--text-primary)", letterSpacing: "0.02em" }}>CLOSINGS — how the call ends</div>
                <SectionGrid sections={CLOSING_SECTIONS} value={voiceClosings} langs onChange={(k, lang, text) => setNested(voiceClosings, setVoiceClosings, k, lang, text)} />
              </div>
            </div>
          ) : tab === "whatsapp" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--text-muted)", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8, padding: "8px 12px" }}>
                <Info size={13} strokeWidth={2} style={{ flexShrink: 0, color: "var(--accent-blue)" }} />
                These are FALLBACK texts — the approved Meta templates are what normally goes out. Keep {`{link}`} in the form-link template or it is appended automatically.
              </div>
              <SectionGrid sections={WA_SECTIONS} value={waFallbacks} onChange={(k, _lang, text) => setNested(waFallbacks, setWaFallbacks, k, null, text)} />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--text-muted)", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8, padding: "8px 12px" }}>
                <Info size={13} strokeWidth={2} style={{ flexShrink: 0, color: "var(--accent-blue)" }} />
                Use {`{username}`} where the commenter's handle should appear — it is replaced with the real handle at send time.
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12, color: "var(--text-primary)", letterSpacing: "0.02em" }}>DIRECT MESSAGES</div>
                <SectionGrid sections={IG_DM_SECTIONS} value={igDm} onChange={(k, _lang, text) => setNested(igDm, setIgDm, k, null, text)} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12, color: "var(--text-primary)", letterSpacing: "0.02em" }}>POST COMMENTS</div>
                <SectionGrid sections={IG_COMMENT_SECTIONS} value={igComment} onChange={(k, _lang, text) => setNested(igComment, setIgComment, k, null, text)} />
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarClock size={12.5} strokeWidth={1.8} /> Last saved: {lastSavedRow ? `${timeAgo(lastSavedRow.updated_at)} (${formatDateTime(lastSavedRow.updated_at)})` : "never"}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Timer size={12.5} strokeWidth={1.8} /> Changes take effect within 5 minutes</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><RefreshCw size={12.5} strokeWidth={1.8} /> Priya checks for updates automatically</span>
        </div>
      </div>
    </div>
  )
}
