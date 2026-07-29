"use client"
import { useState, useRef, useEffect } from "react"
import { MessageSquareText, Bot, X, Send, Sparkles, Plus, History, Trash2, ArrowLeft, MessageCircle } from "lucide-react"

type Message = { role: "user" | "assistant"; content: string }
type ChatSummary = { id: string; title: string; created_at: string; updated_at: string }
type UserRole = "admin" | "agent" | "viewer" | "developer"

const GREETINGS: Record<UserRole, string> = {
  admin: "Hi! I'm the ops assistant with full read access to leads, calls, loan applications, WhatsApp activity, security, analytics, and the audit log. How can I help you today?",
  agent: "Hi! I'm the ops assistant. I can help with leads, calls, and WhatsApp insights. What would you like to know?",
  viewer: "Hi! I'm the ops assistant. I can show you reporting and insights. What would you like to know?",
  developer: "Hi! I'm your private developer assistant with full console access. I can help with system queries, logs, and development tasks. This chat is private and hidden from admins.",
}

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

const POS_KEY = "opsAssistantFabPos"
const FAB_SIZE = 56
const EDGE_MARGIN = 24
const DRAG_THRESHOLD = 6 // px of movement before a press counts as a drag, not a click

export default function QuickChat({ role = "agent", userEmail = "" }: { role?: UserRole; userEmail?: string }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"chat" | "history">("chat")
  // Button position — null means "not placed yet, use the default corner".
  // Persisted so it stays wherever you last dragged it, across reloads.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  function clamp(x: number, y: number) {
    const maxX = window.innerWidth - FAB_SIZE - 8
    const maxY = window.innerHeight - FAB_SIZE - 8
    return { x: Math.min(Math.max(8, x), Math.max(8, maxX)), y: Math.min(Math.max(8, y), Math.max(8, maxY)) }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(POS_KEY)
      if (saved) {
        const p = JSON.parse(saved)
        if (typeof p?.x === "number" && typeof p?.y === "number") setPos(clamp(p.x, p.y))
      }
    } catch {}
    // Keep the button on-screen if the window is resized/rotated after being dragged.
    function onResize() {
      setPos(prev => (prev ? clamp(prev.x, prev.y) : prev))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function startDrag(clientX: number, clientY: number) {
    const rect = { x: pos?.x ?? window.innerWidth - FAB_SIZE - EDGE_MARGIN, y: pos?.y ?? window.innerHeight - FAB_SIZE - EDGE_MARGIN }
    dragRef.current = { startX: clientX, startY: clientY, origX: rect.x, origY: rect.y, moved: false }
    setDragging(true)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragRef.current.moved = true
    setPos(clamp(dragRef.current.origX + dx, dragRef.current.origY + dy))
  }

  function onPointerUp(e: React.PointerEvent) {
    const wasDrag = dragRef.current?.moved
    setDragging(false)
    if (wasDrag && pos) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch {}
    }
    dragRef.current = null
    if (!wasDrag) setOpen(true) // a real click (no meaningful movement) opens the assistant
  }
  const greeting: Message = { role: "assistant", content: GREETINGS[role] || GREETINGS.agent }
  const [messages, setMessages] = useState<Message[]>([greeting])
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
    setMessages([greeting])
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
      setMessages(loaded.length ? loaded : [greeting])
    } catch {
      setMessages([greeting])
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
        const created = await fetch("/api/assistant/chats", { method: "POST", body: JSON.stringify({ role }) }).then(r => r.json())
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
        body: JSON.stringify({ message: q, history, chatId: activeChatId, role, userEmail }),
      })
      if (!res.body) throw new Error("no response stream")

      // Streaming reply — append a growing placeholder and fill it in as
      // chunks arrive, instead of waiting 20-50s for the whole thing.
      setMessages([...newMessages, { role: "assistant", content: "" }])
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        const textSoFar = acc
        setMessages(prev => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: "assistant", content: textSoFar }
          return copy
        })
      }
      if (!acc.trim()) {
        setMessages(prev => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: "assistant", content: "Sorry, I couldn't process that." }
          return copy
        })
      }
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "Something went wrong. Please try again." }])
    }
    setLoading(false)
  }

  if (!open) {
    // Undragged default: bottom-right corner, same as before. Once pos is
    // set (from a drag, or restored from localStorage), it overrides top/left
    // and drops the bottom/right anchors entirely.
    const posStyle = pos
      ? { top: pos.y, left: pos.x }
      : { bottom: EDGE_MARGIN, right: EDGE_MARGIN }
    return (
      <button
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startDrag(e.clientX, e.clientY) }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "fixed", ...posStyle, width: FAB_SIZE, height: FAB_SIZE, borderRadius: "50%",
          background: "var(--gradient-brand)", border: "none", color: "white",
          fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: dragging ? "0 12px 36px -6px rgba(79,124,255,0.7), 0 0 0 1px rgba(255,255,255,0.12)" : "0 8px 28px -6px rgba(79,124,255,0.55), 0 0 0 1px rgba(255,255,255,0.08)",
          cursor: dragging ? "grabbing" : "grab", zIndex: 999,
          animation: pos ? "none" : "fadeInUp 0.3s ease",
          touchAction: "none", userSelect: "none",
          transform: dragging ? "scale(1.06)" : "scale(1)", transition: dragging ? "none" : "transform 0.15s ease",
        }}
        title="Quick AI Assistant — drag to move"
      >
        <MessageSquareText size={22} strokeWidth={2} />
      </button>
    )
  }

  return (
    <div className="glass" style={{
      position: "fixed", bottom: 12, right: 12, left: 12, top: 12,
      width: "auto", height: "auto", maxWidth: 400, maxHeight: 560,
      marginLeft: "auto", marginTop: "auto",
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
            {messages.map((msg, i) => {
              // Streaming placeholder: last message, empty, still loading —
              // show the bounce dots in place of blank text.
              const isPendingStream = loading && i === messages.length - 1 && msg.role === "assistant" && msg.content === ""
              return (
                <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "88%", padding: isPendingStream ? "10px 13px" : "9px 13px", borderRadius: 12, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap",
                    background: msg.role === "user" ? "var(--gradient-brand)" : "var(--bg-secondary)",
                    border: msg.role === "user" ? "none" : "1px solid var(--border)",
                    color: msg.role === "user" ? "white" : "var(--text-primary)",
                  }}>
                    {isPendingStream ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        {[0,1,2].map(d => <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-muted)", animation: `bounce 1s ${d*0.15}s infinite` }} />)}
                      </div>
                    ) : msg.content}
                  </div>
                </div>
              )
            })}
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
