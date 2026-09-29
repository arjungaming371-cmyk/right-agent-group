"use client"

// Voice Studio — browse, audition, and clone every voice the platform can
// speak with (Sarvam Bulbul presets, Cartesia account voices, local clones).
//
//   Library tab   — filterable voice cards with instant audition (▶) in any
//                   call language; clones carry a badge + delete (admin).
//   Clone Lab tab — upload or record a 10–60s sample, declare DPDP consent,
//                   clone via Cartesia (always available) or Sarvam (when the
//                   account key has it), hear the first result immediately.
//
// Previews burn provider credits, so the whole view is gated to the roles
// that manage AI Employees (admin / branch_manager / developer); cloning is
// admin/developer and the server enforces it again.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Play, Square, Mic, UploadCloud, Trash2, Volume2, Loader2, AudioWaveform,
  Fingerprint as CloneIcon, ShieldCheck, Search, RefreshCw,
} from "lucide-react"
import { useToast } from "../ui/toast"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
type VoiceProvider = "sarvam" | "cartesia"
type VoiceLanguage = "english" | "hindi" | "telugu"
type VoiceGender = "female" | "male" | "neutral"

type VoiceOption = {
  provider: VoiceProvider
  voiceId: string
  name: string
  gender: VoiceGender
  cloned: boolean
  description?: string
  origin: "preset" | "provider" | "custom"
  language?: VoiceLanguage
  consent?: { confirmed: boolean; note: string | null; by?: string | null }
  localId?: string
  createdAt?: string
}

type Catalog = {
  sarvam: VoiceOption[]
  cartesia: VoiceOption[]
  cartesiaError: string | null
  custom: VoiceOption[]
  keys: { sarvam: boolean; cartesia: boolean }
}

type LabTab = "library" | "clone"

const LANGS: { id: VoiceLanguage; label: string }[] = [
  { id: "telugu", label: "Telugu" },
  { id: "hindi", label: "Hindi" },
  { id: "english", label: "English" },
]

const GENDERS: { id: VoiceGender; label: string }[] = [
  { id: "female", label: "Female" },
  { id: "male", label: "Male" },
  { id: "neutral", label: "Neutral" },
]

// The mic prompt the Clone Lab shows while recording — a natural
// loan-advisor sentence covers the phonetic range cloners care about.
const RECORD_SCRIPT = "Namaskaram! This is Priya from Right Agent Group. I am calling about your home loan enquiry — our partner banks are offering interest rates starting at eight point two five percent. May I know a convenient time to talk?"

const inputCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-violet)]"

export default function VoiceStudioView({ role }: { role: Role }) {
  const toast = useToast()
  const canClone = role === "admin" || role === "developer"
  const canDelete = canClone

  const [tab, setTab] = useState<LabTab>("library")
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)

  // Library filters
  const [providerFilter, setProviderFilter] = useState<"all" | VoiceProvider | "custom">("all")
  const [genderFilter, setGenderFilter] = useState<"all" | VoiceGender>("all")
  const [search, setSearch] = useState("")
  const [previewLang, setPreviewLang] = useState<VoiceLanguage>("telugu")

  // Preview player — one audio element, blob URL per preview
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const blobRef = useRef<string | null>(null)

  // Clone Lab state
  const [cloneProvider, setCloneProvider] = useState<VoiceProvider>("sarvam")
  const [cloneName, setCloneName] = useState("")
  const [cloneGender, setCloneGender] = useState<VoiceGender>("female")
  const [cloneLang, setCloneLang] = useState<VoiceLanguage>("telugu")
  const [cloneDesc, setCloneDesc] = useState("")
  const [consent, setConsent] = useState(false)
  const [consentNote, setConsentNote] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [cloning, setCloning] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordSecs, setRecordSecs] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch("/api/voices")
      if (res.ok) setCatalog(await res.json())
    } catch { /* transient — retry on next refresh */ }
    if (!silent) setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const allVoices = useMemo<VoiceOption[]>(() => {
    if (!catalog) return []
    return [...catalog.custom, ...catalog.sarvam, ...catalog.cartesia]
  }, [catalog])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allVoices.filter((v) => {
      if (providerFilter === "custom" && v.origin !== "custom") return false
      if (providerFilter !== "all" && providerFilter !== "custom" && v.provider !== providerFilter) return false
      if (genderFilter !== "all" && v.gender !== genderFilter) return false
      if (q && !`${v.name} ${v.voiceId} ${v.description || ""}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [allVoices, providerFilter, genderFilter, search])

  const cloneCount = catalog?.custom.length ?? 0
  const counts = useMemo(() => ({
    total: allVoices.length,
    sarvam: catalog?.sarvam.length ?? 0,
    cartesia: catalog?.cartesia.length ?? 0,
    custom: cloneCount,
  }), [allVoices, catalog, cloneCount])

  // ---- Preview playback ------------------------------------------------
  function stopAudio() {
    audioRef.current?.pause()
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null }
    setPlayingKey(null)
  }

  async function previewVoice(v: VoiceOption) {
    const key = `${v.provider}:${v.voiceId}`
    if (playingKey === key) { stopAudio(); return }
    stopAudio()
    setPreviewLoading(key)
    try {
      const res = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: v.provider, voiceId: v.voiceId, language: previewLang }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || `Preview failed (HTTP ${res.status})`)
        return
      }
      const blob = await res.blob()
      blobRef.current = URL.createObjectURL(blob)
      const el = audioRef.current
      if (el) {
        el.src = blobRef.current
        el.onended = () => setPlayingKey(null)
        await el.play()
        setPlayingKey(key)
      }
    } catch {
      toast.error("Preview failed — check your connection")
    } finally {
      setPreviewLoading(null)
    }
  }

  // ---- Clone Lab: microphone -------------------------------------------
  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (timerRef.current) clearInterval(timerRef.current)
        setRecording(false)
        const ext = MediaRecorder.isTypeSupported("audio/webm") ? "webm" : "wav"
        const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" })
        setFile(new File([blob], `recording.${ext}`, { type: blob.type }))
        toast.info("Recording captured — review it and hit Clone Voice")
      }
      recorderRef.current = rec
      rec.start()
      setRecording(true)
      setRecordSecs(0)
      timerRef.current = setInterval(() => {
        setRecordSecs((s) => {
          if (s >= 59) { recorderRef.current?.stop(); return s }
          return s + 1
        })
      }, 1000)
    } catch {
      toast.error("Microphone unavailable — allow mic access or upload a file instead")
    }
  }

  // ---- Clone submit -----------------------------------------------------
  async function submitClone() {
    if (!file) { toast.error("Record or upload a voice sample first"); return }
    if (!cloneName.trim()) { toast.error("Give the voice a name"); return }
    if (!consent) { toast.error("Consent declaration is mandatory (DPDP Act 2023)"); return }
    setCloning(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("provider", cloneProvider)
      form.append("name", cloneName.trim())
      form.append("language", cloneLang)
      form.append("gender", cloneGender)
      if (cloneDesc.trim()) form.append("description", cloneDesc.trim())
      form.append("consent", "true")
      if (consentNote.trim()) form.append("consentNote", consentNote.trim())
      const res = await fetch("/api/voices/clone", { method: "POST", body: form })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || `Clone failed (HTTP ${res.status})`); return }
      toast.success(`Voice "${d.voice?.name || cloneName}" cloned${d.previewOk ? " — audition it in the Library" : ""}`)
      setFile(null); setCloneName(""); setCloneDesc(""); setConsent(false); setConsentNote("")
      setTab("library"); setProviderFilter("custom")
      await load(true)
    } catch {
      toast.error("Clone failed — check your connection and try again")
    } finally {
      setCloning(false)
    }
  }

  async function deleteVoice(v: VoiceOption) {
    if (!v.localId) return
    if (!confirm(`Delete cloned voice "${v.name}"? It is removed at the provider and hidden everywhere; history stays in the audit log.`)) return
    try {
      const res = await fetch(`/api/voices/${v.localId}`, { method: "DELETE" })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`Deleted${d.providerDelete === "failed" ? " locally (provider delete failed — remove it in the Cartesia console)" : ""}`)
        await load(true)
      } else toast.error(d.error || "Delete failed")
    } catch { toast.error("Delete failed — check your connection") }
  }

  const providerChip = (v: VoiceOption) =>
    v.provider === "sarvam"
      ? { label: "Sarvam AI", color: "var(--accent-violet)" }
      : { label: "Cartesia", color: "var(--accent-blue)" }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Hidden audio element drives every preview */}
      <audio ref={audioRef} style={{ display: "none" }} />

      {/* ── Header: tabs + counters ─────────────────────────────────── */}
      <div className="card" style={{ padding: "18px 22px", display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: "auto" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--gradient-brand)", display: "grid", placeItems: "center" }}>
            <AudioWaveform size={20} color="#fff" strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Voice Studio</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {counts.sarvam} Sarvam · {counts.cartesia} Cartesia · {counts.custom} clone{counts.custom === 1 ? "" : "s"} — audition any voice before it goes live on calls
            </div>
          </div>
        </div>
        {(["library", "clone"] as LabTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={t === "clone" && !canClone ? "btn-ghost" : tab === t ? "btn-primary" : "btn-ghost"}
            disabled={t === "clone" && !canClone}
            style={{ height: 36, opacity: t === "clone" && !canClone ? 0.45 : 1, cursor: t === "clone" && !canClone ? "not-allowed" : "pointer" }}
            title={t === "clone" && !canClone ? "Cloning is admin/developer only" : undefined}
          >
            {t === "library" ? <Volume2 size={14} strokeWidth={2} /> : <CloneIcon size={14} strokeWidth={2} />}
            {t === "library" ? "Library" : "Clone Lab"}
          </button>
        ))}
        <button onClick={() => load()} className="btn-ghost" style={{ height: 36 }} title="Refresh — Cartesia's list is cached for an hour">
          <RefreshCw size={14} strokeWidth={2} />
        </button>
      </div>

      {catalog?.cartesiaError && (
        <div style={{ fontSize: 12.5, color: "var(--accent-yellow)", background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", borderRadius: 10, padding: "10px 14px" }}>
          Cartesia list unavailable: {catalog.cartesiaError} — Sarvam presets and clones still work below.
        </div>
      )}

      {tab === "library" ? (
        <>
          {/* ── Filters ───────────────────────────────────────────────── */}
          <div className="card" style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
              {([["all", "All"], ["sarvam", "Sarvam AI"], ["cartesia", "Cartesia"], ["custom", "My Clones"]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setProviderFilter(id)}
                  style={{
                    padding: "5px 11px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    border: `1px solid ${providerFilter === id ? "rgba(139,124,255,0.5)" : "var(--border)"}`,
                    background: providerFilter === id ? "rgba(139,124,255,0.12)" : "transparent",
                    color: providerFilter === id ? "var(--accent-violet)" : "var(--text-secondary)",
                  }}>{label}</button>
              ))}
            </div>
            <div style={{ width: 1, height: 22, background: "var(--border)" }} />
            <select value={genderFilter} onChange={(e) => setGenderFilter(e.target.value as typeof genderFilter)} className={inputCls} style={{ width: 130 }}>
              <option value="all">All voices</option>
              {GENDERS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <div style={{ display: "inline-flex", gap: 6 }}>
              {LANGS.map((l) => (
                <button key={l.id} onClick={() => setPreviewLang(l.id)}
                  style={{
                    padding: "5px 11px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    border: `1px solid ${previewLang === l.id ? "rgba(34,197,94,0.45)" : "var(--border)"}`,
                    background: previewLang === l.id ? "rgba(34,197,94,0.1)" : "transparent",
                    color: previewLang === l.id ? "var(--accent-green)" : "var(--text-secondary)",
                  }}
                  title={`Audition in ${l.label}`}>{l.label}</button>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 160, position: "relative" }}>
              <Search size={13} strokeWidth={2} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search voices…" className={inputCls} style={{ paddingLeft: 30 }} />
            </div>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{filtered.length} voice{filtered.length === 1 ? "" : "s"}</span>
          </div>

          {/* ── Voice cards ───────────────────────────────────────────── */}
          {loading ? (
            <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading voice catalog…</div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              No voices match these filters — clear the search or switch provider.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
              {filtered.map((v) => {
                const pc = providerChip(v)
                const key = `${v.provider}:${v.voiceId}`
                const isPlaying = playingKey === key
                const isPreviewing = previewLoading === key
                return (
                  <div key={key} className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        onClick={() => previewVoice(v)}
                        disabled={!!previewLoading && !isPreviewing}
                        title={`Audition in ${previewLang}`}
                        style={{
                          width: 34, height: 34, borderRadius: 9, flexShrink: 0, cursor: "pointer",
                          display: "grid", placeItems: "center",
                          background: isPlaying ? "rgba(239,68,68,0.12)" : "var(--gradient-brand)",
                          border: `1px solid ${isPlaying ? "rgba(239,68,68,0.3)" : "transparent"}`,
                          color: isPlaying ? "var(--accent-red)" : "#fff",
                        }}
                      >
                        {isPreviewing ? <Loader2 size={15} className="animate-spin" />
                          : isPlaying ? <Square size={13} fill="currentColor" />
                          : <Play size={14} fill="currentColor" />}
                      </button>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {v.name}
                          {v.origin === "custom" && (
                            <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--accent-green)", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>CLONE</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          <span style={{ color: pc.color, fontWeight: 600 }}>{pc.label}</span>
                          {" · "}⌀ {v.gender}{v.language ? ` · ${v.language}` : ""}
                        </div>
                      </div>
                      <div style={{ flex: 1 }} />
                      {canDelete && v.localId && (
                        <button onClick={() => deleteVoice(v)} title="Delete cloned voice"
                          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--accent-red)", borderRadius: 7, width: 26, height: 26, display: "grid", placeItems: "center", cursor: "pointer" }}>
                          <Trash2 size={12} strokeWidth={2} />
                        </button>
                      )}
                    </div>
                    {v.description && (
                      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {v.description}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.voiceId}</div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        /* ── Clone Lab ─────────────────────────────────────────────────── */
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, alignItems: "start" }}>
          <div className="card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Create a cloned voice</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 5 }}>
                Voice name
                <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="e.g. Branch Manager Ravi" className={inputCls} />
              </label>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 5 }}>
                Provider
                <select value={cloneProvider} onChange={(e) => setCloneProvider(e.target.value as VoiceProvider)} className={inputCls}>
                  <option value="sarvam" disabled={!catalog?.keys.sarvam}>Sarvam AI (Indian Languages & Telugu/Hindi — Ready)</option>
                  <option value="cartesia" disabled={!catalog?.keys.cartesia}>Cartesia (Requires Paid Plan)</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 5 }}>
                Gender tag
                <select value={cloneGender} onChange={(e) => setCloneGender(e.target.value as VoiceGender)} className={inputCls}>
                  {GENDERS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 5 }}>
                Sample language
                <select value={cloneLang} onChange={(e) => setCloneLang(e.target.value as VoiceLanguage)} className={inputCls}>
                  {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
            </div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 5 }}>
              Description (optional)
              <input value={cloneDesc} onChange={(e) => setCloneDesc(e.target.value)} placeholder="Where this voice should be used" className={inputCls} />
            </label>

            {/* Sample input: upload or record */}
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              <UploadCloud size={22} strokeWidth={1.6} style={{ color: "var(--text-muted)" }} />
              <label className="btn-ghost" style={{ height: 34, cursor: "pointer" }}>
                <UploadCloud size={14} strokeWidth={2} /> Choose audio file
                <input type="file" accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/webm" style={{ display: "none" }}
                  onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
              <button onClick={toggleRecording} className={recording ? "btn-ghost" : "btn-primary"} style={{ height: 34, color: recording ? "var(--accent-red)" : undefined }}>
                {recording ? <><Square size={13} fill="currentColor" /> Stop Recording ({recordSecs}s)</> : <><Mic size={14} strokeWidth={2} /> Record with microphone</>}
              </button>
              {recording && (
                <div style={{ fontSize: 12, color: recordSecs < 10 ? "var(--accent-yellow)" : "var(--accent-green)", fontWeight: 600 }}>
                  {recordSecs < 10 ? `Recording in progress... (${recordSecs}s / 10s minimum)` : `Good length (${recordSecs}s) — speak up to 60s, then click Stop`}
                </div>
              )}
              {file && !recording && (
                <div style={{ fontSize: 12, color: "var(--accent-green)", fontWeight: 600 }}>
                  ✓ {file.name} ({Math.round(file.size / 1024)} KB)
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                10–60 seconds of clean speech (WAV, MP3, M4A, or WebM). The sample is sent to the provider for cloning and then discarded — it is never stored on our servers.
              </div>
            </div>

            {/* Consent gate */}
            <div style={{ background: "rgba(139,124,255,0.05)", border: "1px solid rgba(139,124,255,0.2)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer" }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 15, height: 15, marginTop: 2, accentColor: "var(--accent-violet)" }} />
                <span><ShieldCheck size={12} strokeWidth={2} style={{ verticalAlign: "-1px", color: "var(--accent-violet)" }} /> <strong>DPDP Act 2023 declaration (required):</strong> I own this voice, or I hold the documented written consent of the person whose voice is being cloned, and it may be used for outbound loan-advisor calls.</span>
              </label>
              <input value={consentNote} onChange={(e) => setConsentNote(e.target.value)} placeholder="Consent basis — e.g. 'own voice' or 'written consent on file, signed 2026-09-30'" className={inputCls} />
            </div>

            <button onClick={submitClone} disabled={cloning} className="btn-primary" style={{ height: 42, fontSize: 14 }}>
              {cloning ? <Loader2 size={15} className="animate-spin" /> : <CloneIcon size={15} strokeWidth={2} />}
              {cloning ? "Cloning — this takes a few seconds…" : "Clone Voice"}
            </button>
          </div>

          {/* Side rail: script + how it works */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card" style={{ padding: "18px 22px" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, display: "flex", gap: 7, alignItems: "center" }}>
                <Mic size={14} strokeWidth={2} style={{ color: "var(--accent-violet)" }} /> Reading script while recording
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--text-secondary)", background: "var(--overlay-chip)", borderRadius: 8, padding: "10px 12px", fontStyle: "italic" }}>
                “{RECORD_SCRIPT}”
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>
                Speak naturally at conversational pace in a quiet room — the sentence covers the sounds cloners need. 15–30 seconds is ideal.
              </div>
            </div>
            <div className="card" style={{ padding: "18px 22px", fontSize: 12.5, lineHeight: 1.75, color: "var(--text-secondary)" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)", marginBottom: 8 }}>What happens after cloning</div>
              1. The voice appears in the <strong>Library</strong> with a CLONE badge.<br />
              2. Audition it in Telugu, Hindi, and English with ▶.<br />
              3. Assign it to an AI Employee in <strong>Branches &amp; Staff AI</strong> — live calls, dashboard speech, and previews all switch to it.<br />
              4. Delete anytime — removed at the provider and hidden in the app, with the audit trail kept.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
