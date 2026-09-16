"use client"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"
import { useEffect, useRef, useState, useCallback } from "react"
import { Search, Send, MessageCircle, ChevronLeft, CheckCircle2, Zap, Lock, Pin, Info, X, Phone, MapPin, Wallet, Languages, Tag, StickyNote, Smile, PhoneCall } from "lucide-react"
import { useToast } from "../ui/toast"
import { usePolling } from "@/lib/use-poll"

type Lead = {
  id: string; name: string; phone: string
  last_message?: string; last_message_time?: string; last_direction?: string
  unread?: number; pinned?: boolean; pinned_at?: string | null
  address?: string | null; email?: string | null; whatsapp_number?: string | null
  product_interest?: string | null; loan_amount?: number | null; notes?: string | null
  status?: string | null; interested?: string | null; language?: string | null; source?: string | null
  ai_summary?: string | null; sentiment?: string | null; stage?: string | null
  facts?: Record<string, any> | null
}
type Msg  = { id: string; direction: string; content: string; created_at: string; status?: string }

// Real WhatsApp dark-theme palette — the app's usual purple/blue dashboard
// colors don't belong here; this view should read as WhatsApp, not as the
// rest of the console.
const WA = {
  panelBg: "#111b21",
  headerBg: "#202c33",
  chatBg: "#0b141a",
  // Every surface in this palette is a fixed WhatsApp colour that does NOT
  // follow the console theme, so the text/line colours on top of it must be
  // fixed too — a theme variable here lands on a background it was never
  // measured against (Midnight's muted grey drops to 2.7:1 on panelBg).
  hairline: "rgba(255,255,255,0.07)",
  bubbleIn: "#202c33",
  bubbleOut: "#005c4b",
  teal: "#00a884",
  tealBright: "#25d366",
  tick: "#8696a0",
  tickRead: "#53bdeb",
  textPrimary: "#e9edef",
  textSecondary: "#8696a0",
  // The timestamp/tick row sits INSIDE the bubble, so on an outgoing
  // (green) bubble it needs its own colour — textSecondary is tuned for
  // panelBg and only reaches ~2.6:1 against bubbleOut.
  metaOut: "rgba(233,237,239,0.75)",
  selected: "#2a3942",
  pinnedTint: "rgba(244,180,0,0.08)",
  pinnedBorder: "rgba(244,180,0,0.25)",
}

const SENTIMENT_COLOR: Record<string, string> = {
  positive: "#25d366", neutral: "#8696a0", frustrated: "var(--accent-yellow)", hostile: "var(--accent-red)",
}
const STAGE_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", interested: "Interested", docs_pending: "Docs pending",
  negotiating: "Negotiating", converted: "Converted", lost: "Lost", do_not_call: "Do not call",
}

// WhatsApp's chat background is never a flat color — it's a faint repeating
// doodle pattern. Reproduced as a tiled inline SVG so it doesn't depend on
// any external asset.
const CHAT_WALLPAPER =
  `url("data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>
      <g fill='none' stroke='#ffffff' stroke-width='1' opacity='0.035'>
        <circle cx='20' cy='20' r='7'/>
        <path d='M50 15 l8 8 -8 8 -8 -8 z'/>
        <path d='M90 40 q10 -10 20 0 q-10 10 -20 0 z'/>
        <circle cx='30' cy='80' r='5'/>
        <path d='M75 90 l10 12 M85 90 l-10 12'/>
        <circle cx='100' cy='95' r='9'/>
        <path d='M10 100 q8 -14 16 0'/>
      </g>
    </svg>
  `)}")`

const EMOJI = ["😀", "😂", "🙂", "😍", "👍", "🙏", "🎉", "❤️", "😢", "😮", "🤔", "👌", "🔥", "✅", "📞", "🏠"]

// Local initials avatar — the previous version generated avatars from
// api.dicebear.com seeded with the customer's name/phone, which leaked
// customer PII to a third party on every render. Avatars are now drawn
// locally, same pattern as leads-view.tsx: a tinted circle with 1-2
// initials from the name (or the last digits of the phone number when no
// name exists) and a deterministic hue per contact string.
function Avatar({ name, size = 40, phone }: { name: string; size?: number; phone?: string | null }) {
  const source = (name || "").trim()
  const fallbackDigits = (phone || "").replace(/\D/g, "")
  const initials = source
    ? source.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : fallbackDigits.slice(-2) || "?"
  const colors = ["#00d09c", "#38bdf8", "#8b7cff", "#f7b731", "#fb5670", "#a78bfa"]
  const color = colors[(source || fallbackDigits || "?").charCodeAt(0) % colors.length]
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: `color-mix(in oklab, ${color} 18%, transparent)`, border: `1px solid color-mix(in oklab, ${color} 32%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.32, fontWeight: 700, color, flexShrink: 0 }}>
      {initials}
    </div>
  )
}

function Tick({ status }: { status?: string }) {
  if (status === "read") return <span style={{ color: WA.tickRead }}>✓✓</span>
  if (status === "delivered") return <span style={{ color: WA.metaOut }}>✓✓</span>
  return <span style={{ color: WA.metaOut }}>✓</span>
}

function fmtMoney(n: any): string {
  if (!n) return "—"
  return `₹${Number(n).toLocaleString("en-IN")}`
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div style={{ display: "flex", gap: 14, padding: "12px 20px" }}>
      <Icon size={17} strokeWidth={1.8} style={{ color: WA.textSecondary, flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: WA.textSecondary, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 14, color: WA.textPrimary, wordBreak: "break-word" }}>{value}</div>
      </div>
    </div>
  )
}

export default function WhatsAppView({ role }: { role: Role }) {
  const canEdit = role !== "viewer"
  const toast = useToast()
  const [leads, setLeads]       = useState<Lead[]>([])
  const [selected, setSelected] = useState<Lead | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText]         = useState("")
  const [sending, setSending]   = useState(false)
  const [ready, setReady]       = useState<boolean | null>(null)
  const [search, setSearch]     = useState("")
  const [showInfo, setShowInfo] = useState(false)
  const [tab, setTab]           = useState<"all" | "unread">("all")
  const [showEmoji, setShowEmoji] = useState(false)
  const [calling, setCalling]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  const prevMsgCount = useRef(0)
  // Epoch guard for loadMessages: every new call bumps the epoch, so a slow
  // in-flight fetch for chat A can never render its result under chat B
  // after a quick switch — stale responses are dropped before touching state.
  const loadEpochRef = useRef(0)
  // Auto-select the first chat ONCE (initial load only). Without this
  // one-time flag, the 4s poll would treat "no chat selected" as always
  // meaning "nothing picked yet" and re-force the first chat — which is
  // wrong on mobile, where hitting the back button intentionally sets
  // selected to null to show the contact list again.
  const didInitialSelect = useRef(false)

  const checkStatus = useCallback(async () => {
    try {
      const res  = await fetch("/api/whatsapp/status")
      const data = await res.json()
      setReady(!!data.ready)
    } catch { setReady(false) }
  }, [])

  const loadLeads = useCallback(async () => {
    try {
      const res  = await fetch("/api/whatsapp/conversations")
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) {
        setLeads(data)
        // Only ever auto-select once (initial load). Using the functional
        // form avoids the stale-closure bug from before, but gating on
        // didInitialSelect on top of that is what stops mobile's "back to
        // list" button (which intentionally sets selected to null) from
        // getting overridden by the next 4s poll.
        if (data.length > 0 && !didInitialSelect.current) {
          didInitialSelect.current = true
          setSelected(prev => prev || data[0])
        }
        // Keep the open chat's own details (loan amount, sentiment, etc.)
        // fresh as new facts get extracted, without resetting the selection.
        setSelected(prev => prev ? data.find((d: Lead) => d.id === prev.id) || prev : prev)
      }
    } catch {}
  }, [])

  const loadMessages = useCallback(async (leadId: string, scroll = false) => {
    loadEpochRef.current += 1
    const epoch = loadEpochRef.current
    try {
      const res = await fetch(`/api/whatsapp/messages?leadId=${leadId}`)
      if (res.ok) {
        const data = await res.json()
        if (epoch !== loadEpochRef.current) return // a newer chat/poll superseded this one
        setMessages(data)
        if (scroll || data.length !== prevMsgCount.current) {
          prevMsgCount.current = data.length
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80)
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    checkStatus()
    loadLeads()
  }, [])

  // The fastest polls in the console (4s + 3s + 8s). usePolling stops all
  // three while the tab is hidden and fires them once on return, so a chat
  // left open in a background tab costs nothing and is still up to date the
  // moment it's looked at again.
  usePolling(checkStatus, 8000)
  usePolling(loadLeads, 4000)

  useEffect(() => {
    if (!selected) return
    loadMessages(selected.id, true)
  }, [selected?.id])

  // 0 = don't poll at all while no chat is open (mobile "back to list").
  usePolling(() => { if (selected) loadMessages(selected.id) }, selected ? 3000 : 0)

  async function send() {
    if (!text.trim() || !selected?.phone || sending) return
    const msg = text.trim()
    setText("")
    setSending(true)
    const optimistic: Msg = { id: "tmp-" + Date.now(), direction: "outbound", content: msg, created_at: new Date().toISOString(), status: "sending" }
    setMessages(prev => [...prev, optimistic])
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
    try {
      const res  = await fetch("/api/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: selected.phone, message: msg, leadId: selected.id }) })
      const data = await res.json()
      if (!res.ok) toast.error(data.error || "Send failed")
      await loadMessages(selected.id)
      await loadLeads()
    } catch { toast.error("Send failed — check WhatsApp service") }
    setSending(false)
    inputRef.current?.focus()
  }

  async function togglePin(lead: Lead, e: React.MouseEvent) {
    e.stopPropagation() // don't also select the chat when clicking the pin icon
    const nextPinned = !lead.pinned
    setLeads(prev => {
      const updated = prev.map(l => l.id === lead.id ? { ...l, pinned: nextPinned, pinned_at: nextPinned ? new Date().toISOString() : null } : l)
      return [...updated].sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        if (a.pinned && b.pinned) return (b.pinned_at || "").localeCompare(a.pinned_at || "")
        return 0
      })
    })
    if (selected?.id === lead.id) setSelected(prev => prev ? { ...prev, pinned: nextPinned, pinned_at: nextPinned ? new Date().toISOString() : null } : prev)
    try {
      const res = await fetch(`/api/leads/${lead.id}/pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: nextPinned }) })
      if (!res.ok) throw new Error()
    } catch {
      toast.error("Couldn't update pin — refreshing")
      loadLeads()
    }
  }

  function formatTime(dateStr: string) {
    const d    = new Date(dateStr)
    const now  = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    if (diff < 604800000) return d.toLocaleDateString([], { weekday: "short" })
    return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })
  }

  function formatMsgTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const filtered = leads
    .filter(l => tab === "all" || (l.unread ?? 0) > 0)
    .filter(l =>
      l.name?.toLowerCase().includes(search.toLowerCase()) ||
      l.phone?.includes(search)
    )
  const unreadCount = leads.filter(l => (l.unread ?? 0) > 0).length

  const knownIncome = selected?.facts?.monthly_income ? fmtMoney(selected.facts.monthly_income) : null

  // Calls this lead using the AI voice agent that already exists for exactly
  // this — reuses the same endpoint the Voice Logs "Call Now" button uses,
  // rather than pretending WhatsApp's own video/voice calling exists here.
  async function callLead() {
    if (!selected?.phone || calling) return
    setCalling(true)
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.id, phone: selected.phone, language: selected.language || "telugu" }),
      })
      const data = await res.json()
      if (res.ok) toast.success("AI call started — Priya is dialing now")
      else toast.error(data.error || "Call failed")
    } catch {
      toast.error("Call failed — check the voicebot service")
    }
    setCalling(false)
  }

  function insertEmoji(emoji: string) {
    setText(t => t + emoji)
    setShowEmoji(false)
    inputRef.current?.focus()
  }

  return (
    <div style={{ height: "calc(100vh - 120px)", display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden", border: `1px solid ${WA.hairline}`, background: WA.panelBg, boxShadow: "0 20px 40px rgba(0,0,0,0.3)" }}>

      {/* TOP STATUS BANNER — driven by live /api/whatsapp/status check */}
      <div style={{ background: ready ? WA.teal : "#5b2b30", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${WA.hairline}` }}>
        <CheckCircle2 size={16} strokeWidth={2.5} style={{ color: "white", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "white" }}>{ready ? "WhatsApp Connected & Configured" : "WhatsApp Disconnected"}</div>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.8)", marginTop: 1 }}>{ready ? "Authentication keys provided • Auto-reply enabled" : "Check WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env"}</div>
        </div>
        <Zap size={14} style={{ color: "white", opacity: 0.8, flexShrink: 0 }} />
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* LEFT — Contact list */}
        <div
          className={`${selected ? "hidden md:flex" : "flex"} w-full md:w-[320px]`}
          style={{ borderRight: `1px solid ${WA.hairline}`, flexDirection: "column", background: WA.panelBg, flexShrink: 0 }}
        >

          {/* Header */}
          <div style={{ padding: "16px 16px", background: WA.headerBg, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 600, fontSize: 19, color: WA.textPrimary }}>Chats</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: ready ? WA.tealBright : "var(--accent-red)" }} title={ready ? "Connected" : "Disconnected"} />
              <span style={{ fontSize: 11, fontWeight: 500, color: ready ? WA.tealBright : "var(--accent-red)" }}>{ready ? "Live" : "Offline"}</span>
            </div>
          </div>

          {/* Search */}
          <div style={{ padding: "8px 12px", background: WA.panelBg }}>
            <div style={{ background: WA.headerBg, borderRadius: 20, display: "flex", alignItems: "center", padding: "8px 14px", gap: 10 }}>
              <Search size={15} strokeWidth={2} style={{ color: WA.textSecondary, flexShrink: 0 }} />
              <input
                placeholder="Search contacts..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: WA.textPrimary, fontSize: 14, padding: 0 }}
              />
            </div>
          </div>

          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 8, padding: "0 12px 8px" }}>
            {(["all", "unread"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer",
                  background: tab === t ? WA.teal : WA.headerBg,
                  color: tab === t ? "#fff" : WA.textSecondary,
                }}
              >
                {t === "all" ? "All" : `Unread${unreadCount ? ` ${unreadCount}` : ""}`}
              </button>
            ))}
          </div>

          {/* Contact list — paddingBottom keeps the last chat clear of the
              floating Ops Assistant button (fixed bottom-right, every view). */}
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 76 }}>
            {filtered.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: WA.textSecondary, fontSize: 13 }}>
                {search ? "No matches found" : "No active conversations"}
              </div>
            )}
            {filtered.map(lead => (
              <div
                key={lead.id}
                onClick={() => {
                  setSelected(lead); setText(""); setShowInfo(false)
                  if (lead.unread) {
                    fetch("/api/whatsapp/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: lead.id }) }).then(() => loadLeads())
                  }
                }}
                style={{
                  padding: "12px 16px", cursor: "pointer",
                  background: lead.pinned ? WA.pinnedTint : selected?.id === lead.id ? WA.selected : "transparent",
                  borderLeft: lead.pinned ? `2px solid ${WA.pinnedBorder}` : "2px solid transparent",
                  display: "flex", alignItems: "center", gap: 12,
                }}
              >
                <Avatar name={lead.name} phone={lead.phone} size={44} />
                <div style={{ flex: 1, minWidth: 0, borderBottom: `1px solid ${WA.hairline}`, paddingBottom: 10, marginBottom: -10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontWeight: 500, fontSize: 14.5, color: WA.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                      {lead.pinned && <Pin size={11} strokeWidth={2.2} style={{ color: "var(--accent-yellow)", fill: "var(--accent-yellow)", flexShrink: 0 }} />}
                      {lead.name}
                    </div>
                    <div style={{ fontSize: 11, color: (lead.unread ?? 0) > 0 ? WA.tealBright : WA.textSecondary, flexShrink: 0 }}>{lead.last_message_time ? formatTime(lead.last_message_time) : ""}</div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 13, color: WA.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {lead.last_message ? lead.last_message.slice(0, 36) : lead.phone}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {(lead.unread ?? 0) > 0 && (
                        <span style={{ background: WA.tealBright, color: "#0b141a", fontSize: 10.5, fontWeight: 700, borderRadius: 10, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                          {lead.unread}
                        </span>
                      )}
                      {canEdit && (
                        <button
                          onClick={(e) => togglePin(lead, e)}
                          title={lead.pinned ? "Unpin" : "Pin to top"}
                          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2, display: "flex", alignItems: "center", opacity: lead.pinned ? 1 : 0.35 }}
                        >
                          <Pin size={13} strokeWidth={2} style={{ color: lead.pinned ? "var(--accent-yellow)" : WA.textSecondary, fill: lead.pinned ? "var(--accent-yellow)" : "none" }} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — Chat window */}
        {selected ? (
          <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", background: WA.chatBg, minWidth: 0 }}>

              {/* Chat header — clicking the contact opens the info panel, same as real WhatsApp */}
              <div style={{ padding: "12px 16px", background: WA.headerBg, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button
                  onClick={() => setShowInfo(v => !v)}
                  style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); setSelected(null) }}
                    className="md:hidden"
                    style={{ color: WA.textPrimary, display: "flex", padding: 4, marginRight: -4, flexShrink: 0 }}
                  >
                    <ChevronLeft size={22} strokeWidth={2} />
                  </span>
                  <Avatar name={selected.name} phone={selected.phone} size={40} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 15.5, color: WA.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.name}</div>
                    <div style={{ fontSize: 12, color: WA.textSecondary, display: "flex", gap: 4, alignItems: "center", marginTop: 1 }}>
                      <Lock size={9} style={{ flexShrink: 0 }} /> {selected.phone}
                    </div>
                  </div>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  {canEdit && (
                    <button
                      onClick={callLead}
                      disabled={calling}
                      title="Call this lead with Priya (AI voice agent)"
                      style={{ background: "transparent", border: "none", color: WA.textPrimary, cursor: calling ? "default" : "pointer", display: "flex", padding: 8, borderRadius: 8, opacity: calling ? 0.5 : 1 }}
                    >
                      <PhoneCall size={19} strokeWidth={1.8} />
                    </button>
                  )}
                  <button
                    onClick={() => setShowInfo(v => !v)}
                    title="Contact info"
                    style={{ background: showInfo ? WA.selected : "transparent", border: "none", color: WA.textPrimary, cursor: "pointer", display: "flex", padding: 8, borderRadius: 8 }}
                  >
                    <Info size={19} strokeWidth={1.8} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 84px", display: "flex", flexDirection: "column", gap: 8, backgroundImage: CHAT_WALLPAPER, backgroundSize: "120px 120px" }}>
                {messages.length === 0 && (
                  <div style={{ textAlign: "center", color: WA.textSecondary, fontSize: 14, marginTop: 80 }}>
                    <MessageCircle size={48} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
                    <div>No messages yet</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Start the conversation</div>
                  </div>
                )}
                {messages.map((msg, i) => {
                  const isOut = msg.direction === "outbound"
                  const showDate = i === 0 || new Date(msg.created_at).toDateString() !== new Date(messages[i - 1].created_at).toDateString()
                  return (
                    <div key={msg.id}>
                      {showDate && (
                        <div style={{ textAlign: "center", margin: "16px 0 12px" }}>
                          <span style={{ background: WA.headerBg, color: WA.textSecondary, fontSize: 12, padding: "6px 14px", borderRadius: 8 }}>
                            {new Date(msg.created_at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
                          </span>
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start", marginBottom: 4 }}>
                        <div style={{
                          maxWidth: "70%", borderRadius: isOut ? "8px 8px 2px 8px" : "8px 8px 8px 2px",
                          padding: "8px 10px",
                          background: isOut ? WA.bubbleOut : WA.bubbleIn,
                          wordBreak: "break-word"
                        }}>
                          <div style={{ fontSize: 14.5, color: WA.textPrimary, lineHeight: 1.4 }}>{msg.content}</div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 4 }}>
                            <span style={{ fontSize: 11, color: isOut ? WA.metaOut : WA.textSecondary }}>{formatMsgTime(msg.created_at)}</span>
                            {isOut && <Tick status={msg.status} />}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              {canEdit ? (
                <div style={{ padding: "12px 16px", background: WA.headerBg, display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
                  {showEmoji && (
                    <div style={{
                      position: "absolute", bottom: 64, left: 16, background: WA.panelBg, border: `1px solid ${WA.hairline}`,
                      borderRadius: 12, padding: 10, display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    }}>
                      {EMOJI.map(em => (
                        <button key={em} onClick={() => insertEmoji(em)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", padding: 4, lineHeight: 1 }}>
                          {em}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ flex: 1, background: WA.panelBg, borderRadius: 20, display: "flex", alignItems: "center", padding: "0 8px 0 16px" }}>
                    <button
                      onClick={() => setShowEmoji(v => !v)}
                      style={{ background: "none", border: "none", color: showEmoji ? WA.teal : WA.textSecondary, cursor: "pointer", display: "flex", padding: 6, flexShrink: 0 }}
                    >
                      <Smile size={20} strokeWidth={1.8} />
                    </button>
                    <input
                      ref={inputRef}
                      placeholder="Type a message"
                      value={text}
                      onChange={e => setText(e.target.value)}
                      onFocus={() => setShowEmoji(false)}
                      onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
                      disabled={ready === false}
                      style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: WA.textPrimary, fontSize: 15, padding: "10px 8px", minHeight: 36 }}
                    />
                  </div>
                  <button
                    onClick={send}
                    disabled={sending || !text.trim() || ready === false}
                    style={{ width: 40, height: 40, borderRadius: "50%", background: WA.teal, border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "white", cursor: "pointer", opacity: (sending || !text.trim() || ready === false) ? 0.5 : 1, flexShrink: 0 }}
                  >
                    <Send size={17} strokeWidth={2.2} />
                  </button>
                </div>
              ) : (
                <div style={{ padding: "14px 16px", background: WA.headerBg, textAlign: "center", color: WA.textSecondary, fontSize: 13 }}>
                  View only — no send permission
                </div>
              )}
            </div>

            {/* Contact info panel — everything Priya/staff has learned about
                this lead, so nobody has to tab away to another view mid-chat. */}
            {showInfo && (
              <div style={{ width: 320, flexShrink: 0, background: WA.panelBg, borderLeft: `1px solid ${WA.hairline}`, display: "flex", flexDirection: "column", overflowY: "auto", paddingBottom: 76 }}>
                <div style={{ padding: "16px 20px", background: WA.headerBg, display: "flex", alignItems: "center", gap: 14 }}>
                  <button onClick={() => setShowInfo(false)} style={{ background: "none", border: "none", color: WA.textPrimary, cursor: "pointer", display: "flex" }}>
                    <X size={19} strokeWidth={2} />
                  </button>
                  <span style={{ fontSize: 15, fontWeight: 500, color: WA.textPrimary }}>Contact info</span>
                </div>

                <div style={{ padding: "28px 20px", textAlign: "center", borderBottom: `1px solid ${WA.hairline}` }}>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                    <Avatar name={selected.name} phone={selected.phone} size={88} />
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: WA.textPrimary }}>{selected.name}</div>
                  <div style={{ fontSize: 13, color: WA.textSecondary, marginTop: 2 }}>{selected.phone}</div>
                  {selected.stage && (
                    <span style={{
                      display: "inline-block", marginTop: 10, fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999,
                      background: `${SENTIMENT_COLOR[selected.sentiment || "neutral"]}1e`, color: SENTIMENT_COLOR[selected.sentiment || "neutral"],
                    }}>
                      {STAGE_LABEL[selected.stage] || selected.stage}
                    </span>
                  )}
                </div>

                {selected.ai_summary && (
                  <div style={{ padding: "16px 20px", borderBottom: `1px solid ${WA.hairline}` }}>
                    <div style={{ fontSize: 11, color: WA.textSecondary, marginBottom: 6, letterSpacing: "0.04em" }}>AI SUMMARY</div>
                    <div style={{ fontSize: 13.5, color: WA.textPrimary, lineHeight: 1.55 }}>{selected.ai_summary}</div>
                  </div>
                )}

                <div style={{ borderBottom: `1px solid ${WA.hairline}`, paddingTop: 4, paddingBottom: 4 }}>
                  <InfoRow icon={Tag} label="Loan interest" value={selected.product_interest} />
                  <InfoRow icon={Wallet} label="Loan amount" value={selected.loan_amount ? fmtMoney(selected.loan_amount) : null} />
                  <InfoRow icon={Wallet} label="Monthly income (from conversation)" value={knownIncome} />
                  <InfoRow icon={MapPin} label="Address" value={selected.address} />
                  <InfoRow icon={Phone} label="Alternate / WhatsApp number" value={selected.whatsapp_number !== selected.phone ? selected.whatsapp_number : null} />
                  <InfoRow icon={Languages} label="Preferred language" value={selected.language ? selected.language[0].toUpperCase() + selected.language.slice(1) : null} />
                </div>

                {selected.notes && (
                  <div style={{ padding: "16px 20px" }}>
                    <div style={{ display: "flex", gap: 14 }}>
                      <StickyNote size={17} strokeWidth={1.8} style={{ color: WA.textSecondary, flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <div style={{ fontSize: 11, color: WA.textSecondary, marginBottom: 2 }}>Notes</div>
                        <div style={{ fontSize: 13.5, color: WA.textPrimary, lineHeight: 1.5 }}>{selected.notes}</div>
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ padding: "12px 20px", fontSize: 11, color: WA.textSecondary }}>
                  Source: {selected.source || "manual"} {selected.status ? `· Status: ${selected.status}` : ""}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="hidden md:flex" style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", background: WA.chatBg, color: WA.textSecondary }}>
            <MessageCircle size={64} strokeWidth={1} style={{ marginBottom: 20, opacity: 0.3 }} />
            <div style={{ fontSize: 20, fontWeight: 600, color: WA.textPrimary, marginBottom: 8 }}>Select a conversation</div>
            <div style={{ fontSize: 14 }}>Choose a contact to start messaging</div>
          </div>
        )}
      </div>
    </div>
  )
}
