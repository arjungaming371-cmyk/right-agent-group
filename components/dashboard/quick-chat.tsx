"use client"
import { useState, useRef, useEffect } from "react"
import {
  MessageSquareText, Bot, X, Send, Sparkles, Plus, History, Trash2, ArrowLeft,
  MessageCircle, Maximize2, Minimize2, Paperclip, CheckCircle2, FileText
} from "lucide-react"
import VoiceDictation from "../ui/voice-dictation"
import ChatMarkdown from "./chat-markdown"
import { useToast } from "../ui/toast"

type Message = {
  id?: string
  role: "user" | "assistant"
  content: string
  attachmentName?: string
  attachmentType?: string
  attachmentPreview?: string
}

type ChatSummary = { id: string; title: string; created_at: string; updated_at: string }
type UserRole = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

const GREETINGS: Record<UserRole, string> = {
  admin: "Hi! I'm the Operations Commander co-pilot. I answer questions about your leads, calls, loans, WhatsApp, and team using verified live data. How can I help?",
  agent: "Hi! I'm the ops assistant. I can help with leads, calls, scripts, and WhatsApp insights. What would you like to know?",
  viewer: "Hi! I'm the ops assistant. I can show you reporting and pipeline insights. What would you like to explore?",
  developer: "Hi! I'm the operations assistant. I answer questions about this system using verified live data. What would you like to know?",
  branch_manager: "Hi! I'm the ops assistant for your branch. I can help with your branch's leads, calls, scripts, and WhatsApp activity. How can I help?",
}

const QUICK_COMMANDS = [
  { label: "Pipeline Health", query: "Give me an executive summary breakdown of all leads, voice calls, and loan applications." },
  { label: "Today's Calls", query: "How many calls were placed today and what were the outcomes?" },
  { label: "WhatsApp Activity", query: "Summarize today's WhatsApp conversations and active chats." },
  { label: "Hot Leads", query: "Show me the top high-scoring leads that need attention." },
  { label: "Draft Script", query: "Draft a high-converting calling script for Priya for balance transfer home loans." },
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
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState<"chat" | "history">("chat")
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  // Attachment state
  const [attachedFile, setAttachedFile] = useState<{ name: string; type: string; content?: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    function onResize() {
      setPos(prev => (prev ? clamp(prev.x, prev.y) : prev))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

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
    if (!wasDrag) setOpen(true)
  }

  const toast = useToast()
  const greeting: Message = { role: "assistant", content: GREETINGS[role] || GREETINGS.agent }
  const [messages, setMessages] = useState<Message[]>([greeting])
  const [chatId, setChatId] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [chatsLoading, setChatsLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const streamEpochRef = useRef(0)

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
    streamEpochRef.current += 1
    setLoading(false)
    setChatId(null)
    setMessages([greeting])
    setView("chat")
  }

  async function openChat(c: ChatSummary) {
    const epoch = ++streamEpochRef.current
    setChatId(c.id)
    setView("chat")
    setLoading(true)
    try {
      const res = await fetch(`/api/assistant/chats/${c.id}`)
      const data = await res.json()
      const loaded: Message[] = (data.messages || []).map((m: any) => ({ role: m.role, content: m.content }))
      if (epoch !== streamEpochRef.current) return
      setMessages(loaded.length ? loaded : [greeting])
    } catch {
      if (epoch !== streamEpochRef.current) return
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

  // Handle file selection (Images, PDFs, CSV, Text)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type.startsWith("image/")) {
      const reader = new FileReader()
      reader.onload = () => {
        setAttachedFile({
          name: file.name,
          type: "image",
          content: reader.result as string,
        })
      }
      reader.readAsDataURL(file)
    } else {
      const reader = new FileReader()
      reader.onload = () => {
        setAttachedFile({
          name: file.name,
          type: file.type.includes("pdf") ? "pdf" : file.type.includes("csv") ? "csv" : "document",
          content: (reader.result as string).slice(0, 8000),
        })
      }
      reader.readAsText(file)
    }
  }

  async function send(text?: string) {
    const q = text ?? input
    if ((!q.trim() && !attachedFile) || loading) return
    const epoch = ++streamEpochRef.current
    const currentAttachment = attachedFile
    setInput("")
    setAttachedFile(null)

    const newMessages: Message[] = [
      ...messages,
      {
        role: "user",
        content: q || (currentAttachment ? `Attached: ${currentAttachment.name}` : ""),
        attachmentName: currentAttachment?.name,
        attachmentType: currentAttachment?.type,
        attachmentPreview: currentAttachment?.type === "image" ? currentAttachment.content : undefined,
      }
    ]
    setMessages(newMessages)
    setLoading(true)

    try {
      let activeChatId = chatId
      if (!activeChatId) {
        const created = await fetch("/api/assistant/chats", { method: "POST", body: JSON.stringify({ role }) }).then(r => r.json())
        activeChatId = created.chat?.id || null
        if (activeChatId && epoch === streamEpochRef.current) setChatId(activeChatId)
      }

      const history = newMessages.slice(0, -1).map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        content: m.content,
      }))

      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q || "Please inspect the attached file.",
          history,
          chatId: activeChatId,
          role,
          userEmail,
          attachment: currentAttachment
        }),
      })

      if (!res.body) throw new Error("no response stream")
      if (epoch !== streamEpochRef.current) return

      setMessages([...newMessages, { role: "assistant", content: "" }])
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (epoch !== streamEpochRef.current) {
          reader.cancel().catch(() => {})
          return
        }
        acc += decoder.decode(value, { stream: true })
        const textSoFar = acc
        setMessages(prev => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: "assistant", content: textSoFar }
          return copy
        })
      }

      if (epoch !== streamEpochRef.current) return
      if (!acc.trim()) {
        setMessages(prev => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: "assistant", content: "Sorry, I couldn't process that." }
          return copy
        })
      }
    } catch {
      if (epoch === streamEpochRef.current) {
        setMessages([...newMessages, { role: "assistant", content: "Something went wrong. Please try again." }])
      }
    } finally {
      if (epoch === streamEpochRef.current) setLoading(false)
    }
  }

  if (!open) {
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
          boxShadow: dragging ? "0 12px 36px -6px rgba(79,124,255,0.7), 0 0 0 1px var(--overlay-line)" : "0 8px 28px -6px rgba(79,124,255,0.55), 0 0 0 1px var(--overlay-chip)",
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
    <>
      {/* Background overlay when expanded */}
      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(3px)", zIndex: 998
          }}
        />
      )}

      <div style={{
        position: "fixed",
        background: "var(--bg-card, #0f121d)",
        border: "1px solid var(--border)",
        ...(expanded
          ? {
              top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              width: "min(1040px, 94vw)", height: "min(840px, 90vh)",
              maxWidth: "none", maxHeight: "none", margin: 0,
            }
          : {
              bottom: 12, right: 12, left: "auto", top: "auto",
              width: 420, height: 600, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100vh - 24px)",
            }),
        borderRadius: 18, boxShadow: "0 24px 70px -12px rgba(0,0,0,0.75), 0 0 0 1px var(--overlay-hover)",
        display: "flex", flexDirection: "column", zIndex: 999, overflow: "hidden",
        animation: "fadeInUp 0.2s ease", transition: "width 0.2s ease, height 0.2s ease",
      }}>
        {/* Header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {view === "history" ? (
              <button onClick={() => setView("chat")} aria-label="Back to chat" style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <ArrowLeft size={16} strokeWidth={2} />
              </button>
            ) : (
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--gradient-brand)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", flexShrink: 0 }}>
                <Bot size={17} strokeWidth={2} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                  {view === "history" ? "Chat History" : "AI Operations Commander"}
                </span>
                {expanded && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                    padding: "2px 7px", borderRadius: 5, background: "rgba(99, 102, 241, 0.2)",
                    color: "#a5b4fc", border: "1px solid rgba(99, 102, 241, 0.35)", textTransform: "uppercase"
                  }}>
                    Executive Workspace
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                <Sparkles size={10} style={{ color: "var(--accent-cyan)" }} />
                <span>Commands & Actions require Admin Approval</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {view === "chat" && (
              <>
                <button
                  onClick={startNewChat}
                  aria-label="New chat"
                  title="New chat"
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <Plus size={16} strokeWidth={2} />
                </button>
                <button
                  onClick={openHistory}
                  aria-label="Chat history"
                  title="Chat history"
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <History size={15} strokeWidth={2} />
                </button>
                <button
                  onClick={() => setExpanded(!expanded)}
                  aria-label={expanded ? "Minimize window" : "Maximize window"}
                  title={expanded ? "Minimize window" : "Maximize to full workspace"}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {expanded ? <Minimize2 size={16} strokeWidth={2} /> : <Maximize2 size={16} strokeWidth={2} />}
                </button>
              </>
            )}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              title="Close"
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Body */}
        {view === "history" ? (
          /* ---------- History list ---------- */
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
            <button onClick={startNewChat} style={{
              width: "100%", padding: "9px 12px", borderRadius: 9, background: "var(--gradient-brand)",
              border: "none", color: "white", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 8,
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
                  <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 1 }}>{timeAgoShort(c.updated_at) === "now" ? "now" : `${timeAgoShort(c.updated_at)} ago`}</div>
                </button>
                {confirmDelete === c.id ? (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => deleteChat(c.id)} style={{ fontSize: 10.5, fontWeight: 600, color: "var(--accent-red)", background: "rgba(251,86,112,0.12)", border: "1px solid rgba(251,86,112,0.35)", borderRadius: 6, padding: "4px 7px" }}>Delete</button>
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
            <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.map((msg, i) => {
                const isPendingStream = loading && i === messages.length - 1 && msg.role === "assistant" && msg.content === ""

                return (
                  <div key={msg.id || (msg.id = `qc-${i}-${msg.role}`)} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 4 }}>
                    <div style={{
                      maxWidth: expanded ? "82%" : "90%",
                      padding: isPendingStream ? "10px 14px" : "10px 14px",
                      borderRadius: 13,
                      fontSize: expanded ? 13.5 : 13,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      background: msg.role === "user" ? "var(--gradient-brand)" : "var(--bg-secondary)",
                      border: msg.role === "user" ? "none" : "1px solid var(--border)",
                      color: msg.role === "user" ? "white" : "var(--text-primary)",
                      boxShadow: msg.role === "user" ? "0 2px 8px rgba(79,124,255,0.25)" : "none",
                    }}>
                      {/* User image preview */}
                      {msg.attachmentPreview && (
                        <img
                          src={msg.attachmentPreview}
                          alt={msg.attachmentName || "attachment"}
                          style={{ maxHeight: 180, maxWidth: "100%", borderRadius: 8, marginBottom: 8, objectFit: "cover", display: "block", border: "1px solid rgba(255,255,255,0.2)" }}
                        />
                      )}
                      {/* Document chip */}
                      {msg.attachmentName && !msg.attachmentPreview && (
                        <div style={{
                          display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px",
                          borderRadius: 6, background: "rgba(255,255,255,0.18)", fontSize: 11, marginBottom: 6
                        }}>
                          <Paperclip size={12} /> {msg.attachmentName}
                        </div>
                      )}
                      {isPendingStream ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          {[0,1,2].map(d => <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-muted)", animation: `bounce 1s ${d*0.15}s infinite` }} />)}
                        </div>
                      ) : msg.role === "assistant" ? (
                        // Commander replies render as real markdown (bold,
                        // lists, code, verification chip) — never raw symbols
                        <ChatMarkdown content={msg.content} />
                      ) : (
                        msg.content
                      )}
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

            {/* Attached file preview banner */}
            {attachedFile && (
              <div style={{
                padding: "6px 12px", background: "var(--bg-secondary)", borderTop: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {attachedFile.type === "image" && attachedFile.content ? (
                    <img
                      src={attachedFile.content}
                      alt={attachedFile.name}
                      style={{ width: 28, height: 28, borderRadius: 5, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }}
                    />
                  ) : (
                    <FileText size={16} style={{ color: "var(--accent-cyan)", flexShrink: 0 }} />
                  )}
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {attachedFile.name}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>
                    ({attachedFile.type})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachedFile(null)}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4 }}
                  aria-label="Remove attachment"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Input toolbar */}
            <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center" }}>
              {/* File Attachment Button */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*,.pdf,.csv,.txt,.json"
                style={{ display: "none" }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach image or file"
                aria-label="Attach file"
                style={{
                  width: 36, height: 36, borderRadius: 9, background: "transparent",
                  border: "1px solid var(--border)", color: "var(--text-muted)",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
                }}
              >
                <Paperclip size={15} />
              </button>

              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && send()}
                placeholder="Ask or command: scripts, leads, KB…"
                style={{ flex: 1, fontSize: 13, height: 36 }}
              />

              {/* Working Voice Dictation Mic */}
              <VoiceDictation
                onTranscript={(spoken: string) => {
                  setInput(prev => (prev ? `${prev} ${spoken}` : spoken))
                }}
                size={15}
                style={{ width: 36, height: 36, borderRadius: 9 }}
                title="Speak to type"
              />

              <button
                onClick={() => send()}
                disabled={loading || (!input.trim() && !attachedFile)}
                aria-label="Send"
                style={{
                  width: 36, height: 36, borderRadius: 9, background: "var(--gradient-brand)", border: "none",
                  color: "white", opacity: (loading || (!input.trim() && !attachedFile)) ? 0.4 : 1, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: (loading || (!input.trim() && !attachedFile)) ? "not-allowed" : "pointer"
                }}
              >
                <Send size={15} strokeWidth={2} />
              </button>
            </div>
          </>
        )}
        <style>{`@keyframes bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }`}</style>
      </div>
    </>
  )
}
