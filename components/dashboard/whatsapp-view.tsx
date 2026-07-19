"use client"
import { useEffect, useRef, useState, useCallback } from "react"
import { Search, Send, Bot, MessageCircle, AlertTriangle, ChevronLeft, CheckCircle2, Zap, Lock } from "lucide-react"
import { useToast } from "../ui/toast"

type Lead = { id: string; name: string; phone: string; last_message?: string; last_message_time?: string; last_direction?: string; unread?: number }
type Msg  = { id: string; direction: string; content: string; created_at: string; status?: string }

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = (name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
  const colors = ["#10b981", "#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899"]
  const bg = colors[(name || "?").charCodeAt(0) % colors.length]
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.32, fontWeight: 700, color: "white", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
      {initials}
    </div>
  )
}

function Tick({ status }: { status?: string }) {
  if (status === "sent") return <span style={{ color: "#9ca3af" }}>✓</span>
  if (status === "delivered") return <span style={{ color: "#9ca3af" }}>✓✓</span>
  if (status === "read") return <span style={{ color: "#10b981" }}>✓✓</span>
  return <span style={{ color: "#9ca3af" }}>✓</span>
}

export default function WhatsAppView({ role }: { role: "admin" | "agent" | "viewer" | "developer" }) {
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
        if (data.length > 0 && !selected) setSelected(data[0])
      }
    } catch {}
  }, [selected])

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
    <div style={{ height: "calc(100vh - 120px)", display: "flex", flexDirection: "column", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "linear-gradient(135deg, #0f172a 0%, #1a1f35 100%)", boxShadow: "0 20px 40px rgba(0,0,0,0.3)" }}>

      {/* TOP STATUS BANNER — Modern, sleek design */}
      <div style={{ background: "linear-gradient(90deg, #10b981 0%, #059669 100%)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid rgba(0,0,0,0.2)" }}>
        <CheckCircle2 size={18} strokeWidth={2.5} style={{ color: "white", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "white" }}>WhatsApp Connected & Configured</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 2 }}>Authentication keys provided • Auto-reply enabled • Real-time messaging active</div>
        </div>
        <Zap size={16} style={{ color: "white", opacity: 0.8, flexShrink: 0 }} />
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* LEFT — Contact list */}
        <div
          className={`${selected ? "hidden md:flex" : "flex"} w-full md:w-[320px]`}
          style={{ borderRight: "1px solid rgba(255,255,255,0.08)", flexDirection: "column", background: "rgba(15,23,42,0.6)", flexShrink: 0, backdropFilter: "blur(10px)" }}
        >

          {/* Header */}
          <div style={{ padding: "18px 16px", background: "rgba(30,41,59,0.8)", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontWeight: 700, fontSize: 20, color: "#f1f5f9" }}>Messages</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: ready ? "#10b981" : "#ef4444", animation: ready ? "pulse 2s infinite" : "none" }} title={ready ? "Connected" : "Disconnected"} />
              <span style={{ fontSize: 11, fontWeight: 500, color: ready ? "#10b981" : "#ef4444" }}>{ready ? "Live" : "Offline"}</span>
            </div>
          </div>

          {/* Search */}
          <div style={{ padding: "12px 12px", background: "transparent", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ background: "rgba(30,41,59,0.8)", borderRadius: 12, display: "flex", alignItems: "center", padding: "10px 14px", gap: 10, border: "1px solid rgba(255,255,255,0.1)" }}>
              <Search size={16} strokeWidth={2} style={{ color: "#94a3b8", flexShrink: 0 }} />
              <input
                placeholder="Search contacts..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", fontSize: 14, padding: 0 }}
              />
            </div>
          </div>

          {/* Contact list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filtered.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 13 }}>
                {search ? "No matches found" : "No active conversations"}
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
                  padding: "12px 12px", cursor: "pointer", margin: "4px 8px", borderRadius: 10,
                  background: selected?.id === lead.id ? "rgba(16,185,129,0.15)" : "transparent",
                  border: selected?.id === lead.id ? "1px solid rgba(16,185,129,0.3)" : "1px solid transparent",
                  display: "flex", alignItems: "center", gap: 12,
                  transition: "all 0.2s ease",
                }}
              >
                <Avatar name={lead.name} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name}</div>
                    <div style={{ fontSize: 11, color: (lead.unread ?? 0) > 0 ? "#10b981" : "#64748b", flexShrink: 0 }}>{lead.last_message_time ? formatTime(lead.last_message_time) : ""}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(lead.unread ?? 0) > 0 && <span style={{ fontWeight: 600, color: "#10b981" }}>●</span>} {lead.last_message ? lead.last_message.slice(0, 40) : lead.phone}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — Chat window */}
        {selected ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "rgba(15,23,42,0.8)", minWidth: 0 }}>

            {/* Chat header */}
            <div style={{ padding: "14px 18px", background: "rgba(30,41,59,0.8)", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                <button
                  onClick={() => setSelected(null)}
                  className="md:hidden"
                  style={{ background: "transparent", border: "none", color: "#f1f5f9", cursor: "pointer", display: "flex", padding: 4, marginRight: 4, flexShrink: 0 }}
                >
                  <ChevronLeft size={22} strokeWidth={2} />
                </button>
                <Avatar name={selected.name} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: "#64748b", display: "flex", gap: 4, alignItems: "center", marginTop: 2 }}>
                    <Lock size={10} style={{ flexShrink: 0 }} /> End-to-end encrypted
                  </div>
                </div>
              </div>
              <button
                onClick={aiReply}
                disabled={aiTyping || ready === false}
                style={{ background: ready ? "linear-gradient(135deg, #10b981 0%, #059669 100%)" : "rgba(107,114,128,0.3)", border: "none", borderRadius: 10, padding: "8px 16px", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: (aiTyping || ready === false) ? 0.6 : 1, display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s ease", boxShadow: ready ? "0 4px 12px rgba(16,185,129,0.3)" : "none" }}
              >
                <Bot size={14} strokeWidth={2} style={{ flexShrink: 0 }} />
                {aiTyping ? "Priya typing…" : "AI Reply"}
              </button>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: "center", color: "#64748b", fontSize: 14, marginTop: 80 }}>
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
                        <span style={{ background: "rgba(30,41,59,0.8)", color: "#64748b", fontSize: 12, padding: "6px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)" }}>
                          {new Date(msg.created_at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
                        </span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start", marginBottom: 4 }}>
                      <div style={{
                        maxWidth: "70%", borderRadius: isOut ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                        padding: "10px 14px",
                        background: isOut ? "linear-gradient(135deg, #10b981 0%, #059669 100%)" : "rgba(30,41,59,0.8)",
                        boxShadow: isOut ? "0 4px 12px rgba(16,185,129,0.2)" : "0 2px 8px rgba(0,0,0,0.2)",
                        position: "relative",
                        wordBreak: "break-word"
                      }}>
                        <div style={{ fontSize: 15, color: isOut ? "white" : "#f1f5f9", lineHeight: 1.4 }}>{msg.content}</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: isOut ? "rgba(255,255,255,0.7)" : "#94a3b8" }}>{formatMsgTime(msg.created_at)}</span>
                          {isOut && <Tick status={msg.status} />}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {aiTyping && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", borderRadius: "16px 16px 4px 16px", padding: "12px 16px", color: "white", fontSize: 13 }}>
                    Priya is thinking…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            {canEdit ? (
              <div style={{ padding: "14px 16px", background: "rgba(30,41,59,0.8)", display: "flex", alignItems: "flex-end", gap: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ flex: 1, background: "rgba(15,23,42,0.6)", borderRadius: 14, display: "flex", alignItems: "center", padding: "0 14px", gap: 10, border: "1px solid rgba(255,255,255,0.1)" }}>
                  <input
                    ref={inputRef}
                    placeholder="Type your message…"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
                    disabled={ready === false}
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", fontSize: 15, padding: "12px 0", minHeight: 40 }}
                  />
                </div>
                <button
                  onClick={send}
                  disabled={sending || !text.trim() || ready === false}
                  style={{ width: 44, height: 44, borderRadius: "12px", background: ready ? "linear-gradient(135deg, #10b981 0%, #059669 100%)" : "rgba(107,114,128,0.3)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "white", cursor: "pointer", opacity: (sending || !text.trim() || ready === false) ? 0.6 : 1, flexShrink: 0, transition: "all 0.2s ease", boxShadow: ready && text.trim() ? "0 4px 12px rgba(16,185,129,0.3)" : "none" }}
                >
                  <Send size={18} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <div style={{ padding: "14px 16px", background: "rgba(30,41,59,0.8)", textAlign: "center", color: "#64748b", fontSize: 13, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                View only — no send permission
              </div>
            )}
          </div>
        ) : (
          <div className="hidden md:flex" style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.8)", color: "#64748b" }}>
            <MessageCircle size={64} strokeWidth={1} style={{ marginBottom: 20, opacity: 0.3 }} />
            <div style={{ fontSize: 20, fontWeight: 600, color: "#f1f5f9", marginBottom: 8 }}>Select a conversation</div>
            <div style={{ fontSize: 14 }}>Choose a contact to start messaging</div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  )
}
