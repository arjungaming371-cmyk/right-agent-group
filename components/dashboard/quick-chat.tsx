"use client"
import { useState, useRef, useEffect } from "react"
import {
  MessageSquareText, Bot, X, Send, Sparkles, Plus, History, Trash2, ArrowLeft,
  MessageCircle, Maximize2, Minimize2, Paperclip, Shield, ShieldCheck, CheckCircle2,
  Lock, ChevronDown, ChevronUp, Loader2, FileText, Mic
} from "lucide-react"
import VoiceDictation from "../ui/voice-dictation"
import { useToast } from "../ui/toast"

type Message = {
  role: "user" | "assistant"
  content: string
  attachmentName?: string
  attachmentType?: string
  attachmentPreview?: string
}

type ChatSummary = { id: string; title: string; created_at: string; updated_at: string }
type UserRole = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

export type ActionProposal = {
  type: string
  title: string
  description: string
  payload: any
}

export type ActionStatus = "pending" | "executing" | "approved" | "rejected" | "error"

const GREETINGS: Record<UserRole, string> = {
  admin: "Hi! I'm the Executive Operations Commander with full command access across leads, scripts, knowledge base, calls, loans, WhatsApp, compliance, and security. What command or task can I execute for you?",
  agent: "Hi! I'm the ops assistant. I can help with leads, calls, scripts, and WhatsApp insights. What would you like to know?",
  viewer: "Hi! I'm the ops assistant. I can show you reporting and pipeline insights. What would you like to explore?",
  developer: "Hi! I'm your private developer assistant with console & database command access. All actions require your explicit admin approval before executing.",
  branch_manager: "Hi! I'm the ops assistant for your branch. I can help with your branch's leads, calls, scripts, and WhatsApp activity. How can I help?",
}

const QUICK_COMMANDS = [
  { label: "✍️ Write Calling Script", query: "Write a complete high-converting Universal calling script for Priya for personal and business loans with objection handling." },
  { label: "📚 Add Home Loan KB", query: "Draft and add a Knowledge Base entry for Home Loan eligibility, interest rates, and required KYC documents." },
  { label: "➕ Add New Lead", query: "Add a new lead to the pipeline: Rahul Verma, phone 9876543210, looking for Personal Loan of 5 Lakhs." },
  { label: "📊 Pipeline Health", query: "Give me an executive summary breakdown of all leads, voice calls, and loan applications." },
  { label: "🛡️ DND Suppression", query: "Add phone number 9999988888 to the DND suppression list." },
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

function extractActionProposal(content: string): { cleanText: string; proposal: ActionProposal | null } {
  if (!content) return { cleanText: "", proposal: null }
  const match = content.match(/```(?:action:proposal|json:action|action)\s*([\s\S]*?)\s*```/)
  if (!match) return { cleanText: content, proposal: null }
  try {
    const parsed = JSON.parse(match[1].trim())
    if (parsed && parsed.type) {
      return {
        cleanText: content.replace(match[0], "").trim(),
        proposal: {
          type: parsed.type,
          title: parsed.title || parsed.type,
          description: parsed.description || "",
          payload: parsed.payload || {},
        },
      }
    }
  } catch {}
  return { cleanText: content, proposal: null }
}

function ActionApprovalCard({
  proposal,
  role,
  onApprove,
  onReject,
  actionState,
}: {
  proposal: ActionProposal
  role: UserRole
  onApprove: () => void
  onReject: () => void
  actionState?: { status: ActionStatus; error?: string; executedAt?: string }
}) {
  const [showPayload, setShowPayload] = useState(false)
  const isAdmin = role === "admin" || role === "developer"
  const status = actionState?.status || "pending"

  const typeConfig: Record<string, { label: string; color: string; bg: string }> = {
    update_script: { label: "Script Command", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)" },
    add_kb_entry: { label: "Knowledge Base", color: "#10b981", bg: "rgba(16, 185, 129, 0.15)" },
    update_kb_entry: { label: "KB Update", color: "#10b981", bg: "rgba(16, 185, 129, 0.15)" },
    delete_kb_entry: { label: "KB Delete", color: "#ef4444", bg: "rgba(239, 68, 68, 0.15)" },
    add_lead: { label: "Add Lead", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)" },
    update_lead: { label: "Lead Update", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)" },
    update_loan: { label: "Loan Application", color: "#8b5cf6", bg: "rgba(139, 92, 246, 0.15)" },
    add_dnd: { label: "Compliance DND", color: "#f43f5e", bg: "rgba(244, 63, 94, 0.15)" },
    remove_dnd: { label: "Remove DND", color: "#10b981", bg: "rgba(16, 185, 129, 0.15)" },
    toggle_security: { label: "Security Setting", color: "#eab308", bg: "rgba(234, 179, 8, 0.15)" },
  }

  const cfg = typeConfig[proposal.type] || { label: "Admin Action", color: "#818cf8", bg: "rgba(129, 140, 248, 0.15)" }

  return (
    <div style={{
      marginTop: 10,
      borderRadius: 12,
      border: "1px solid rgba(129, 140, 248, 0.35)",
      background: "linear-gradient(135deg, rgba(20, 27, 45, 0.88), rgba(12, 16, 28, 0.96))",
      padding: "13px 15px",
      boxShadow: "0 8px 24px -4px rgba(0, 0, 0, 0.45)",
    }}>
      {/* Header bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Shield size={15} style={{ color: cfg.color }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: "#c7d2fe", textTransform: "uppercase" }}>
            Admin Command Approval
          </span>
        </div>
        <span style={{
          fontSize: 10.5, fontWeight: 650, padding: "2px 8px", borderRadius: 6,
          background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33`
        }}>
          {cfg.label}
        </span>
      </div>

      {/* Action Title & Description */}
      <div style={{ fontSize: 13.5, fontWeight: 650, color: "var(--text-primary)", marginBottom: 4 }}>
        {proposal.title}
      </div>
      {proposal.description && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45, marginBottom: 8 }}>
          {proposal.description}
        </div>
      )}

      {/* Payload summary toggle */}
      <button
        type="button"
        onClick={() => setShowPayload(!showPayload)}
        style={{
          background: "none", border: "none", padding: 0,
          color: "#818cf8", fontSize: 11.5, fontWeight: 500,
          cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
          marginBottom: showPayload ? 8 : 0
        }}
      >
        {showPayload ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {showPayload ? "Hide details" : "View details"}
      </button>

      {showPayload && (
        <div style={{
          marginTop: 6, marginBottom: 8, padding: "8px 10px", borderRadius: 8,
          background: "rgba(0,0,0,0.35)", border: "1px solid var(--border)",
          fontSize: 11, fontFamily: "ui-monospace, monospace", color: "var(--text-secondary)",
          maxHeight: 180, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word"
        }}>
          {proposal.type === "update_script" && proposal.payload?.content ? (
            <div>
              <div style={{ fontWeight: 600, color: "#818cf8", marginBottom: 4 }}>
                Target: {proposal.payload.language || "base"} script ({proposal.payload.content.length} characters)
              </div>
              <div>{proposal.payload.content.slice(0, 450)}{proposal.payload.content.length > 450 ? "..." : ""}</div>
            </div>
          ) : proposal.type === "add_lead" ? (
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px" }}>
              <span style={{ color: "var(--text-muted)" }}>Name:</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{proposal.payload.name || "—"}</span>
              <span style={{ color: "var(--text-muted)" }}>Phone:</span>
              <span style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>{proposal.payload.phone || "—"}</span>
              <span style={{ color: "var(--text-muted)" }}>Product:</span>
              <span>{proposal.payload.product_interest || "—"}</span>
              <span style={{ color: "var(--text-muted)" }}>Amount:</span>
              <span>{proposal.payload.loan_amount ? `₹${Number(proposal.payload.loan_amount).toLocaleString("en-IN")}` : "—"}</span>
              {proposal.payload.notes && (
                <>
                  <span style={{ color: "var(--text-muted)" }}>Notes:</span>
                  <span>{proposal.payload.notes}</span>
                </>
              )}
            </div>
          ) : proposal.type === "add_kb_entry" ? (
            <div>
              <div style={{ fontWeight: 600, color: "#34d399", marginBottom: 2 }}>Title: {proposal.payload.title}</div>
              <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Category: {proposal.payload.category || "General"}</div>
              <div>{proposal.payload.content?.slice(0, 300)}...</div>
            </div>
          ) : (
            JSON.stringify(proposal.payload, null, 2)
          )}
        </div>
      )}

      {/* Action state footer */}
      {status === "pending" && (
        <div style={{ marginTop: 10 }}>
          {isAdmin ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={onApprove}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "var(--gradient-brand)", border: "none", color: "#fff",
                  borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", boxShadow: "0 2px 8px rgba(99, 102, 241, 0.4)"
                }}
              >
                <ShieldCheck size={14} /> Approve & Execute
              </button>
              <button
                type="button"
                onClick={onReject}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "transparent", border: "1px solid var(--border)",
                  color: "var(--text-muted)", borderRadius: 8, padding: "7px 12px",
                  fontSize: 12, cursor: "pointer"
                }}
              >
                <X size={14} /> Reject
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#facc15" }}>
              <Lock size={13} /> Only an Administrator can approve and execute this command.
            </div>
          )}
        </div>
      )}

      {status === "executing" && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#818cf8" }}>
          <Loader2 size={14} className="animate-spin" /> Executing command on dashboard...
        </div>
      )}

      {status === "approved" && (
        <div style={{
          marginTop: 10, padding: "7px 12px", borderRadius: 8,
          background: "rgba(16, 185, 129, 0.14)", border: "1px solid rgba(16, 185, 129, 0.3)",
          color: "#34d399", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6
        }}>
          <CheckCircle2 size={14} /> Approved & Executed on Dashboard {actionState?.executedAt ? `(${actionState.executedAt})` : ""}
        </div>
      )}

      {status === "rejected" && (
        <div style={{
          marginTop: 10, padding: "7px 12px", borderRadius: 8,
          background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.25)",
          color: "#f87171", fontSize: 12, display: "flex", alignItems: "center", gap: 6
        }}>
          <X size={14} /> Rejected by Admin. No changes applied.
        </div>
      )}

      {status === "error" && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#f87171" }}>
          Error: {actionState?.error || "Execution failed"}
          {isAdmin && (
            <button
              type="button"
              onClick={onApprove}
              style={{ marginLeft: 8, textDecoration: "underline", background: "none", border: "none", color: "#818cf8", cursor: "pointer" }}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  )
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

  // Action execution state
  const [actionStates, setActionStates] = useState<Record<number, { status: ActionStatus; error?: string; executedAt?: string }>>({})

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
    setActionStates({})
    setView("chat")
  }

  async function openChat(c: ChatSummary) {
    const epoch = ++streamEpochRef.current
    setChatId(c.id)
    setView("chat")
    setLoading(true)
    setActionStates({})
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

  async function handleExecuteAction(msgIndex: number, proposal: ActionProposal) {
    setActionStates(prev => ({ ...prev, [msgIndex]: { status: "executing" } }))
    try {
      const res = await fetch("/api/assistant/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: proposal.type,
          payload: proposal.payload,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Action execution failed")
      }

      setActionStates(prev => ({
        ...prev,
        [msgIndex]: {
          status: "approved",
          executedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      }))

      toast.success(data.message || "Command executed successfully!")
      window.dispatchEvent(new CustomEvent("rag:refresh", { detail: { type: proposal.type } }))
    } catch (err: any) {
      setActionStates(prev => ({
        ...prev,
        [msgIndex]: { status: "error", error: err.message || "Execution failed" },
      }))
      toast.error(err.message || "Failed to execute command")
    }
  }

  function handleRejectAction(msgIndex: number) {
    setActionStates(prev => ({
      ...prev,
      [msgIndex]: { status: "rejected" },
    }))
    toast.info("Action proposal rejected.")
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

      <div className="glass" style={{
        position: "fixed",
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
                  onClick={() => {
                    setOpen(false)
                    window.dispatchEvent(new CustomEvent("rag:open-voice-assistant"))
                  }}
                  aria-label="Switch to Voice Assistant"
                  title="Switch to Personal Voice Assistant (Alt+V)"
                  style={{
                    background: "rgba(99, 102, 241, 0.15)",
                    border: "1px solid rgba(99, 102, 241, 0.3)",
                    color: "#818cf8",
                    cursor: "pointer",
                    height: 28,
                    padding: "0 8px",
                    borderRadius: 7,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11.5,
                    fontWeight: 600,
                  }}
                >
                  <Mic size={13} strokeWidth={2.2} />
                  <span>Voice</span>
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
                const { cleanText, proposal } = msg.role === "assistant" ? extractActionProposal(msg.content) : { cleanText: msg.content, proposal: null }
                const actionState = actionStates[i]

                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 4 }}>
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
                      ) : cleanText}
                    </div>

                    {/* Inline Admin Approval Card for this specific message */}
                    {proposal && (
                      <div style={{ maxWidth: expanded ? "82%" : "90%", width: "100%" }}>
                        <ActionApprovalCard
                          proposal={proposal}
                          role={role}
                          onApprove={() => handleExecuteAction(i, proposal)}
                          onReject={() => handleRejectAction(i)}
                          actionState={actionState}
                        />
                      </div>
                    )}
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
                placeholder="Ask or command: write scripts, add leads, update KB…"
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
