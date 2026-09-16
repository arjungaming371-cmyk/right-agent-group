"use client"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
import { useEffect, useRef, useState, useMemo } from "react"
import {
  Bot, Check, Copy, Download, ExternalLink, FastForward, FileAudio,
  Pause, Phone, PhoneIncoming, PhoneOutgoing, Play, Repeat, Rewind,
  RotateCcw, Volume1, Volume2, VolumeX, X, Radio
} from "lucide-react"
import { formatDuration, timeAgo, formatDateTime } from "@/lib/utils"
import { usePolling } from "@/lib/use-poll"
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

export default function VoiceLogsView({ role }: { role: Role }) {
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

  // Full-featured shared Audio Player state
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isLooping, setIsLooping] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  function stopAudio() {
    const a = audioRef.current
    if (a) { a.pause(); a.currentTime = 0 }
    setIsPlaying(false)
    setPlayingId(null)
    setCurrentTime(0)
    setAudioDuration(0)
  }

  function seek(e: React.ChangeEvent<HTMLInputElement> | number) {
    const a = audioRef.current
    const t = typeof e === "number" ? e : Number(e.target.value)
    setCurrentTime(t)
    if (!a) return
    if (selected && (!a.src || playingId !== selected.id)) {
      const url = proxyRecordingUrl(selected.recording_url)
      if (url) {
        a.src = url
        setPlayingId(selected.id)
      }
    }
    try {
      a.currentTime = t
    } catch {}
  }

  function skip(seconds: number) {
    const a = audioRef.current
    if (!selected) return
    if (a && (!a.src || playingId !== selected.id)) {
      const url = proxyRecordingUrl(selected.recording_url)
      if (url) {
        a.src = url
        setPlayingId(selected.id)
      }
    }
    const total = audioDuration || selected.duration || 0
    const cur = playingId === selected.id ? (a ? a.currentTime : currentTime) : currentTime
    const target = Math.max(0, Math.min(total, cur + seconds))
    setCurrentTime(target)
    if (a) {
      try {
        a.currentTime = target
      } catch {}
    }
  }

  function changeSpeed(rate: number) {
    setPlaybackRate(rate)
    if (audioRef.current) {
      audioRef.current.playbackRate = rate
    }
  }

  function handleVolumeChange(v: number) {
    setVolume(v)
    const muted = v === 0
    setIsMuted(muted)
    if (audioRef.current) {
      audioRef.current.volume = v
      audioRef.current.muted = muted
    }
  }

  function toggleMute() {
    const a = audioRef.current
    if (!a) return
    if (isMuted) {
      a.muted = false
      setIsMuted(false)
      if (volume === 0) {
        setVolume(1)
        a.volume = 1
      }
    } else {
      a.muted = true
      setIsMuted(true)
    }
  }

  function toggleLoop() {
    const next = !isLooping
    setIsLooping(next)
    if (audioRef.current) {
      audioRef.current.loop = next
    }
  }

  function downloadRecording(call: Call) {
    const url = proxyRecordingUrl(call.recording_url)
    if (!url) return
    const link = document.createElement("a")
    link.href = url
    link.download = `call-recording-${call.phone || "call"}-${call.id.slice(0, 8)}.wav`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success("Download started")
  }

  function copyRecordingLink(call: Call) {
    const url = proxyRecordingUrl(call.recording_url)
    if (!url) return
    const fullUrl = `${window.location.origin}${url}`
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopiedLink(true)
      toast.success("Recording URL copied to clipboard")
      setTimeout(() => setCopiedLink(false), 2000)
    }).catch(() => {
      toast.error("Failed to copy link")
    })
  }

  function fmtTime(s: number): string {
    if (!isFinite(s) || s < 0) return "0:00"
    const m = Math.floor(s / 60)
    const r = Math.floor(s % 60)
    return `${m}:${r.toString().padStart(2, "0")}`
  }

  function playSafe(a: HTMLAudioElement) {
    a.playbackRate = playbackRate
    a.loop = isLooping
    a.volume = isMuted ? 0 : volume
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
      if (isPlaying) a.pause()
      else playSafe(a)
      return
    }
    setPlayingId(call.id)
    setCurrentTime(0)
    setAudioDuration(0)
    a.src = url
    playSafe(a)
  }

  async function load(silent = false) {
    // Background poll ticks skip the skeleton flash once real data is on
    // screen — without this, every 15s poll replaced the whole list with
    // skeletons all day. First load and user-triggered refreshes still show it.
    if (!silent || calls.length === 0) setLoading(true)
    try {
      const [cr, lr] = await Promise.all([fetch("/api/calls"), fetch("/api/leads")])
      if (cr.ok) setCalls(await cr.json())
      if (lr.ok) setLeads(await lr.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])
  usePolling(() => load(true), 15000)

  async function makeCall() {
    const lead  = mode === "lead" ? leads.find((l) => l.id === selectedLeadId) : null
    const phone = mode === "lead" ? lead?.phone : manualPhone
    if (!phone) return
    setCalling(true)
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead?.id, phone, language, instructions }),
      })
      const data = await res.json()
      if (res.ok) { toast.success("AI call started — Priya is dialing now"); setInstructions(""); load() }
      else toast.error(data.error || "Call failed")
    } catch {
      // Network failure — surface it, the busy state must always reset.
      toast.error("Call failed — check your connection and try again")
    } finally {
      setCalling(false)
    }
  }

  const today         = new Date().toDateString()
  const callsToday    = calls.filter(c => new Date(c.created_at).toDateString() === today).length
  const resolved      = calls.filter(c => c.outcome === "resolved" || c.status === "completed")
  const resolvedPct   = calls.length ? Math.round((resolved.length / calls.length) * 100) : 0
  const missed        = calls.filter(c => c.outcome === "missed").length
  const avgDur        = calls.length ? Math.round(calls.reduce((s, c) => s + (c.duration || 0), 0) / calls.length) : 0

  const waveformBars = useMemo(() => {
    if (!selected) return []
    const seed = selected.id ? selected.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) : 42
    const bars: number[] = []
    for (let i = 0; i < 48; i++) {
      const pseudo = Math.abs(Math.sin((seed + i) * 0.45)) * 0.7 + Math.abs(Math.cos(i * 0.75)) * 0.3
      bars.push(Math.max(20, Math.min(100, Math.round(pseudo * 100))))
    }
    return bars
  }, [selected?.id])

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
          <button onClick={() => load()} className="btn-ghost" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
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
            {/* Audio Player */}
            {selected.recording_url && (
              <div style={{
                marginBottom: 22,
                background: "linear-gradient(180deg, var(--bg-secondary) 0%, rgba(15, 23, 42, 0.45) 100%)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                boxShadow: "0 4px 20px rgba(0, 0, 0, 0.25)",
              }}>
                {/* Header: Badge + Tools (Loop, Share, Download) */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-light)", paddingBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                      color: "var(--accent-green)", background: "rgba(34,197,94,0.12)",
                      border: "1px solid rgba(34,197,94,0.25)", borderRadius: 6, padding: "3px 8px", textTransform: "uppercase"
                    }}>
                      <Radio size={12} strokeWidth={2.5} className={isPlaying && playingId === selected.id ? "animate-pulse" : ""} />
                      Call Audio
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      8 kHz PCM • Telephony Audio
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={toggleLoop}
                      title={isLooping ? "Disable Loop" : "Enable Loop"}
                      style={{
                        background: isLooping ? "rgba(59,130,246,0.2)" : "transparent",
                        border: `1px solid ${isLooping ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
                        color: isLooping ? "var(--accent-blue)" : "var(--text-muted)",
                        borderRadius: 6, padding: "4px 8px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer"
                      }}
                    >
                      <Repeat size={12} strokeWidth={2} />
                      <span>Loop</span>
                    </button>

                    <button
                      onClick={() => copyRecordingLink(selected)}
                      title="Copy Recording URL"
                      style={{
                        background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)",
                        borderRadius: 6, padding: "4px 8px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer"
                      }}
                    >
                      {copiedLink ? <Check size={12} strokeWidth={2} color="var(--accent-green)" /> : <Copy size={12} strokeWidth={2} />}
                      <span>{copiedLink ? "Copied" : "Share"}</span>
                    </button>

                    <button
                      onClick={() => downloadRecording(selected)}
                      title="Download Audio (.wav)"
                      style={{
                        background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "var(--accent-green)",
                        borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer"
                      }}
                    >
                      <Download size={12} strokeWidth={2} />
                      <span>Download</span>
                    </button>
                  </div>
                </div>

                {/* Waveform Visualization & Interactive Scrubber */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const clickX = e.clientX - rect.left
                      const totalDur = (playingId === selected.id && audioDuration) ? audioDuration : (selected.duration || 0)
                      if (totalDur > 0) {
                        const newTime = Math.max(0, Math.min(totalDur, (clickX / rect.width) * totalDur))
                        seek(newTime)
                        if (playingId !== selected.id) togglePlay(selected)
                      }
                    }}
                    style={{
                      height: 46,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 2.5,
                      padding: "4px 8px",
                      background: "var(--overlay-soft)",
                      borderRadius: 8,
                      border: "1px solid var(--border-light)",
                      cursor: "pointer",
                      position: "relative",
                      overflow: "hidden"
                    }}
                    title="Click waveform to seek anywhere"
                  >
                    {waveformBars.map((heightPercent, idx) => {
                      const totalDur = (playingId === selected.id && audioDuration) ? audioDuration : (selected.duration || 0)
                      const barPositionTime = (idx / waveformBars.length) * (totalDur || 1)
                      const isPlayed = playingId === selected.id && currentTime >= barPositionTime

                      return (
                        <div
                          key={idx}
                          style={{
                            flex: 1,
                            height: `${heightPercent}%`,
                            borderRadius: 2,
                            background: isPlayed
                              ? "var(--accent-green)"
                              : "rgba(255, 255, 255, 0.16)",
                            transition: "background 0.12s ease, height 0.2s ease",
                          }}
                        />
                      )
                    })}
                  </div>

                  {/* Scrubber Progress Slider */}
                  <div style={{ position: "relative", width: "100%", display: "flex", alignItems: "center" }}>
                    {(() => {
                      const activeDur = (playingId === selected.id && audioDuration) ? audioDuration : (selected.duration || 0)
                      const activeTime = playingId === selected.id ? currentTime : 0
                      const progPct = activeDur > 0 ? Math.min(100, Math.max(0, (activeTime / activeDur) * 100)) : 0

                      return (
                        <input
                          type="range"
                          className="audio-range-slider"
                          min={0}
                          max={activeDur || 0.1}
                          step={0.05}
                          value={activeTime}
                          onChange={seek}
                          style={{
                            width: "100%",
                            background: `linear-gradient(to right, var(--accent-green) 0%, var(--accent-green) ${progPct}%, rgba(255, 255, 255, 0.14) ${progPct}%, rgba(255, 255, 255, 0.14) 100%)`,
                          }}
                        />
                      )
                    })()}
                  </div>

                  {/* Timestamps Row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace", marginTop: -2 }}>
                    <span>{fmtTime(playingId === selected.id ? currentTime : 0)}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      Remaining: -{fmtTime(Math.max(0, ((playingId === selected.id && audioDuration ? audioDuration : selected.duration || 0) - (playingId === selected.id ? currentTime : 0))))}
                    </span>
                    <span>{fmtTime(playingId === selected.id && audioDuration ? audioDuration : selected.duration || 0)}</span>
                  </div>
                </div>

                {/* Primary Transport Controls */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2, flexWrap: "wrap", gap: 10 }}>
                  {/* Speed Presets */}
                  <div style={{ display: "flex", alignItems: "center", gap: 3, background: "var(--overlay-soft)", padding: "3px 6px", borderRadius: 8, border: "1px solid var(--border-light)" }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 2 }}>Speed:</span>
                    {[0.75, 1.0, 1.25, 1.5, 2.0].map(rate => (
                      <button
                        key={rate}
                        onClick={() => changeSpeed(rate)}
                        style={{
                          background: playbackRate === rate ? "var(--accent-green)" : "transparent",
                          color: playbackRate === rate ? "#000" : "var(--text-secondary)",
                          fontWeight: playbackRate === rate ? 700 : 500,
                          fontSize: 11,
                          padding: "2px 6px",
                          borderRadius: 5,
                          border: "none",
                          cursor: "pointer",
                          transition: "all 0.15s ease"
                        }}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>

                  {/* Playback Controls (Restart, Rewind, Play/Pause, Fast Forward) */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      onClick={() => {
                        seek(0)
                        if (!isPlaying) togglePlay(selected)
                      }}
                      title="Restart (0:00)"
                      style={{
                        width: 32, height: 32, borderRadius: "50%",
                        background: "var(--overlay-soft)", border: "1px solid var(--border-light)",
                        color: "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer"
                      }}
                    >
                      <RotateCcw size={14} strokeWidth={2} />
                    </button>

                    <button
                      onClick={() => skip(-5)}
                      title="Rewind 5 seconds"
                      style={{
                        width: 34, height: 34, borderRadius: "50%",
                        background: "var(--overlay-soft)", border: "1px solid var(--border-light)",
                        color: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer"
                      }}
                    >
                      <Rewind size={15} strokeWidth={2} />
                    </button>

                    <button
                      onClick={() => selected && togglePlay(selected)}
                      title={playingId === selected.id && isPlaying ? "Pause" : "Play"}
                      style={{
                        width: 44, height: 44, borderRadius: "50%",
                        background: "var(--accent-green)",
                        border: "none",
                        color: "#052e16",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer",
                        boxShadow: isPlaying && playingId === selected.id ? "0 0 16px rgba(34, 197, 94, 0.5)" : "0 2px 8px rgba(0, 0, 0, 0.3)",
                        transition: "all 0.2s ease"
                      }}
                    >
                      {playingId === selected.id && isPlaying
                        ? <Pause size={20} strokeWidth={2.5} fill="currentColor" />
                        : <Play size={20} strokeWidth={2.5} fill="currentColor" style={{ marginLeft: 2 }} />}
                    </button>

                    <button
                      onClick={() => skip(5)}
                      title="Forward 5 seconds"
                      style={{
                        width: 34, height: 34, borderRadius: "50%",
                        background: "var(--overlay-soft)", border: "1px solid var(--border-light)",
                        color: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer"
                      }}
                    >
                      <FastForward size={15} strokeWidth={2} />
                    </button>
                  </div>

                  {/* Volume Control */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 120 }}>
                    <button
                      onClick={toggleMute}
                      title={isMuted ? "Unmute" : "Mute"}
                      style={{
                        background: "none", border: "none", color: isMuted ? "var(--accent-red)" : "var(--text-muted)",
                        cursor: "pointer", display: "flex", alignItems: "center"
                      }}
                    >
                      {isMuted || volume === 0 ? <VolumeX size={16} strokeWidth={2} /> : volume < 0.5 ? <Volume1 size={16} strokeWidth={2} /> : <Volume2 size={16} strokeWidth={2} />}
                    </button>
                    {(() => {
                      const vPct = Math.round((isMuted ? 0 : volume) * 100)
                      return (
                        <>
                          <input
                            type="range"
                            className="audio-range-slider"
                            min={0}
                            max={1}
                            step={0.02}
                            value={isMuted ? 0 : volume}
                            onChange={e => handleVolumeChange(Number(e.target.value))}
                            style={{
                              width: 65,
                              background: `linear-gradient(to right, var(--accent-green) 0%, var(--accent-green) ${vPct}%, rgba(255, 255, 255, 0.14) ${vPct}%, rgba(255, 255, 255, 0.14) 100%)`,
                            }}
                            title={`Volume: ${vPct}%`}
                          />
                          <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 32, fontFamily: "monospace", textAlign: "right" }}>
                            {vPct}%
                          </span>
                        </>
                      )
                    })()}
                  </div>
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
