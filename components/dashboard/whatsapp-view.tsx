"use client"
import { useEffect, useRef, useState, useCallback } from "react"
import { Search, Send, Bot, MessageCircle, AlertTriangle } from "lucide-react"
import { useToast } from "../ui/toast"

type Lead = { id: string; name: string; phone: string; last_message?: string; last_message_time?: string; last_direction?: string; unread?: number }
type Msg  = { id: string; direction: string; content: string; created_at: string; status?: string }

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = (name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
  const colors = ["#25D366", "#128C7E", "#075E54", "#34B7F1", "#1d4ed8", "#7c3aed"]
  const bg = colors[(name || "?").charCodeAt(0) % colors.length]
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.32, fontWeight: 700, color: "white", flexShrink: 0 }}>
      {initials}
    </div>
  )
}

function Tick({ status }: { status?: string }) {
  if (status === "sent") return <span style={{ color: "#a8b4c0" }}>✓</span>
  if (status === "delivered") return <span style={{ color: "#a8b4c0" }}>✓✓</span>
  if (status === "read") return <span style={{ color: "#53bdeb" }}>✓✓</span>
  return <span style={{ color: "#a8b4c0" }}>✓</span>
}

export default function WhatsAppView({ role }: { role: "admin" | "agent" | "viewer" }) {
  const canEdit = role !== "viewer"
  const toast = useToast()
  const [leads, setLeads]       = useState<Lead[]>([])
  const [selected, setSelected] = useState<Lead | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText]         = useState("")
  const [sending, setSending]   = useState(false)
  const [ready, setReady]       = useState<boolean | null>(null)
  const [search, setSearch]     = useState("")
  const [aiTyping, setAiTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  const prevMsgCount = useRef(0)

  // Check WhatsApp service health
  const checkStatus = useCallback(async () => {
    try {
      const res  = await fetch("/api/whatsapp/status")
      const data = await res.json()
      setReady(!!data.ready)
    } catch { setReady(false) }
  }, [])

  // Load conversations — one fast query, sorted by most recent message
  const loadLeads = useCallback(async () => {
    try {
      const res  = await fetch("/api/whatsapp/conversations")
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) {
        setLeads(data)
        if (data.length > 0 && !selected) setSelected(data[0])
      }
    } catch {}
  }, [selected])

  // Load messages for selected lead
  const loadMessages = useCallback(async (leadId: string, scroll = false) => {
    try {
      const res = await fetch(`/api/whatsapp/messages?leadId=${leadId}`)
      if (res.ok) {
        const data = await res.json()
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
    const t1 = setInterval(checkStatus, 8000)
    const t2 = setInterval(loadLeads, 4000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [])

  useEffect(() => {
    if (!selected) return
    loadMessages(selected.id, true)
    const t = setInterval(() => loadMessages(selected.id), 3000)
    return () => clearInterval(t)
  }, [selected?.id])

  async function send() {
    if (!text.trim() || !selected?.phone || sending) return
    const msg = text.trim()
    setText("")
    setSending(true)
    // Optimistic UI — show immediately
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

  async function aiReply() {
    if (!selected || aiTyping) return
    const lastInbound = [...messages].reverse().find(m => m.direction === "inbound")
    if (!lastInbound) { toast.info("No customer message to reply to"); return }
    setAiTyping(true)
    try {
      const history = messages.slice(-10).map(m => ({ role: m.direction === "inbound" ? "user" : "model", content: m.content }))
      const r       = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: lastInbound.content, language: "english", history }) })
      const { reply } = await r.json()
      if (!reply) throw new Error("No reply from AI")
      await fetch("/api/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: selected.phone, message: reply, leadId: selected.id }) })
      await loadMessages(selected.id)
      await loadLeads()
    } catch (e: any) { toast.error(`AI reply failed: ${e.message}`) }
    setAiTyping(false)
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

  const filtered = leads.filter(l =>
    l.name?.toLowerCase().includes(search.toLowerCase()) ||
    l.phone?.includes(search)
  )

  return (
    <div style={{ height: "calc(100vh - 120px)", display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "#111b21" }}>

      {/* Status warning - only show when service completely down */}
      {ready === false && (
        <div style={{ background: "#2a2a2a", borderBottom: "1px solid #333", padding: "8px 16px", fontSize: 12, color: "#f59e0b", display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} strokeWidth={2} style={{ flexShrink: 0 }} />
          <span>WhatsApp Cloud API not connected. Check <code style={{ background: "#111", padding: "1px 6px", borderRadius: 4 }}>WHATSAPP_TOKEN</code> and <code style={{ background: "#111", padding: "1px 6px", borderRadius: 4 }}>WHATSAPP_PHONE_NUMBER_ID</code> in .env</span>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* LEFT — Contact list */}
        <div style={{ width: 360, borderRight: "1px solid #2a3942", display: "flex", flexDirection: "column", background: "#111b21", flexShrink: 0 }}>

          {/* Header */}
          <div style={{ padding: "14px 16px", background: "#202c33", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: "#e9edef" }}>Chats</div>
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: ready ? "#25D366" : "#ef4444", marginTop: 6 }} title={ready ? "Connected" : "Disconnected"} />
              <span style={{ fontSize: 11, color: ready ? "#25D366" : "#ef4444", marginTop: 4 }}>{ready ? "Connected" : "Offline"}</span>
            </div>
          </div>

          {/* Search */}
          <div style={{ padding: "8px 12px", background: "#111b21", borderBottom: "1px solid #2a3942" }}>
            <div style={{ background: "#202c33", borderRadius: 8, display: "flex", alignItems: "center", padding: "6px 12px", gap: 8 }}>
              <Search size={15} strokeWidth={2} style={{ color: "#8696a0", flexShrink: 0 }} />
              <input
                placeholder="Search or start new chat"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e9edef", fontSize: 14, padding: 0 }}
              />
            </div>
          </div>

          {/* Contact list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filtered.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "#8696a0", fontSize: 13 }}>
                {search ? "No results" : "No contacts yet. Add leads first."}
              </div>
            )}
            {filtered.map(lead => (
              <div
                key={lead.id}
                onClick={() => {
                  setSelected(lead); setText("")
                  if (lead.unread) {
                    fetch("/api/whatsapp/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: lead.id }) }).then(() => loadLeads())
                  }
                }}
                style={{
                  padding: "12px 16px", cursor: "pointer",
                  background: selected?.id === lead.id ? "#2a3942" : "transparent",
                  borderBottom: "1px solid #2a3942",
                  display: "flex", alignItems: "center", gap: 12,
                  transition: "background 0.1s",
                }}
              >
                <div style={{ position: "relative" }}>
                  <Avatar name={lead.name} size={46} />
                  <span style={{ position: "absolute", bottom: 1, right: 1, width: 10, height: 10, borderRadius: "50%", background: "#25D366", border: "2px solid #111b21" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#e9edef", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{lead.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <div style={{ fontSize: 11, color: (lead.unread ?? 0) > 0 ? "#25D366" : "#8696a0" }}>{lead.last_message_time ? formatTime(lead.last_message_time) : ""}</div>
                      {(lead.unread ?? 0) > 0 && (
                        <span style={{ background: "#25D366", color: "#111b21", fontSize: 11, fontWeight: 700, borderRadius: 10, padding: "1px 7px", minWidth: 18, textAlign: "center" }}>{lead.unread}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#8696a0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {lead.last_message ? lead.last_message.slice(0, 45) : lead.phone}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — Chat window */}
        {selected ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#0b141a", minWidth: 0, backgroundImage: "radial-gradient(circle, #1a2530 1px, transparent 1px)", backgroundSize: "24px 24px" }}>

            {/* Chat header */}
            <div style={{ padding: "10px 16px", background: "#202c33", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2a3942" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar name={selected.name} size={40} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15, color: "#e9edef" }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: "#25D366" }}>{selected.phone}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={aiReply}
                  disabled={aiTyping || ready === false}
                  style={{ background: "rgba(37,211,102,0.15)", border: "1px solid rgba(37,211,102,0.3)", borderRadius: 8, padding: "6px 14px", color: "#25D366", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: (aiTyping || ready === false) ? 0.5 : 1 }}
                >
                  {aiTyping ? "Priya typing…" : <><Bot size={13} strokeWidth={2} style={{ display: "inline", verticalAlign: "-2px", marginRight: 5 }} />AI Reply</>}
                </button>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 10%", display: "flex", flexDirection: "column", gap: 4 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: "center", color: "#8696a0", fontSize: 13, marginTop: 60 }}>
                  No messages yet. Send the first one!
                </div>
              )}
              {messages.map((msg, i) => {
                const isOut = msg.direction === "outbound"
                const showDate = i === 0 || new Date(msg.created_at).toDateString() !== new Date(messages[i - 1].created_at).toDateString()
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div style={{ textAlign: "center", margin: "12px 0 8px" }}>
                        <span style={{ background: "#182229", color: "#8696a0", fontSize: 11, padding: "4px 12px", borderRadius: 8 }}>
                          {new Date(msg.created_at).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
                        </span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start", marginBottom: 2 }}>
                      <div style={{
                        maxWidth: "65%", borderRadius: isOut ? "8px 8px 0 8px" : "8px 8px 8px 0",
                        padding: "7px 12px 6px",
                        background: isOut ? "#005c4b" : "#202c33",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
                        position: "relative",
                      }}>
                        <div style={{ fontSize: 14, color: "#e9edef", lineHeight: 1.5, wordBreak: "break-word" }}>{msg.content}</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
                          <span style={{ fontSize: 11, color: "#8696a0" }}>{formatMsgTime(msg.created_at)}</span>
                          {isOut && <Tick status={msg.status} />}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {aiTyping && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ background: "#005c4b", borderRadius: "8px 8px 0 8px", padding: "10px 16px", color: "#8696a0", fontSize: 13 }}>
                    Priya is typing…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input — read-only role sees no composer at all */}
            {canEdit ? (
              <div style={{ padding: "10px 16px", background: "#202c33", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, background: "#2a3942", borderRadius: 10, display: "flex", alignItems: "center", padding: "0 14px", gap: 10 }}>
                  <input
                    ref={inputRef}
                    placeholder="Type a message"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
                    disabled={ready === false}
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e9edef", fontSize: 15, padding: "12px 0" }}
                  />
                </div>
                <button
                  onClick={send}
                  disabled={sending || !text.trim() || ready === false}
                  aria-label="Send message"
                  style={{ width: 46, height: 46, borderRadius: "50%", background: "#25D366", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#0b141a", cursor: "pointer", opacity: (sending || !text.trim() || ready === false) ? 0.5 : 1, flexShrink: 0 }}
                >
                  <Send size={19} strokeWidth={2.1} />
                </button>
              </div>
            ) : (
              <div style={{ padding: "14px 16px", background: "#202c33", textAlign: "center", color: "#8696a0", fontSize: 13 }}>
                View only — you don't have permission to send messages.
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0b141a", color: "#8696a0" }}>
            <MessageCircle size={56} strokeWidth={1.2} style={{ marginBottom: 16, opacity: 0.5 }} />
            <div style={{ fontSize: 18, fontWeight: 600, color: "#e9edef", marginBottom: 8 }}>WhatsApp Chat</div>
            <div style={{ fontSize: 14 }}>Select a contact to start messaging</div>
          </div>
        )}
      </div>
    </div>
  )
}
