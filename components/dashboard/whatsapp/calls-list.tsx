"use client"

// WhatsApp Calls tab — the real WhatsApp "Calls" screen:
//
//   • rows = WHATSAPP calls ONLY (voice_calls wacall-* + missed-call bubbles
//     from whatsapp_messages) — Exotel/local phone-line calls stay in Voice
//     Logs / Comm Log, exactly like the real app only lists WhatsApp calls
//   • newest first, All / Missed filter chips
//   • red name + missed arrow for unanswered, teal arrows for in/out
//   • tap a row → opens that lead's chat (call bubble + full history live
//     there) — this is the "management" hop
//   • phone button → AI call back via Exotel (WhatsApp business-initiated
//     calls aren't offered by Meta yet — permission-template gated)
//
// Data source: GET /api/calls?channel=whatsapp (branch-scoped).

import { Fragment, useEffect, useMemo, useState } from "react"
import {
  Search, Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  RefreshCw, Video, Play, Pause,
} from "lucide-react"
import { WA, WA_FONT, type Lead } from "./palette"
import { Avatar, IconBtn } from "./bits"
import { WhatsAppGlyph } from "./chat-list"

export type CallRow = {
  id: string
  lead_id?: string | null
  twilio_call_sid?: string | null
  direction?: string | null
  status?: string | null
  duration?: number | null
  outcome?: string | null
  created_at?: string
  phone?: string | null
  language?: string | null
  recording_url?: string | null
  leads?: { name?: string; phone?: string; source?: string } | null
}

const isWhatsAppCall = (sid?: string | null) => !!sid && String(sid).startsWith("wacall-")

// 'rejected' = the lead explicitly declined our business-initiated call —
// a miss (red), not a normal completion. 'no-answer'/'cancelled'/'busy' are
// written by the WhatsApp finalizer and Exotel's status webhook.
const MISSED_STATUSES = ["missed", "failed", "no-answer", "cancelled", "busy", "rejected"]

function isMissed(c: CallRow) {
  const s = (c.status || "").toLowerCase()
  // A live/just-started call is NOT a miss. duration stays 0/null until the
  // voicebot's "end" report lands, so the old check (inbound && duration 0)
  // painted every answered call red "Missed" for its whole duration.
  if (s.includes("progress") || s.includes("initiat") || s.includes("ring")) return false
  return MISSED_STATUSES.some((m) => s.includes(m)) || (c.direction === "inbound" && (c.duration ?? 0) === 0)
}

function fmtWhen(iso?: string) {
  if (!iso) return ""
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString()
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (sameDay) return hm
  if (yesterday) return `Yesterday, ${hm}`
  return `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" })}, ${hm}`
}

function fmtDuration(sec?: number | null) {
  const s = sec ?? 0
  if (s <= 0) return ""
  if (s < 60) return `${s} sec`
  const m = Math.floor(s / 60)
  return `${m} min${s % 60 ? ` ${s % 60} sec` : ""}`
}

export default function CallsList({
  leads, onOpenChat, onRefresh, onDiagnose, ready, onMissedCount,
}: {
  leads: Lead[]
  onOpenChat: (l: Lead) => void
  onRefresh: () => void
  onDiagnose: () => void
  ready: boolean
  onMissedCount?: (n: number) => void
}) {
  const [calls, setCalls] = useState<CallRow[]>([])
  const [filter, setFilter] = useState<"all" | "missed">("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  // explicit error state (staff spec) — a 500/401 body used to be silently
  // swallowed and the tab showed a stale list with no hint anything was wrong
  const [loadError, setLoadError] = useState(false)
  // inline recording player — one at a time, mounted ONLY while playing
  // (lazy: zero <audio> elements for the other 99 rows)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [playerError, setPlayerError] = useState(false)

  function togglePlay(c: CallRow) {
    if (!c.recording_url) return
    setPlayerError(false)
    setPlayingId((cur) => (cur === c.id ? null : c.id))
  }

  async function load() {
    try {
      // channel=whatsapp → only WhatsApp calls (wacall-*), never the local
      // phone-line calls — the WhatsApp Calls screen stays WhatsApp-only.
      const res = await fetch("/api/calls?channel=whatsapp")
      const data = await res.json()
      if (Array.isArray(data)) {
        setCalls(data)
        setLoadError(false)
      } else {
        setLoadError(true)
      }
    } catch {
      setLoadError(true)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  // keep the list fresh like the chat list does
  useEffect(() => {
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  const rows = useMemo(() => {
    let r = calls
    if (filter === "missed") r = r.filter(isMissed)
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter((c) =>
        (c.leads?.name || "").toLowerCase().includes(q) ||
        (c.phone || c.leads?.phone || "").includes(q))
    }
    return r
  }, [calls, filter, search])

  const missedCount = calls.filter(isMissed).length

  // report up so the Chats|Calls bottom nav can show the red missed badge
  // (real WhatsApp marks the Calls tab until you've viewed it)
  useEffect(() => { onMissedCount?.(missedCount) }, [missedCount, onMissedCount])

  // tap → open the lead's chat; lead not in the conversations list → build a
  // minimal stand-in so the chat screen still opens (same trick NewChat uses)
  function open(c: CallRow) {
    const leadId = c.lead_id || undefined
    const found = leads.find((l) => l.id === leadId || l.phone === (c.phone || c.leads?.phone))
    if (found) { onOpenChat(found); return }
    const phone = c.phone || c.leads?.phone || ""
    onOpenChat({
      id: leadId || "lead-" + (c.id || Date.now()),
      name: c.leads?.name || phone || "Unknown caller",
      phone,
      whatsapp_number: phone,
    } as Lead)
  }

  // AI call back over the phone line (Meta gates business-initiated
  // WhatsApp calls) — through the UNIFIED dialer so this path gets the same
  // compliance/quota/comm-log treatment as every other outbound dial.
  // The dialer is lead-scoped; a rare row with no lead (unmatched missed-call
  // bubble) falls back to the legacy phone endpoint, which matches/creates
  // the lead from the number itself.
  async function callBack(c: CallRow) {
    const phone = c.phone || c.leads?.phone
    if (!phone) return
    try {
      const res = c.lead_id
        ? await fetch("/api/calls/dial", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadId: c.lead_id, channel: "phone" }),
          })
        : await fetch("/api/calls", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone, language: c.language || "telugu" }),
          })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        console.error("call back failed:", d?.error || res.status)
      }
    } catch {
      console.error("call back failed: network error")
    }
  }

  return (
    // FIX (2026-09-24): dropped the inline width:"100%" — it overrode
    // md:w-[380px] (inline styles beat classes) and stretched this panel
    // over the chat window; width is class-driven like the chat list now.
    <div
      className="flex w-full md:w-[380px]"
      style={{ borderRight: `1px solid ${WA.hairline}`, flexDirection: "column", background: WA.panelBg, flexShrink: 0 }}
    >

      {/* header — WhatsApp Calls title row */}
      <div style={{ padding: "18px 16px 10px 20px", background: WA.headerBg, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 21, fontWeight: 700, color: WA.textPrimary }}>Calls</div>
        <div style={{ display: "flex", gap: 4 }}>
          <IconBtn title="Refresh" onClick={() => { setLoading(true); load(); onRefresh() }}><RefreshCw size={17} /></IconBtn>
          <IconBtn title="WhatsApp business-initiated calling needs Meta's permission template — AI call back uses the phone line" onClick={() => {}}>
            <Video size={19} style={{ opacity: 0.35, cursor: "not-allowed" }} />
          </IconBtn>
        </div>
      </div>

      {/* offline strip — same as chats, with diagnose */}
      {!ready && (
        <div style={{ background: "#49272c", color: "#ffd7d7", fontSize: 12.5, padding: "7px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: WA.danger, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Offline — messages can't send.</span>
          <button onClick={onDiagnose} style={{
            background: "transparent", border: "1px solid rgba(255,215,215,0.4)", color: "#ffd7d7",
            borderRadius: 999, fontSize: 11.5, padding: "3px 10px", cursor: "pointer",
          }}>Diagnose</button>
        </div>
      )}

      {/* load-failure strip — the list may be stale; never fail silently */}
      {loadError && (
        <div style={{ background: "#49272c", color: "#ffd7d7", fontSize: 12.5, padding: "7px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: WA.danger, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Couldn't load calls — the list may be out of date.</span>
          <button onClick={() => { setLoading(true); load() }} style={{
            background: "transparent", border: "1px solid rgba(255,215,215,0.4)", color: "#ffd7d7",
            borderRadius: 999, fontSize: 11.5, padding: "3px 10px", cursor: "pointer",
          }}>Retry</button>
        </div>
      )}

      {/* search */}
      <div style={{ padding: "8px 12px 4px" }}>
        <div style={{ background: WA.headerBg, borderRadius: 10, display: "flex", alignItems: "center", padding: "7px 12px", gap: 10 }}>
          <Search size={15} strokeWidth={2.2} style={{ color: WA.textSecondary, flexShrink: 0 }} />
          <input
            placeholder="Search calls"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ background: "transparent", border: 0, outline: "none", color: WA.textPrimary, fontSize: 13.5, flex: 1 }}
          />
        </div>
      </div>

      {/* All / Missed chips */}
      <div style={{ padding: "6px 12px 8px", display: "flex", gap: 8 }}>
        {([["all", "All"], ["missed", missedCount ? `Missed ${missedCount}` : "Missed"]] as ["all" | "missed", string][]).map(([t, label]) => (
          <button key={t} onClick={() => setFilter(t)} style={{
            background: filter === t ? WA.chipActiveBg : WA.headerBg, border: 0, borderRadius: 999,
            color: filter === t ? WA.tealBright : WA.textSecondary, fontSize: 12.5, padding: "6px 14px", cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>

      {/* rows */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {loading && rows.length === 0 && (
          <div style={{ color: WA.textSecondary, fontSize: 13, padding: 24 }}>Loading calls…</div>
        )}
        {!loading && rows.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60%", color: WA.textSecondary, textAlign: "center", padding: 20 }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: WA.headerBg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <Phone size={26} />
            </div>
            <div style={{ fontSize: 14.5, color: WA.textPrimary, marginBottom: 6 }}>
              {filter === "missed" ? "No missed calls" : "No calls yet"}
            </div>
            <div style={{ fontSize: 12.5, maxWidth: 250, lineHeight: 1.5 }}>
              {filter === "missed"
                ? "Every WhatsApp voice call got answered."
                : "WhatsApp voice calls to your business number will show up here."}
            </div>
          </div>
        )}

        {rows.map((c) => {
          const missed = isMissed(c)
          const wa = isWhatsAppCall(c.twilio_call_sid)
          const outbound = c.direction === "outbound"
          const name = c.leads?.name || c.phone || "Unknown"
          const playable = !missed && !!c.recording_url
          const isPlaying = playingId === c.id
          return (
            <Fragment key={c.id}>
            <div onClick={() => open(c)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "9px 14px", cursor: "pointer",
            }}
              onMouseEnter={(e) => (e.currentTarget.style.background = WA.hover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>

              <Avatar name={name} size={44} phone={c.phone || c.leads?.phone} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, color: missed ? "#ea0038" : WA.textPrimary, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {name}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2, fontSize: 12.5, color: WA.textSecondary }}>
                  {missed
                    ? <PhoneMissed size={13} style={{ color: "#ea0038", flexShrink: 0 }} />
                    : outbound
                      ? <PhoneOutgoing size={13} style={{ color: WA.teal, flexShrink: 0 }} />
                      : <PhoneIncoming size={13} style={{ color: WA.teal, flexShrink: 0 }} />}
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {fmtWhen(c.created_at)}{fmtDuration(c.duration) ? ` · ${fmtDuration(c.duration)}` : ""}
                    {missed ? " · Missed" : ""}
                  </span>
                  {/* channel badge: WhatsApp WebRTC vs Exotel phone line */}
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
                    background: WA.pill, borderRadius: 999, padding: "1px 7px", fontSize: 10.5, color: wa ? WA.tealBright : WA.textSecondary,
                  }}>
                    {wa ? <WhatsAppGlyph size={9} color={WA.tealBright} /> : <Phone size={9} />}
                    {wa ? "WhatsApp" : "Phone"}
                  </span>
                </div>
              </div>

              {/* call recording — WhatsApp calls are recorded by the voicebot
                  (mixed caller + Priya); tap to play inline, like Voice Logs */}
              {playable && (
                <button
                  title={isPlaying ? "Stop recording" : "Play recording"}
                  aria-label={isPlaying ? "Stop recording" : "Play recording"}
                  onClick={(e) => { e.stopPropagation(); togglePlay(c) }}
                  style={{ background: "transparent", border: 0, cursor: "pointer", padding: 6, borderRadius: "50%", display: "flex" }}
                >
                  {isPlaying
                    ? <Pause size={17} style={{ color: WA.tealBright }} />
                    : <Play size={17} style={{ color: WA.textSecondary }} />}
                </button>
              )}

              {/* AI call back over the phone line (Meta gates business-initiated
                  WhatsApp calling behind a permission template, honestly
                  disabled until that's approved) */}
              <button
                title="AI call back (phone line)"
                onClick={(e) => { e.stopPropagation(); callBack(c) }}
                style={{ background: "transparent", border: 0, cursor: "pointer", padding: 6, borderRadius: "50%", display: "flex" }}
              >
                <Phone size={17} style={{ color: WA.teal }} />
              </button>
            </div>

            {isPlaying && (
              <div onClick={(e) => e.stopPropagation()} style={{
                padding: "2px 14px 10px 70px", background: WA.hover,
              }}>
                {playerError ? (
                  <div style={{ fontSize: 12, color: "#ea0038", padding: "4px 0" }}>
                    Recording unavailable — the file may still be processing.
                  </div>
                ) : (
                  <audio
                    key={c.id}
                    controls
                    autoPlay
                    preload="none"
                    src={c.recording_url || undefined}
                    onError={() => setPlayerError(true)}
                    style={{ width: "100%", height: 34 }}
                  />
                )}
              </div>
            )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
