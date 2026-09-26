"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Lightbulb, Save, RotateCcw, CalendarClock, Timer, RefreshCw, Languages, Sparkles, Check, X, Phone, MessageSquare, Instagram, Info } from "lucide-react"
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

// Script Manager tabs — Base + the per-channel editable scripts
// (ai_scripts keys handled by lib/channel-scripts.ts).
type Tab = "base" | "voice" | "whatsapp" | "instagram"

const TABS: { id: Tab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "base", label: "Base Script", icon: <Languages size={14} strokeWidth={2} />, desc: "Priya's core persona, rules & qualification flow (all channels)" },
  { id: "voice", label: "Voice Calls", icon: <Phone size={14} strokeWidth={2} />, desc: "Spoken openers & closings for Phone + WhatsApp calls (English, Hindi, Telugu)" },
  { id: "whatsapp", label: "WhatsApp Fallbacks", icon: <MessageSquare size={14} strokeWidth={2} />, desc: "Free-form texts sent when a Meta template isn't approved yet (24h window)" },
  { id: "instagram", label: "Instagram", icon: <Instagram size={14} strokeWidth={2} />, desc: "DM persona & public comment reply prompts" },
]

const VOICE_LANGS: { id: "english" | "hindi" | "telugu"; label: string }[] = [
  { id: "english", label: "English" },
  { id: "hindi", label: "Hindi" },
  { id: "telugu", label: "Telugu" },
]

// ai_scripts keys edited by each tab (a tab may edit more than one row).
const TAB_KEYS: Record<Tab, string[]> = {
  base: ["base"],
  voice: ["voice_openers", "voice_closings"],
  whatsapp: ["whatsapp_fallbacks"],
  instagram: ["instagram_dm", "instagram_comment"],
}

const OPENER_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "cold", label: "Cold opener (first call)", hint: "Spoken when Priya dials a brand-new lead" },
  { key: "coldWithName", label: "Cold opener (name known)", hint: "Used when the lead's name is already in the system — {name} is replaced" },
  { key: "returning", label: "Returning opener (repeat call)", hint: "Repeat calls — warm follow-up instead of the cold pitch" },
  { key: "returningWithName", label: "Returning opener (name known)", hint: "Repeat call + name known — {name} is replaced" },
  { key: "inbound", label: "Inbound opener (they called us)", hint: "Customer dialed our number — receptionist tone" },
  { key: "inboundWithName", label: "Inbound opener (name known)", hint: "Inbound call + name known — {name} is replaced" },
  { key: "whatsappCallback", label: "WhatsApp callback opener", hint: "Business-initiated WhatsApp call to someone who messaged us first" },
  { key: "whatsappCallbackWithName", label: "WhatsApp callback opener (name known)", hint: "WhatsApp callback + name known — {name} is replaced" },
]

const CLOSING_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "qualified", label: "Qualified closing", hint: "Spoken when the lead is complete — promises the form link on WhatsApp" },
  { key: "goodbye", label: "Goodbye sign-off", hint: "Spoken when the CUSTOMER says bye — call ends right after" },
  { key: "retry", label: "Technical retry line", hint: "Spoken when one LLM turn fails — asks them to repeat" },
  { key: "rateLimit", label: "Rate-limit ending", hint: "Spoken when the AI backend is out of capacity — ends the call politely" },
]

const WA_FALLBACK_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "formLink", label: "Loan form link message", hint: "Placeholders: {name} {brand} {link}" },
  { key: "callFollowup", label: "Post-call follow-up", hint: "Placeholders: {name} {brand}" },
  { key: "missedCall", label: "Missed-call follow-up", hint: "Placeholders: {name} {brand}" },
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

// Deep-merge plain objects (defaults under, saved row over). Arrays and
// non-objects are replaced wholesale — channel script rows are plain objects.
function deepMerge<T>(base: T, over: unknown): T {
  if (over === null || over === undefined) return base
  if (typeof base !== "object" || base === null || Array.isArray(base)) return (over as T) ?? base
  if (typeof over !== "object" || Array.isArray(over)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v
  }
  return out as T
}

type LangRecord = Record<string, string>
type VoiceOpenersObj = Record<string, LangRecord>
type VoiceClosingsObj = Record<string, LangRecord>
type WaFallbacksObj = Record<string, string>
type IgCommentObj = { publicReply: string; privateDm: string }
type DefaultsMap = Record<string, unknown>

function asLangRecord(v: unknown): LangRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as LangRecord) : {}
}

function strField(v: unknown): string {
  return typeof v === "string" ? v : ""
}

export default function ScriptView() {
  const [tab, setTab] = useState<Tab>("base")
  const [scripts, setScripts]   = useState<Script[]>([])
  const [defaults, setDefaults] = useState<DefaultsMap>({})
  const [selected, setSelected] = useState<string>("base")
  const [content, setContent]   = useState<string>("")
  const [original, setOriginal] = useState<string>("")
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [resetting, setResetting] = useState(false)
  const [msg, setMsg]           = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [charCount, setCharCount] = useState(0)

  // ---- channel-script editor state (typed by tab) ----
  const [voiceLang, setVoiceLang] = useState<"english" | "hindi" | "telugu">("english")
  const [voiceOpeners, setVoiceOpeners]     = useState<VoiceOpenersObj>({})
  const [voiceClosings, setVoiceClosings]   = useState<VoiceClosingsObj>({})
  const [waFallbacks, setWaFallbacks]       = useState<WaFallbacksObj>({})
  const [igDm, setIgDm]                     = useState<string>("")
  const [igComment, setIgComment]           = useState<IgCommentObj>({ publicReply: "", privateDm: "" })
  // pristine copies for dirty-checking, per tab
  const [pristine, setPristine] = useState<Record<string, string>>({})

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [ptLoading, setPtLoading]     = useState(true)
  const [generating, setGenerating]   = useState(false)
  const [actingId, setActingId]       = useState<string | null>(null)
  const [ptMsg, setPtMsg]             = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const rowFor = useCallback((key: string) => scripts.find((s) => s.language === key), [scripts])

  const hydrate = useCallback((rows: Script[], defs: DefaultsMap) => {
    // Base editor state
    const baseRow = rows.find((s) => s.language === "base")
    if (baseRow) {
      setContent(baseRow.content)
      setOriginal(baseRow.content)
      setCharCount(baseRow.content.length)
    }
    // Voice tab
    const vo = deepMerge(
      asLangRecord(defs.voice_openers) as unknown as VoiceOpenersObj,
      safeJsonParse(rows.find((s) => s.language === "voice_openers")?.content) as VoiceOpenersObj | undefined
    )
    const vc = deepMerge(
      asLangRecord(defs.voice_closings) as unknown as VoiceClosingsObj,
      safeJsonParse(rows.find((s) => s.language === "voice_closings")?.content) as VoiceClosingsObj | undefined
    )
    setVoiceOpeners(vo)
    setVoiceClosings(vc)
    // WhatsApp tab
    const waf = deepMerge(
      asLangRecord(defs.whatsapp_fallbacks) as unknown as WaFallbacksObj,
      safeJsonParse(rows.find((s) => s.language === "whatsapp_fallbacks")?.content) as WaFallbacksObj | undefined
    )
    setWaFallbacks(waf)
    // Instagram tab
    setIgDm(typeof defs.instagram_dm === "string" ? (rows.find((s) => s.language === "instagram_dm")?.content ?? defs.instagram_dm) : "")
    const igDef = (typeof defs.instagram_comment === "object" && defs.instagram_comment !== null ? defs.instagram_comment : {}) as Partial<IgCommentObj>
    const igRow = safeJsonParse(rows.find((s) => s.language === "instagram_comment")?.content) as Partial<IgCommentObj> | undefined
    const effectiveIg: IgCommentObj = {
      publicReply: strField(igRow?.publicReply) || strField(igDef.publicReply),
      privateDm: strField(igRow?.privateDm) || strField(igDef.privateDm),
    }
    setIgComment(effectiveIg)
    // Pristine fingerprints per key
    setPristine({
      base: baseRow?.content ?? "",
      voice_openers: JSON.stringify(vo),
      voice_closings: JSON.stringify(vc),
      whatsapp_fallbacks: JSON.stringify(waf),
      instagram_dm: rows.find((s) => s.language === "instagram_dm")?.content ?? (typeof defs.instagram_dm === "string" ? defs.instagram_dm : ""),
      instagram_comment: JSON.stringify(effectiveIg),
    })
  }, [])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/script")
      const data = await res.json()
      if (res.ok && data.scripts) {
        const defs = data.defaults || {}
        setScripts(data.scripts)
        setDefaults(defs)
        hydrate(data.scripts, defs)
      }
    } catch {
      setMsg({ type: "err", text: "Could not load scripts. Check your database connection." })
    }
    setLoading(false)
  }

  function safeJsonParse(raw: string | undefined): unknown {
    if (!raw) return undefined
    try { return JSON.parse(raw) } catch { return undefined }
  }

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener("rag:refresh", handler)
    return () => window.removeEventListener("rag:refresh", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setMsg({ type: "err", text: "Could not reject — try again" })
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

  // ---- Channel-tab save/reset: one action covers every key on the tab ----

  async function saveTab(t: Tab) {
    setSaving(true)
    setMsg(null)
    try {
      const payload = tabPayload(t)
      for (const p of payload) {
        const res = await fetch("/api/script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setMsg({ type: "err", text: d.error || `Could not save ${p.language}` })
          setSaving(false)
          return
        }
      }
      setMsg({ type: "ok", text: "Saved! New lines go live on the next call/message (within 5 minutes)." })
      await load()
    } catch {
      setMsg({ type: "err", text: "Save failed. Please try again." })
    }
    setSaving(false)
  }

  function tabPayload(t: Tab): { language: string; content: string }[] {
    if (t === "voice") {
      return [
        { language: "voice_openers", content: JSON.stringify(voiceOpeners) },
        { language: "voice_closings", content: JSON.stringify(voiceClosings) },
      ]
    }
    if (t === "whatsapp") {
      return [{ language: "whatsapp_fallbacks", content: JSON.stringify(waFallbacks) }]
    }
    if (t === "instagram") {
      return [
        { language: "instagram_dm", content: igDm },
        { language: "instagram_comment", content: JSON.stringify(igComment) },
      ]
    }
    return [{ language: "base", content }]
  }

  async function resetTab(t: Tab) {
    const keys = TAB_KEYS[t]
    const label = TABS.find((x) => x.id === t)?.label || t
    if (!confirm(`Reset ALL ${label} scripts on this tab to the original defaults? Your changes will be lost.`)) return
    setResetting(true)
    setMsg(null)
    try {
      for (const key of keys) {
        const res = await fetch(`/api/script?language=${encodeURIComponent(key)}`, { method: "DELETE" })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setMsg({ type: "err", text: d.error || `Could not reset ${key}` })
          setResetting(false)
          return
        }
      }
      setMsg({ type: "ok", text: "Reset to defaults successfully." })
      await load()
    } catch {
      setMsg({ type: "err", text: "Reset failed. Please try again." })
    }
    setResetting(false)
  }

  const isDirtyBase = content !== original
  const isDirtyTab = useMemo(() => {
    const payload = tabPayload(tab)
    if (tab === "base") return isDirtyBase
    return payload.some((p) => p.content !== pristine[p.language])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, content, original, voiceOpeners, voiceClosings, waFallbacks, igDm, igComment, pristine])

  const currentScript = scripts.find(s => s.language === selected)

  // ---- shared small UI atoms ----

  function Field({ label, hint, value, onChange, rows = 3 }: { label: string; hint?: string; value: string; onChange: (v: string) => void; rows?: number }) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-primary)" }}>{label}</div>
          {hint && <div style={{ fontSize: 10.5, color: "var(--text-muted)", textAlign: "right" }}>{hint}</div>}
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          rows={rows}
          style={{
            width: "100%", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            color: "var(--text-primary)", padding: "10px 12px", fontSize: 12.5, fontFamily: "monospace",
            lineHeight: 1.6, resize: "vertical",
          }}
        />
      </div>
    )
  }

  function sectionUpdated(key: string) {
    const row = rowFor(key)
    if (!row) return null
    return (
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
        customized · {timeAgo(row.updated_at)} by {row.updated_by}
      </span>
    )
  }

  function renderVoiceTab() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Language selector */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {VOICE_LANGS.map((l) => (
            <button
              key={l.id}
              onClick={() => setVoiceLang(l.id)}
              className={voiceLang === l.id ? "btn-primary" : "btn-ghost"}
              style={{ height: 30, fontSize: 12, padding: "0 14px" }}
            >{l.label}</button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
            <Info size={12} strokeWidth={1.8} /> Telugu/Hindi lines are spoken by the NATIVE voice — keep native script, English words in English letters
          </span>
        </div>

        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2, color: "var(--accent-violet)" }}>Openers — the first words on the call</div>
          {sectionUpdated("voice_openers")}
        </div>
        {OPENER_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            hint={f.hint}
            rows={3}
            value={(voiceOpeners[f.key] || {})[voiceLang] || ""}
            onChange={(v) => setVoiceOpeners((prev) => ({ ...prev, [f.key]: { ...(prev[f.key] || {}), [voiceLang]: v } }))}
          />
        ))}

        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2, color: "var(--accent-violet)" }}>Closings &amp; recovery lines</div>
          {sectionUpdated("voice_closings")}
        </div>
        {CLOSING_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            hint={f.hint}
            rows={3}
            value={(voiceClosings[f.key] || {})[voiceLang] || ""}
            onChange={(v) => setVoiceClosings((prev) => ({ ...prev, [f.key]: { ...(prev[f.key] || {}), [voiceLang]: v } }))}
          />
        ))}
      </div>
    )
  }

  function renderWhatsAppTab() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "var(--text-secondary)" }}>
          These FREE-FORM texts are sent when the matching approved Meta template fails with a definitive rejection and the customer messaged us within the last 24 hours. The approved template NAMES stay in <code>.env</code> (WHATSAPP_FORM_TEMPLATE etc.) — Meta reviews template copy there, this page only controls the fallback copy.
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2, color: "var(--accent-violet)" }}>Fallback texts</div>
          {sectionUpdated("whatsapp_fallbacks")}
        </div>
        {WA_FALLBACK_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            hint={f.hint}
            rows={4}
            value={waFallbacks[f.key] || ""}
            onChange={(v) => setWaFallbacks((prev) => ({ ...prev, [f.key]: v }))}
          />
        ))}
      </div>
    )
  }

  function renderInstagramTab() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2, color: "var(--accent-violet)" }}>DM system prompt</div>
          {sectionUpdated("instagram_dm")}
        </div>
        <Field
          label="Direct Message persona & rules"
          hint="Placeholders: {brief} {kbContext} {rateInfo} {emiInfo} {dtInfo}"
          rows={12}
          value={igDm}
          onChange={setIgDm}
        />
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2, color: "var(--accent-violet)" }}>Public comment reply &amp; private DM opener</div>
          {sectionUpdated("instagram_comment")}
        </div>
        <Field
          label="Public comment reply prompt"
          hint="Placeholders: {username} {kbContext}"
          rows={7}
          value={igComment.publicReply || ""}
          onChange={(v) => setIgComment((prev) => ({ ...prev, publicReply: v }))}
        />
        <Field
          label="Private DM text sent to commenters"
          hint="Placeholder: {username}"
          rows={4}
          value={igComment.privateDm || ""}
          onChange={(v) => setIgComment((prev) => ({ ...prev, privateDm: v }))}
        />
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const active = tab === t.id
          const dirty = isDirtyTabFor(t.id)
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setMsg(null) }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px",
                borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
                background: active ? "var(--gradient-brand)" : "var(--bg-card)",
                color: active ? "#fff" : "var(--text-secondary)",
                border: active ? "none" : "1px solid var(--border)",
              }}
            >
              {t.icon} {t.label}{dirty && <span style={{ width: 7, height: 7, borderRadius: 99, background: active ? "#fff" : "var(--accent-yellow)", display: "inline-block" }} />}
            </button>
          )
        })}
      </div>

      {/* Tab description */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -10 }}>
        {TABS.find((t) => t.id === tab)?.desc}
      </div>

      {/* Header cards (base tab only) */}
      {tab === "base" && (
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
                    background: selected === lang ? "var(--gradient-brand)" : "var(--overlay-hover)",
                    color: selected === lang ? "#fff" : "var(--text-secondary)",
                    border: selected === lang ? "none" : "1px solid var(--border)",
                  }}>{meta.short}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: selected === lang ? "var(--accent-violet)" : "var(--text-primary)" }}>{meta.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{meta.desc}</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Last updated: {sc ? `${timeAgo(sc.updated_at)} (${formatDateTime(sc.updated_at)})` : "—"}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                  {sc ? `${sc.content.length.toLocaleString()} characters` : "—"}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Tips box (base tab only) */}
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

      {/* Prompt Tuner — background-generated script suggestions, human-reviewed (base tab only) */}
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
      )}

      {/* Editor (base tab) */}
      {tab === "base" && (
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>

        {/* Editor topbar */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-secondary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(139,124,255,0.13)", border: "1px solid rgba(139,124,255,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-violet)" }}>
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
            {isDirtyBase && (
              <span style={{ fontSize: 12, color: "var(--accent-yellow)", fontWeight: 600 }}>● Unsaved changes</span>
            )}
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{charCount.toLocaleString()} chars</span>
            <button onClick={resetToDefault} disabled={resetting} className="btn-ghost" style={{ height: 34 }}>
              <RotateCcw size={13} strokeWidth={1.9} /> {resetting ? "Resetting…" : "Reset to Default"}
            </button>
            <button
              onClick={save}
              disabled={saving || !isDirtyBase}
              className={isDirtyBase ? "btn-primary" : "btn-ghost"}
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
            color: msg.type === "ok" ? "var(--accent-green)" : "var(--accent-red)",
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
          )}
        </div>

        {/* Footer info */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 24, fontSize: 12, color: "var(--text-muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CalendarClock size={12.5} strokeWidth={1.8} /> Last saved: {currentScript ? `${timeAgo(currentScript.updated_at)} (${formatDateTime(currentScript.updated_at)})` : "never"}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Timer size={12.5} strokeWidth={1.8} /> Changes take effect within 5 minutes</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><RefreshCw size={12.5} strokeWidth={1.8} /> Priya checks for updates automatically</span>
        </div>
      </div>
      )}

      {/* Channel-tab editor (voice / whatsapp / instagram) */}
      {tab !== "base" && (
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-secondary)", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(139,124,255,0.13)", border: "1px solid rgba(139,124,255,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-violet)" }}>
              {TABS.find((t) => t.id === tab)?.icon}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{TABS.find((t) => t.id === tab)?.label}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{TABS.find((t) => t.id === tab)?.desc}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isDirtyTab && (
              <span style={{ fontSize: 12, color: "var(--accent-yellow)", fontWeight: 600 }}>● Unsaved changes</span>
            )}
            <button onClick={() => resetTab(tab)} disabled={resetting} className="btn-ghost" style={{ height: 34 }}>
              <RotateCcw size={13} strokeWidth={1.9} /> {resetting ? "Resetting…" : "Reset Tab to Default"}
            </button>
            <button
              onClick={() => saveTab(tab)}
              disabled={saving || loading || !isDirtyTab}
              className={isDirtyTab ? "btn-primary" : "btn-ghost"}
              style={{ height: 34, padding: "0 18px" }}
            >
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
            <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading scripts…</div>
          ) : (
            <>
              {tab === "voice" && renderVoiceTab()}
              {tab === "whatsapp" && renderWhatsAppTab()}
              {tab === "instagram" && renderInstagramTab()}
            </>
          )}
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 24, fontSize: 12, color: "var(--text-muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Timer size={12.5} strokeWidth={1.8} /> Changes take effect within 5 minutes</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><RefreshCw size={12.5} strokeWidth={1.8} /> Priya checks for updates automatically</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Info size={12.5} strokeWidth={1.8} /> Empty fields fall back to the built-in defaults</span>
        </div>
      </div>
      )}
    </div>
  )

  function isDirtyTabFor(t: Tab): boolean {
    if (t === "base") return content !== original
    const payload = tabPayload(t)
    return payload.some((p) => p.content !== pristine[p.language])
  }
}
