"use client"
import { useState, useRef, useEffect } from "react"
import {
  MessageSquareText, Bot, X, Send, Sparkles, Plus, History, Trash2, ArrowLeft,
  Maximize2, Minimize2, Paperclip, FileText, Image as ImageIcon, CheckCircle2,
  AlertCircle, ShieldCheck, Loader2, Check, ExternalLink, HelpCircle
} from "lucide-react"
import VoiceDictation from "../ui/voice-dictation"

type Message = { role: "user" | "assistant"; content: string; attachment?: { name: string; type: string } }
type ChatSummary = { id: string; title: string; created_at: string; updated_at: string }
type UserRole = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

interface ActionProposal {
  id: string
  type: "update_script" | "add_kb_entry" | "update_kb_entry" | "delete_kb_entry" | "add_lead" | "add_dnd" | "toggle_security"
  title: string
  summary: string
  payload: Record<string, any>
  status: "pending" | "executing" | "approved" | "rejected"
  resultMsg?: string
}

const GREETINGS: Record<UserRole, string> = {
  admin: "Hi Admin! I'm your Executive Operations Co-Pilot. I can write Priya's scripts, update Knowledge Base entries, add leads, analyze data, inspect uploaded files, and run full reporting. Any system changes require your explicit approval before executing.",
  agent: "Hi! I'm the ops assistant. I can help you search leads, check loan applications, draft customer replies, and analyze call performance.",
  viewer: "Hi! I'm the ops assistant. I can show you live reporting, analytics, and business insights.",
  developer: "Hi! I'm your private developer assistant with system console access, queries, and activity logs.",
  branch_manager: "Hi! I'm your branch ops assistant. I can help with your branch's leads, calls, and WhatsApp activity.",
}

const QUICK_COMMANDS = [
  { label: "Draft a new script", query: "Write a high-converting call script for Priya targeting Personal Loans with low interest rates." },
  { label: "Add Knowledge Base rule", query: "Add a Knowledge Base fact: Our minimum CIBIL score for Home Loans is 680 with interest rates starting at 8.5%." },
  { label: "Add a new lead", query: "Add a new lead: Ramesh Gupta, phone 9876543210, looking for 5 Lakh Personal Loan." },
  { label: "Leads today?", query: "How many new leads were added today?" },
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
const DRAG_THRESHOLD = 6

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

  // Proposals tracking
  const [proposals, setProposals] = useState<Record<string, ActionProposal>>({})

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

  const greeting: Message = { role: "assistant", content: GREETINGS[role] || GREETINGS.agent }
  const [messages, setMessages] = useState<Message[]>([greeting])
  const [chatId, setChatId] = useState<string | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [chatsLoading, setChatsLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const streamEpochRef = useRef(0)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

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
    loadChats()
  }

  function startNewChat() {
    streamEpochRef.current++
    setChatId(null)
    setMessages([greeting])
    setView("chat")
  }

  async function openChat(id: string) {
    const epoch = ++streamEpochRef.current
    setChatId(id)
    setView("chat")
    setLoading(true)
    try {
      const res = await fetch(`/api/assistant/chats/${id}`)
      const data = await res.json()
      if (epoch !== streamEpochRef.current) return
      const loaded = (data.messages || []).map((m: any) => ({ role: m.role, content: m.content }))
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

  // Handle file selection
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
          type: "document",
          content: (reader.result as string).slice(0, 5000),
        })
      }
      reader.readAsText(file)
    }
  }

  // Execute an approved proposal
  async function executeProposal(proposal: ActionProposal) {
    if (role !== "admin") {
      alert("Only administrators have permission to approve and execute system modifications.")
      return
    }

    setProposals(prev => ({
      ...prev,
      [proposal.id]: { ...proposal, status: "executing" }
    }))

    try {
      const res = await fetch("/api/assistant/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: proposal.type, payload: proposal.payload })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Action execution failed")

      setProposals(prev => ({
        ...prev,
        [proposal.id]: {
          ...proposal,
          status: "approved",
          resultMsg: data.message || "Executed successfully"
        }
      }))

      // Append confirmation message in chat
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `✅ **Admin Action Completed**: ${data.message || proposal.title}`
        }
      ])
    } catch (err: any) {
      setProposals(prev => ({
        ...prev,
        [proposal.id]: {
          ...proposal,
          status: "pending",
          resultMsg: `Failed: ${err.message}`
        }
      }))
      alert(`Execution error: ${err.message}`)
    }
  }

  function rejectProposal(proposal: ActionProposal) {
    setProposals(prev => ({
      ...prev,
      [proposal.id]: { ...proposal, status: "rejected" }
    }))
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
        content: q || (currentAttachment ? `Attached file: ${currentAttachment.name}` : ""),
        attachment: currentAttachment ? { name: currentAttachment.name, type: currentAttachment.type } : undefined
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

      // Parse any action proposals in the final output
      extractActionProposal(acc)

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

  // Extract action_proposal code blocks from assistant messages
  function extractActionProposal(text: string) {
    const match = text.match(/```(?:action_proposal|json)?\s*(\{[\s\S]*?"type"\s*:\s*"(?:update_script|add_kb_entry|update_kb_entry|delete_kb_entry|add_lead|add_dnd|toggle_security)"[\s\S]*?\})\s*```/)
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1])
        const proposalId = `prop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
        setProposals(prev => ({
          ...prev,
          [proposalId]: {
            id: proposalId,
            type: parsed.type,
            title: parsed.title || "Proposed System Change",
            summary: parsed.summary || "System modification",
            payload: parsed.payload || {},
            status: "pending",
          }
        }))
      } catch (err) {
        console.warn("Could not parse action proposal:", err)
      }
    }
  }

  // Helper to render an Action Proposal Card
  function renderProposalCard(proposal: ActionProposal) {
    return (
      <div
        key={proposal.id}
        style={{
          marginTop: 10,
          borderRadius: 12,
          border: proposal.status === "approved"
            ? "1px solid rgba(16, 185, 129, 0.4)"
            : proposal.status === "rejected"
            ? "1px solid rgba(239, 68, 68, 0.3)"
            : "1.5px solid var(--accent-violet)",
          background: "var(--bg-secondary)",
          padding: 14,
          boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <ShieldCheck size={16} style={{ color: "var(--accent-violet)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--accent-violet)" }}>
              Admin Approval Required
            </span>
          </div>
          <span style={{
            fontSize: 11, padding: "2px 8px", borderRadius: 6, fontWeight: 600,
            background: proposal.status === "approved" ? "rgba(16,185,129,0.15)" : proposal.status === "rejected" ? "rgba(239,68,68,0.15)" : "rgba(139,92,246,0.15)",
            color: proposal.status === "approved" ? "var(--accent-green)" : proposal.status === "rejected" ? "var(--accent-red)" : "var(--accent-violet)"
          }}>
            {proposal.type.replace(/_/g, " ").toUpperCase()}
          </span>
        </div>

        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
          {proposal.title}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          {proposal.summary}
        </div>

        {/* Payload Preview */}
        <div style={{
          maxHeight: 140, overflowY: "auto", background: "var(--bg-primary)",
          borderRadius: 8, padding: 10, fontSize: 11.5, fontFamily: "monospace",
          border: "1px solid var(--border)", marginBottom: 12, color: "var(--text-secondary)", whiteSpace: "pre-wrap"
        }}>
          {proposal.type === "update_script" ? (
            proposal.payload.content || JSON.stringify(proposal.payload, null, 2)
          ) : proposal.type === "add_kb_entry" ? (
            `Title: ${proposal.payload.title}\nCategory: ${proposal.payload.category}\nContent: ${proposal.payload.content}`
          ) : proposal.type === "add_lead" ? (
            `Name: ${proposal.payload.name}\nPhone: ${proposal.payload.phone}\nProduct: ${proposal.payload.product_interest}\nAmount: ₹${proposal.payload.loan_amount || "—"}`
          ) : (
            JSON.stringify(proposal.payload, null, 2)
          )}
        </div>

        {/* Buttons & Status */}
        {proposal.status === "pending" && (
          <div>
            {role === "admin" ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => executeProposal(proposal)}
                  style={{
                    flex: 1, height: 34, borderRadius: 8, background: "var(--accent-green)",
                    border: "none", color: "white", fontSize: 12.5, fontWeight: 600,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer"
                  }}
                >
                  <Check size={14} strokeWidth={2.5} /> Approve & Apply
                </button>
                <button
                  type="button"
                  onClick={() => rejectProposal(proposal)}
                  style={{
                    height: 34, padding: "0 14px", borderRadius: 8, background: "transparent",
                    border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12,
                    cursor: "pointer"
                  }}
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--accent-amber)", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertCircle size={14} /> Only Administrators can approve and apply this change.
              </div>
            )}
          </div>
        )}

        {proposal.status === "executing" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--accent-cyan)" }}>
            <Loader2 size={15} className="animate-spin" /> Applying changes to live system...
          </div>
        )}

        {proposal.status === "approved" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--accent-green)", fontWeight: 600 }}>
            <CheckCircle2 size={16} /> Approved & executed by Admin.
          </div>
        )}

        {proposal.status === "rejected" && (
          <div style={{ fontSize: 12, color: "var(--accent-red)" }}>
            ✕ Proposal dismissed by user.
          </div>
        )}
      </div>
    )
  }

  // Render message text and strip raw action proposal json so it looks clean
  function renderMessageContent(content: string) {
    const cleanText = content.replace(/```(?:action_proposal|json)?\s*\{[\s\S]*?"type"\s*:\s*"(?:update_script|add_kb_entry|update_kb_entry|delete_kb_entry|add_lead|add_dnd|toggle_security)"[\s\S]*?\}\s*```/g, "").trim()
    return (
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
        {cleanText}
      </div>
    )
  }

  return (
    <>
      {/* Floating Action Button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          onPointerDown={(e) => startDrag(e.clientX, e.clientY)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label="Open Operations Assistant"
          title="Open AI Operations Assistant"
          style={{
            position: "fixed",
            left: pos ? pos.x : undefined,
            top: pos ? pos.y : undefined,
            right: pos ? undefined : EDGE_MARGIN,
            bottom: pos ? undefined : EDGE_MARGIN,
            width: FAB_SIZE,
            height: FAB_SIZE,
            borderRadius: "50%",
            background: "var(--gradient-brand)",
            border: "none",
            color: "white",
            cursor: dragging ? "grabbing" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 6px 20px -2px rgba(91,124,250,0.5), 0 2px 8px rgba(0,0,0,0.2)",
            zIndex: 900,
            touchAction: "none",
            userSelect: "none",
            transition: dragging ? "none" : "transform 0.15s ease",
          }}
        >
          <Bot size={24} strokeWidth={2.1} />
        </button>
      )}

      {/* Main Chat Window */}
      {open && (
        <>
          {/* Dimmed backdrop when maximized */}
          {expanded && (
            <div
              onClick={() => setExpanded(false)}
              style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
                backdropFilter: "blur(3px)", zIndex: 9998
              }}
            />
          )}

          <div
            style={{
              position: "fixed",
              zIndex: 9999,
              ...(expanded
                ? {
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: "min(960px, 94vw)",
                    height: "min(820px, 90vh)",
                  }
                : {
                    right: 24,
                    bottom: 24,
                    width: 420,
                    height: 600,
                    maxWidth: "calc(100vw - 32px)",
                    maxHeight: "calc(100vh - 48px)",
                  }),
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 24px 60px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.2)",
              overflow: "hidden",
              transition: "width 0.2s ease, height 0.2s ease",
            }}
          >
            {/* Header */}
            <div style={{
              padding: "12px 18px", borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: "var(--bg-secondary)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {view === "history" ? (
                  <button
                    onClick={() => setView("chat")}
                    className="btn-ghost"
                    style={{ width: 30, height: 30, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <ArrowLeft size={16} />
                  </button>
                ) : (
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, background: "var(--gradient-brand)",
                    display: "flex", alignItems: "center", justifyContent: "center", color: "white"
                  }}>
                    <Bot size={17} />
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    Ops Assistant
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                      background: role === "admin" ? "rgba(139,92,246,0.2)" : "rgba(6,182,212,0.2)",
                      color: role === "admin" ? "var(--accent-violet)" : "var(--accent-cyan)"
                    }}>
                      {role.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Script Writer · KB Editor · Leads · Full Control
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {view === "chat" && (
                  <>
                    <button
                      onClick={startNewChat}
                      title="New chat"
                      className="btn-ghost"
                      style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      onClick={openHistory}
                      title="Chat history"
                      className="btn-ghost"
                      style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <History size={16} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setExpanded(!expanded)}
                  title={expanded ? "Minimize window" : "Expand to full screen"}
                  className="btn-ghost"
                  style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  title="Close assistant"
                  className="btn-ghost"
                  style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            {/* View: History */}
            {view === "history" && (
              <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase" }}>
                  Previous Conversations
                </div>
                {chatsLoading && <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Loading history…</div>}
                {!chatsLoading && chats.length === 0 && (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                    No previous chats found.
                  </div>
                )}
                {!chatsLoading && chats.map(c => (
                  <div
                    key={c.id}
                    onClick={() => openChat(c.id)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                      background: chatId === c.id ? "var(--bg-secondary)" : "transparent",
                      border: "1px solid var(--border)", marginBottom: 6,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {c.title}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {timeAgoShort(c.updated_at)} ago
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChat(c.id) }}
                      className="btn-ghost"
                      style={{ width: 28, height: 28, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* View: Chat Messages */}
            {view === "chat" && (
              <>
                <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                  {messages.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                      }}
                    >
                      <div
                        style={{
                          maxWidth: expanded ? "75%" : "88%",
                          borderRadius: 12,
                          padding: "10px 14px",
                          fontSize: 13.5,
                          background: m.role === "user" ? "var(--gradient-brand)" : "var(--bg-secondary)",
                          color: m.role === "user" ? "white" : "var(--text-primary)",
                          border: m.role === "user" ? "none" : "1px solid var(--border)",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
                        }}
                      >
                        {/* Attached file pill if user uploaded */}
                        {m.attachment && (
                          <div style={{
                            display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px",
                            borderRadius: 6, background: "rgba(255,255,255,0.2)", fontSize: 11, marginBottom: 6
                          }}>
                            <Paperclip size={11} /> {m.attachment.name}
                          </div>
                        )}

                        {m.role === "assistant" ? renderMessageContent(m.content) : m.content}
                      </div>
                    </div>
                  ))}

                  {/* Render any parsed proposals for this chat */}
                  {Object.values(proposals).map(p => renderProposalCard(p))}

                  {loading && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--text-muted)", fontSize: 12.5, padding: "4px 8px" }}>
                      <Loader2 size={14} className="animate-spin text-[var(--accent-cyan)]" />
                      <span>Ops Assistant is thinking & preparing...</span>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Quick command buttons */}
                {messages.length <= 2 && (
                  <div style={{ padding: "0 14px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {QUICK_COMMANDS.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => send(c.query)}
                        style={{
                          fontSize: 11.5, padding: "4px 10px", borderRadius: 14,
                          background: "var(--bg-secondary)", border: "1px solid var(--border)",
                          color: "var(--text-secondary)", cursor: "pointer", transition: "all 0.15s"
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Attached file preview tag */}
                {attachedFile && (
                  <div style={{
                    padding: "6px 14px", background: "var(--bg-secondary)",
                    borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between",
                    fontSize: 12, color: "var(--text-secondary)"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Paperclip size={13} style={{ color: "var(--accent-cyan)" }} />
                      <span style={{ fontWeight: 600 }}>{attachedFile.name}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>({attachedFile.type})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachedFile(null)}
                      style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Input Toolbar */}
                <div style={{
                  padding: 12, borderTop: "1px solid var(--border)",
                  display: "flex", gap: 8, alignItems: "center", background: "var(--bg-card)"
                }}>
                  {/* File Upload Button */}
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
                    title="Attach images, documents, CSV, or text"
                    style={{
                      width: 36, height: 36, borderRadius: 8, background: "transparent",
                      border: "1px solid var(--border)", color: "var(--text-muted)",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0
                    }}
                  >
                    <Paperclip size={16} />
                  </button>

                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && send()}
                    placeholder={role === "admin" ? "Write scripts, add leads, update KB, ask questions…" : "Ask about leads, loans, calls…"}
                    style={{ flex: 1, fontSize: 13.5, height: 38 }}
                  />

                  {/* Upgraded Voice Dictation */}
                  <VoiceDictation
                    onTranscript={(spoken: string) => {
                      setInput(prev => (prev ? `${prev} ${spoken}` : spoken))
                    }}
                    size={16}
                    style={{ width: 38, height: 38, borderRadius: 8 }}
                    title="Speak command (Indian English, Hindi, etc.)"
                  />

                  {/* Send Button */}
                  <button
                    type="button"
                    onClick={() => send()}
                    disabled={loading || (!input.trim() && !attachedFile)}
                    style={{
                      width: 38, height: 38, borderRadius: 8, background: "var(--gradient-brand)",
                      border: "none", color: "white", opacity: (loading || (!input.trim() && !attachedFile)) ? 0.4 : 1,
                      cursor: (loading || (!input.trim() && !attachedFile)) ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                    }}
                  >
                    <Send size={15} strokeWidth={2.2} />
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
