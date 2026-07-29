"use client"
import { useEffect, useRef, useState } from "react"
import { Bot, Pause, Phone, PhoneIncoming, PhoneOutgoing, Play, RotateCcw, X } from "lucide-react"
import { formatDuration, timeAgo, formatDateTime } from "@/lib/utils"
import { useToast } from "../ui/toast"
import { SkeletonList } from "../ui/skeleton"

type Call = {
  id: string; phone: string; direction: string; duration: number
  status: string; sentiment: string; outcome: string; transcript: any[]
  recording_url: string; language: string; created_at: string
  leads?: { name: string; phone: string }
}
type Lead = { id: string; name: string; phone: string }

const OUTCOME_STYLE: Record<string, { bg: string; color: string }> = {
  resolved:    { bg: "rgba(34,197,94,0.15)",  color: "var(--accent-green)" },
  missed:      { bg: "rgba(239,68,68,0.15)",  color: "var(--accent-red)" },
  voicemail:   { bg: "rgba(245,158,11,0.15)", color: "var(--accent-yellow)" },
  transferred: { bg: "rgba(59,130,246,0.15)", color: "var(--accent-blue)" },
  pending:     { bg: "rgba(100,116,139,0.15)",color: "var(--text-secondary)" },
  failed:      { bg: "rgba(239,68,68,0.15)",  color: "var(--accent-red)" },
}
const SENTIMENT_COLOR: Record<string, string> = {
  Positive: "var(--accent-green)", Neutral: "var(--text-secondary)", Negative: "var(--accent-red)"
}

// Proxy Exotel recordings through our server to avoid browser auth popup
function proxyRecordingUrl(url: string | null): string | null {
  if (!url) return null
  if (url.includes("exotel.com") || url.includes("exotel.in")) {
    return `/api/calls/recording?url=${encodeURIComponent(url)}`
  }
  return url
}

export default function VoiceLogsView({ role }: { role: "admin" | "agent" | "viewer" | "developer" }) {
  const canEdit = role !== "viewer"
  const toast = useToast()
  const [calls, setCalls]   = useState<Call[]>([])
  const [leads, setLeads]   = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Call | null>(null)

  const [mode, setMode]               = useState<"lead" | "manual">("lead")
  const [selectedLeadId, setSelectedLeadId] = useState("")
  const [manualPhone, setManualPhone] = useState("")
  const [language, setLanguage]       = useState("telugu")
  const [instructions, setInstructions] = useState("")
  const [calling, setCalling]         = useState(false)

  // Single shared <audio> element for BOTH the row "play" buttons and the
  // detail modal. There used to be two independent <audio> tags (one hidden
  // for row playback, one <audio controls> in the modal) with no shared
  // state — they could play at once, the row button never showed
  // playing/paused, and closing the modal (X) never touched the row audio
  // since it was a different element entirely. One element + real state
  // fixes all of that: only one recording can ever be playing.
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)

  function stopAudio() {
    const a = audioRef.current
    if (a) { a.pause(); a.currentTime = 0 }
    setIsPlaying(false)
    setPlayingId(null)
    setCurrentTime(0)
    setAudioDuration(0)
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const a = audioRef.current
    if (!a) return
    const t = Number(e.target.value)
    a.currentTime = t
    setCurrentTime(t)
  }

  function fmtTime(s: number): string {
    if (!isFinite(s) || s < 0) return "0:00"
    const m = Math.floor(s / 60)
    const r = Math.floor(s % 60)
    return `${m}:${r.toString().padStart(2, "0")}`
  }

  // Assigning a new .src (or calling .load()) while a previous play()
  // promise hasn't settled yet makes the browser reject THAT promise with
  // AbortError ("The play() request was interrupted by a new load
  // request.") — that's not a failure, it's exactly what's supposed to
  // happen when the user switches recordings quickly, so it must not be
  // surfaced as an error toast. Any other rejection (autoplay blocked,
  // network failure, unsupported format) is a real problem and still gets
  // reported.
  function playSafe(a: HTMLAudioElement) {
    a.play().catch((e: DOMException) => {
      if (e.name === "AbortError") return
      toast.error(`Cannot play recording: ${e.message}`)
    })
  }

  function togglePlay(call: Call) {
    const url = proxyRecordingUrl(call.recording_url)
    const a = audioRef.current
    if (!url || !a) return
    if (playingId === call.id) {
      // Same recording — toggle play/pause instead of restarting it.
      if (isPlaying) a.pause()
      else playSafe(a)
      return
    }
    // Switching recordings — assigning a new src auto-stops whatever was
    // playing before, so there is never more than one audio source active.
    setPlayingId(call.id)
    setCurrentTime(0)
    setAudioDuration(0)
    a.src = url
    playSafe(a)
  }

  async function load() {
    setLoading(true)
    const [cr, lr] = await Promise.all([fetch("/api/calls"), fetch("/api/leads")])
    if (cr.ok) setCalls(await cr.json())
    if (lr.ok) setLeads(await lr.json())
    setLoading(false)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  async function makeCall() {
    const lead  = mode === "lead" ? leads.find((l) => l.id === selectedLeadId) : null
    const phone = mode === "lead" ? lead?.phone : manualPhone
    if (!phone) return
    setCalling(true)
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead?.id, phone, language, instructions }),
    })
    const data = await res.json()
    setCalling(false)
    if (res.ok) { toast.success("AI call started — Priya is dialing now"); setInstructions(""); load() }
    else toast.error(data.error || "Call failed")
  }

  const today         = new Date().toDateString()
  const callsToday    = calls.filter(c => new Date(c.created_at).toDateString() === today).length
  const resolved      = calls.filter(c => c.outcome === "resolved" || c.status === "completed")
  const resolvedPct   = calls.length ? Math.round((resolved.length / calls.length) * 100) : 0
  const missed        = calls.filter(c => c.outcome === "missed").length
  const avgDur        = calls.length ? Math.round(calls.reduce((s, c) => s + (c.duration || 0), 0) / calls.length) : 0

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {[
          { label: "Calls Today",      value: callsToday.toString() },
          { label: "Avg. Handle Time", value: `${Math.floor(avgDur/60)}m ${avgDur%60}s` },
          { label: "Resolved by Bot",  value: `${resolvedPct}%` },
          { label: "Missed",           value: missed.toString() },
        ].map(s => (
          <div key={s.label} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
            <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 32, fontWeight: 700 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Trigger call — hidden for read-only viewers */}
      {canEdit && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(139,124,255,0.15)", border: "1px solid rgba(139,124,255,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Bot size={14} style={{ color: "var(--accent-violet)" }} />
            </span>
            Trigger AI Outbound Call
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {["lead", "manual"].map(m => (
              <button key={m} onClick={() => setMode(m as any)} style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 13,
                border: "1px solid var(--border)",
                background: mode === m ? "rgba(59,130,246,0.15)" : "transparent",
                color: mode === m ? "var(--accent-blue)" : "var(--text-secondary)"
              }}>{m === "lead" ? "Select Lead" : "Manual Number"}</button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            {mode === "lead" ? (
              <select value={selectedLeadId} onChange={e => setSelectedLeadId(e.target.value)} style={{ flex: 1 }}>
                <option value="">Select a lead…</option>
                {leads.map(l => <option key={l.id} value={l.id}>{l.name} — {l.phone}</option>)}
              </select>
            ) : (
              <input placeholder="+91 98765 43210" value={manualPhone} onChange={e => setManualPhone(e.target.value)} style={{ flex: 1 }} />
            )}
            <select value={language} onChange={e => setLanguage(e.target.value)} style={{ width: 140 }}>
              <option value="english">English</option>
              <option value="hindi">Hinglish</option>
              <option value="telugu">Tenglish</option>
            </select>
          </div>

          <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>
            What should Priya talk about? (optional)
          </label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="e.g. Follow up on home loan enquiry, mention 8.4% rate offer"
            rows={2}
            style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 8, padding: 10, fontSize: 13, resize: "vertical", marginBottom: 12 }}
          />

          <button
            onClick={makeCall}
            disabled={calling || (mode === "lead" ? !selectedLeadId : !manualPhone)}
            className="btn-primary"
            style={{ height: 38, padding: "0 22px" }}
          >
            <Phone size={14} strokeWidth={2} /> {calling ? "Calling…" : "Call Now"}
          </button>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            AI Priya will call, speak in the chosen language, collect name/address/WhatsApp, and send the application link automatically.
          </div>
        </div>
      )}

      {/* Call history */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Call History</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Voice Bot — recorded and transcribed</div>
          </div>
          <button onClick={load} className="btn-ghost" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
            <RotateCcw size={12.5} strokeWidth={1.9} /> Refresh
          </button>
        </div>

        {loading && <SkeletonList rows={4} />}
        {!loading && calls.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No calls yet.</div>}

        {calls.map(call => {
          const name    = call.leads?.name || call.phone || "Unknown"
          const num     = call.leads?.phone || call.phone || ""
          const time    = new Date(call.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          const isToday = new Date(call.created_at).toDateString() === today
          const dateStr = isToday ? "Today" : `${timeAgo(call.created_at)} · ${formatDateTime(call.created_at).split(",")[0]}`
          const ost     = OUTCOME_STYLE[call.outcome] ?? OUTCOME_STYLE.pending
          const hasRec  = !!call.recording_url
          return (
            <div
              key={call.id}
              onClick={() => setSelected(call)}
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 24px", borderBottom: "1px solid var(--border-light)", cursor: "pointer" }}
            >
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: call.direction === "inbound" ? "rgba(56,189,248,0.12)" : "rgba(139,124,255,0.12)",
                border: `1px solid ${call.direction === "inbound" ? "rgba(56,189,248,0.28)" : "rgba(139,124,255,0.28)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: call.direction === "inbound" ? "var(--accent-cyan)" : "var(--accent-violet)",
              }}>
                {call.direction === "inbound" ? <PhoneIncoming size={16} strokeWidth={1.9} /> : <PhoneOutgoing size={16} strokeWidth={1.9} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{num} · {dateStr}, {time}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)", fontFamily: "monospace" }}>{formatDuration(call.duration || 0)}</span>
                <span style={{ color: SENTIMENT_COLOR[call.sentiment] ?? SENTIMENT_COLOR.Neutral, fontSize: 12, padding: "3px 10px", background: "var(--overlay-hover)", borderRadius: 6 }}>
                  {call.sentiment || "Neutral"}
                </span>
                <span style={{ background: ost.bg, color: ost.color, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, textTransform: "capitalize" }}>
                  {call.outcome || call.status}
                </span>
                {/* Play/pause button — uses proxy to avoid Twilio auth popup.
                    Reflects real play/pause state via playingId/isPlaying. */}
                <button
                  onClick={e => { e.stopPropagation(); if (hasRec) togglePlay(call) }}
                  title={hasRec ? (playingId === call.id && isPlaying ? "Pause recording" : "Play recording") : "No recording available"}
                  style={{
                    background: hasRec ? "rgba(34,197,94,0.15)" : "transparent",
                    border: `1px solid ${hasRec ? "rgba(34,197,94,0.3)" : "var(--border)"}`,
                    borderRadius: "50%", width: 32, height: 32,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: hasRec ? "var(--accent-green)" : "var(--border)",
                    cursor: hasRec ? "pointer" : "not-allowed",
                  }}
                >
                  {playingId === call.id && isPlaying
                    ? <Pause size={13} strokeWidth={2} fill="currentColor" />
                    : <Play size={13} strokeWidth={2} fill={hasRec ? "currentColor" : "none"} />}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Single shared audio player — plays proxied recording for both the
          row buttons and the modal below. Events keep isPlaying/playingId
          truthful even when playback ends naturally or errors out, instead
          of the UI silently drifting out of sync with what's actually
          audible. */}
      <audio
        ref={audioRef}
        style={{ display: "none" }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); setPlayingId(null); setCurrentTime(0) }}
        onError={() => { setIsPlaying(false); setPlayingId(null); toast.error("Cannot play recording") }}
        onLoadedMetadata={e => setAudioDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
      />

      {/* Call detail modal */}
      {selected && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => { stopAudio(); setSelected(null) }}
        >
          <div
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 620, maxHeight: "85vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>
                Call Details — {selected.leads?.name || selected.phone}
              </div>
              {/* Closing must silence any recording still playing — this used
                  to leave the row-button's audio running in the background
                  since it was a completely separate <audio> element. */}
              <button onClick={() => { stopAudio(); setSelected(null) }} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}><X size={19} strokeWidth={2} /></button>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[
                ["Duration",  formatDuration(selected.duration || 0)],
                ["Outcome",   selected.outcome || selected.status],
                ["Language",  selected.language],
              ].map(([l, v]) => (
                <div key={l} style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{l}</div>
                  <div style={{ fontWeight: 600, fontSize: 13, textTransform: "capitalize" }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Recording — proxied through server. Uses the SAME shared
                audio element/state as the row buttons (see togglePlay
                above) so this can never play concurrently with a row
                recording, and this button's icon always reflects whether
                audio is actually playing. */}
            {selected.recording_url && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600, letterSpacing: "0.05em" }}>RECORDING</div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  background: "var(--bg-secondary)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "10px 14px", color: "var(--text-primary)",
                }}>
                  <button
                    onClick={() => selected && togglePlay(selected)}
                    style={{
                      width: 30, height: 30, borderRadius: "50%", flexShrink: 0, padding: 0,
                      background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)",
                      display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-green)",
                      cursor: "pointer",
                    }}
                  >
                    {playingId === selected.id && isPlaying
                      ? <Pause size={13} strokeWidth={2} fill="currentColor" />
                      : <Play size={13} strokeWidth={2} fill="currentColor" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={playingId === selected.id && audioDuration ? audioDuration : selected.duration || 0}
                    step={0.1}
                    value={playingId === selected.id ? currentTime : 0}
                    onChange={seek}
                    style={{ flex: 1, accentColor: "var(--accent-green)" }}
                  />
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace", minWidth: 78, textAlign: "right" }}>
                    {fmtTime(playingId === selected.id ? currentTime : 0)} / {fmtTime(playingId === selected.id && audioDuration ? audioDuration : selected.duration || 0)}
                  </span>
                </div>
              </div>
            )}

            {/* Transcript */}
            {Array.isArray(selected.transcript) && selected.transcript.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, fontWeight: 600, letterSpacing: "0.05em" }}>TRANSCRIPT</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {selected.transcript.map((t: any, i: number) => (
                    <div key={i} style={{ display: "flex", gap: 12, padding: "8px 12px", borderRadius: 8, background: t.role === "ai" ? "rgba(59,130,246,0.08)" : "var(--overlay-soft)" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: t.role === "ai" ? "var(--accent-blue)" : "var(--text-muted)", minWidth: 80, flexShrink: 0, textTransform: "uppercase" }}>
                        {t.role === "ai" ? "Priya" : "Customer"}
                      </span>
                      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!selected.recording_url && (!Array.isArray(selected.transcript) || selected.transcript.length === 0) && (
              <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, padding: 20 }}>
                No recording or transcript available for this call.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
