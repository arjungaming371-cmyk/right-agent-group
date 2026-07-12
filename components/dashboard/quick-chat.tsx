"use client"
import { useState, useRef, useEffect } from "react"
import { MessageSquareText, Bot, X, Send, Sparkles, Plus, History, Trash2, ArrowLeft, MessageCircle } from "lucide-react"

type Message = { role: "user" | "assistant"; content: string }
type ChatSummary = { id: string; title: string; created_at: string; updated_at: string }

const GREETING: Message = { role: "assistant", content: "Hi! I'm the internal ops assistant with full read access to leads, calls, loan applications, WhatsApp activity, security, and the audit log. I'm not Priya, so I don't handle customer calls or messages — just reporting." }

const QUICK_COMMANDS = [
  { label: "How many leads today?", query: "How many new leads were added today?" },
  { label: "Pending calls", query: "How many calls are pending in the queue?" },
  { label: "Best performing language", query: "Which language has the most successful calls?" },
  { label: "Loan applications pending", query: "How many loan applications are pending?" },
]

function timeAgoShort(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function QuickChat() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"chat" | "history">("chat")
  const [messages, setMessages] = useState<Message[]>([GREETING])
  const [chatId, setChatId] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [chatsLoading, setChatsLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, open])

  async function loadChats() {
    setChatsLoading(true)
    try {
      const res = await fetch("/api/assistant/chats")
      const data = await res.json()
      setChats(data.chats || [])
    } catch {}
    setChatsLoading(false)
  }

  function openHistory() {
    setView("history")
    setConfirmDelete(null)
    loadChats()
  }

  function startNewChat() {
    setChatId(null)
    setMessages([GREETING])
    setView("chat")
  }

  async function openChat(c: ChatSummary) {
    setChatId(c.id)
    setView("chat")
    setLoading(true)
    try {
      const res = await fetch(`/api/assistant/chats/${c.id}`)
      const data = await res.json()
      const loaded: Message[] = (data.messages || []).map((m: any) => ({ role: m.role, content: m.content }))
      setMessages(loaded.length ? loaded : [GREETING])
    } catch {
      setMessages([GREETING])
    }
    setLoading(false)
  }

  async function deleteChat(id: string) {
    setChats(prev => prev.filter(c => c.id !== id))
    setConfirmDelete(null)
    if (chatId === id) startNewChat()
    await fetch(`/api/assistant/chats/${id}`, { method: "DELETE" }).catch(() => {})
  }

  async function send(text?: string) {
    const q = text ?? input
    if (!q.trim() || loading) return
    setInput("")
    const newMessages: Message[] = [...messages, { role: "user", content: q }]
    setMessages(newMessages)
    setLoading(true)

    try {
      // Lazily create the chat row on the first real message — never on
      // "New Chat" click, so switching chats without typing never leaves
      // empty clutter in the history list.
      let activeChatId = chatId
      if (!activeChatId) {
        const created = await fetch("/api/assistant/chats", { method: "POST" }).then(r => r.json())
        activeChatId = created.chat?.id || null
        if (activeChatId) setChatId(activeChatId)
      }

      const history = newMessages.slice(0, -1).map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        content: m.content,
      }))
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history, chatId: activeChatId }),
      })
      const data = await res.json()
      setMessages([...newMessages, { role: "assistant", content: data.reply || "Sorry, I couldn't process that." }])
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "Something went wrong. Please try again." }])
    }
    setLoading(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed", bottom: 24, right: 24, width: 56, height: 56, borderRadius: "50%",
          background: "var(--gradient-brand)", border: "none", color: "white",
          fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 8px 28px -6px rgba(79,124,255,0.55), 0 0 0 1px rgba(255,255,255,0.08)",
          cursor: "pointer", zIndex: 999, animation: "fadeInUp 0.3s ease",
        }}
        title="Quick AI Assistant"
      >
        <MessageSquareText size={22} strokeWidth={2} />
      </button>
    )
  }

  return (
    <div className="glass" style={{
      position: "fixed", bottom: 24, right: 24, width: 400, height: 560,
      borderRadius: 18, boxShadow: "0 20px 60px -12px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.05)",
      display: "flex", flexDirection: "column", zIndex: 999, overflow: "hidden",
      animation: "fadeInUp 0.2s ease",
    }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {view === "history" ? (
            <button onClick={() => setView("chat")} aria-label="Back to chat" style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
          ) : (
            <div style={{
              width: 30, height: 30, borderRadius: 9, background: "var(--gradient-brand)",
              display: "flex", alignItems: "center", justifyContent: "center", color: "white", flexShrink: 0,
            }}><Bot size={16} strokeWidth={2} /></div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
              {view === "history" ? "Chat History" : "Ops Assistant"} {view === "chat" && <Sparkles size={11} style={{ color: "#8b7cff" }} />}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{view === "history" ? `${chats.length} conversation${chats.length === 1 ? "" : "s"}` : "Internal only · Full data access"}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          {view === "chat" && (
            <>
              <button onClick={startNewChat} aria-label="New chat" title="New chat" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={16} strokeWidth={2} /></button>
              <button onClick={openHistory} aria-label="Chat history" title="Chat history" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><History size={16} strokeWidth={2} /></button>
            </>
          )}
          <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={16} strokeWidth={2} /></button>
        </div>
      </div>

      {view === "history" ? (
        /* ---------- History panel ---------- */
        <div style={{ flex: 1, overflowY: "auto" }}>
          <button onClick={startNewChat} style={{
            width: "calc(100% - 24px)", margin: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "9px 0", borderRadius: 10, background: "var(--bg-secondary)", border: "1px dashed var(--border)",
            color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 500, cursor: "pointer",
          }}><Plus size={13} strokeWidth={2} /> New chat</button>

          {chatsLoading && <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 12.5 }}>Loading…</div>}
          {!chatsLoading && chats.length === 0 && (
            <div style={{ padding: "24px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 12.5 }}>
              <MessageCircle size={22} strokeWidth={1.4} style={{ opacity: 0.5, marginBottom: 8 }} />
              <div>No past conversations yet.</div>
            </div>
          )}
          {chats.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border-light)" }}>
              <button onClick={() => openChat(c)} style={{ flex: 1, minWidth: 0, textAlign: "left", background: c.id === chatId ? "rgba(139,124,255,0.08)" : "transparent", border: "none", borderRadius: 8, padding: "6px 8px", cursor: "pointer" }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 1 }}>{timeAgoShort(c.updated_at)} ago</div>
              </button>
              {confirmDelete === c.id ? (
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button onClick={() => deleteChat(c.id)} style={{ fontSize: 10.5, fontWeight: 600, color: "#fb5670", background: "rgba(251,86,112,0.12)", border: "1px solid rgba(251,86,112,0.35)", borderRadius: 6, padding: "4px 7px" }}>Delete</button>
                  <button onClick={() => setConfirmDelete(null)} style={{ fontSize: 10.5, color: "var(--text-muted)", background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 7px" }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(c.id)} aria-label={`Delete ${c.title}`} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", width: 26, height: 26, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Trash2 size={13} strokeWidth={1.9} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* ---------- Chat panel ---------- */
        <>
          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "88%", padding: "9px 13px", borderRadius: 12, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap",
                  background: msg.role === "user" ? "var(--gradient-brand)" : "var(--bg-secondary)",
                  border: msg.role === "user" ? "none" : "1px solid var(--border)",
                  color: msg.role === "user" ? "white" : "var(--text-primary)",
                }}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ padding: "8px 12px", borderRadius: 10, background: "var(--bg-secondary)", display: "flex", gap: 4 }}>
                  {[0,1,2].map(i => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-muted)", animation: `bounce 1s ${i*0.15}s infinite` }} />)}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {messages.length <= 1 && (
            <div style={{ padding: "0 14px 10px", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {QUICK_COMMANDS.map(c => (
                <button key={c.label} onClick={() => send(c.query)} style={{
                  fontSize: 11, padding: "5px 10px", borderRadius: 14, background: "var(--bg-secondary)",
                  border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer",
                }}>{c.label}</button>
              ))}
            </div>
          )}

          <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Ask about leads, calls, loans…"
              style={{ flex: 1, fontSize: 13, height: 36 }}
            />
            <button onClick={() => send()} disabled={loading || !input.trim()} aria-label="Send" style={{
              width: 36, height: 36, borderRadius: 9, background: "var(--gradient-brand)", border: "none",
              color: "white", opacity: (loading || !input.trim()) ? 0.4 : 1, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}><Send size={15} strokeWidth={2} /></button>
          </div>
        </>
      )}
      <style>{`@keyframes bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }`}</style>
    </div>
  )
}
