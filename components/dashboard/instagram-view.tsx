"use client"

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import {
  Search,
  Send,
  MessageCircle,
  ChevronLeft,
  CheckCircle2,
  Zap,
  Lock,
  Pin,
  Info,
  X,
  Phone,
  Tag,
  StickyNote,
  Smile,
  Instagram,
  MessageSquare,
  UserPlus,
  ExternalLink,
  Check,
  Copy,
  Sparkles,
  Filter,
  Clock,
  AlertCircle,
  RefreshCw,
  Mail,
  ShieldCheck,
  SendHorizontal,
} from "lucide-react"
import { useToast } from "../ui/toast"
import { usePolling } from "@/lib/use-poll"
import VoiceDictation from "../ui/voice-dictation"
import { smartFilter } from "@/lib/smart-search"
import { formatDateTime } from "@/lib/utils"

type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

type Conversation = {
  ig_user_id: string
  ig_username?: string | null
  lead_id?: string | null
  last_message?: string
  last_direction?: string
  last_type?: "dm" | "comment"
  last_time?: string
  lead_name?: string
  lead_phone?: string | null
  lead_status?: string
  unread_count?: number
  // Instagram Separation:
  is_social_prospect?: boolean
  promoted_to_crm_at?: string | null
  ig_phone_extracted?: string | null
}

type Msg = {
  id: string
  direction: "inbound" | "outbound"
  type: "dm" | "comment"
  content: string
  created_at: string
  status?: string
  comment_id?: string
}

type FilterTab = "all" | "dm" | "comment" | "unread" | "prospects"

const IG_THEME = {
  panelBg: "#0f0f11",
  headerBg: "#17171c",
  chatBg: "#09090b",
  sidebarBg: "#121216",
  hairline: "rgba(255,255,255,0.08)",
  hairlineStrong: "rgba(255,255,255,0.14)",
  bubbleIn: "#202026",
  bubbleOut: "#0095f6", // Instagram signature DM blue
  commentOut: "#e1306c", // Instagram comment magenta
  textPrimary: "#f5f5f7",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  selected: "#1f1f27",
  hover: "rgba(255,255,255,0.04)",
  metaOut: "rgba(255,255,255,0.75)",
  accentPink: "#e1306c",
  accentPurple: "#833ab4",
  accentBlue: "#0095f6",
  accentGreen: "#10b981",
  accentYellow: "#f59e0b",
}

const QUICK_REPLIES = [
  {
    label: "📱 Ask WhatsApp",
    text: "Could you please share your WhatsApp number so our loan advisor can send you the exact loan details and rate chart?",
  },
  {
    label: "🏠 Home Loan",
    text: "Home loan interest rates start from 7.25% p.a. through 20+ banking partners in Hyderabad. Are you looking for purchase or construction?",
  },
  {
    label: "💼 Business Loan",
    text: "Business loans up to ₹75 Lakhs available with fast approval and minimal documentation. What loan amount do you require?",
  },
  {
    label: "📍 Office Address",
    text: "Our head office is at Gandimaisamma, Hyderabad. We never charge any advance fees or ask for OTP/PIN.",
  },
]

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const source = (name || "").trim()
  const clean = source.startsWith("@") ? source.slice(1) : source
  const initials = clean ? clean.split(/[ _-]/).map((n) => n[0]).join("").slice(0, 2).toUpperCase() : "IG"
  const colors = [
    ["#e1306c", "#833ab4"],
    ["#fd1d1d", "#f56040"],
    ["#405de6", "#5851db"],
    ["#833ab4", "#c13584"],
    ["#fcb045", "#fd1d1d"],
  ]
  const pair = colors[Math.abs(source.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)) % colors.length]

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(11, Math.round(size * 0.36)),
        fontWeight: 700,
        color: "#fff",
        flexShrink: 0,
        boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.15)",
      }}
    >
      {initials}
    </div>
  )
}

function formatMsgDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === d.toDateString()
    if (isToday) return `Today, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    if (isYesterday) return `Yesterday, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch {
    return dateStr
  }
}

export default function InstagramView({ initialSearch = "" }: { initialSearch?: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeIgUserId, setActiveIgUserId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [search, setSearch] = useState(initialSearch)
  const [tabFilter, setTabFilter] = useState<FilterTab>("all")
  const [inputMsg, setInputMsg] = useState("")
  const [replyType, setReplyType] = useState<"dm" | "comment">("dm")
  const [sending, setSending] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [userRole, setUserRole] = useState<Role>("viewer")
  const [copiedId, setCopiedId] = useState(false)

  // Promote-to-CRM:
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [promotePhone, setPromotePhone] = useState("")
  const [promoteWa, setPromoteWa] = useState(true)
  const [promoteQueue, setPromoteQueue] = useState(false)
  const [promoting, setPromoting] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const toast = useToast()

  // Fetch current user session role
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUserRole(d.role))
      .catch(() => {})
  }, [])

  // Fetch active conversation threads
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/instagram/conversations")
      if (res.ok) {
        const data = await res.json()
        setConversations(data || [])
        if (!activeIgUserId && data && data.length > 0) {
          setActiveIgUserId(data[0].ig_user_id)
        }
      }
    } catch {
      // ignore transient fetch error
    } finally {
      setLoading(false)
    }
  }, [activeIgUserId])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (initialSearch) {
      setSearch(initialSearch)
    }
  }, [initialSearch])

  useEffect(() => {
    if (initialSearch && conversations.length > 0) {
      const q = initialSearch.toLowerCase().replace(/^@/, "").trim()
      const match = conversations.find(
        (c) =>
          c.ig_user_id === initialSearch ||
          (c.ig_username && c.ig_username.toLowerCase() === q) ||
          (c.lead_name && c.lead_name.toLowerCase().includes(q))
      )
      if (match) {
        setActiveIgUserId(match.ig_user_id)
      }
    }
  }, [initialSearch, conversations])

  usePolling(loadConversations, 5000)

  // Load message history for selected user
  const loadMessages = useCallback(
    async (igUserId: string) => {
      setLoadingMsgs(true)
      try {
        const res = await fetch(`/api/instagram/messages?ig_user_id=${encodeURIComponent(igUserId)}`)
        if (res.ok) {
          const data = await res.json()
          setMessages(data || [])

          // Mark as read
          fetch("/api/instagram/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ig_user_id: igUserId }),
          }).catch(() => {})
        }
      } catch {
        toast.error("Failed to load Instagram messages")
      } finally {
        setLoadingMsgs(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    if (activeIgUserId) {
      loadMessages(activeIgUserId)
    }
  }, [activeIgUserId, loadMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const activeConv = useMemo(() => {
    return conversations.find((c) => c.ig_user_id === activeIgUserId)
  }, [conversations, activeIgUserId])

  // Sync replyType when conversation changes
  useEffect(() => {
    if (activeConv?.last_type === "comment") {
      setReplyType("comment")
    } else {
      setReplyType("dm")
    }
  }, [activeConv?.last_type, activeConv?.ig_user_id])

  // Send message
  async function handleSend() {
    if (!inputMsg.trim() || !activeIgUserId || sending) return
    setSending(true)

    const payload = {
      recipientIgUserId: activeIgUserId,
      message: inputMsg.trim(),
      leadId: activeConv?.lead_id || null,
      type: replyType,
      commentId: activeConv?.last_type === "comment" ? messages.find((m) => m.comment_id)?.comment_id : undefined,
      username: activeConv?.ig_username || undefined,
    }

    try {
      const res = await fetch("/api/instagram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        setInputMsg("")
        loadMessages(activeIgUserId)
        loadConversations()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to send Instagram message")
      }
    } catch {
      toast.error("Network error sending message")
    } finally {
      setSending(false)
    }
  }

  // Filter conversations
  const filteredConversations = useMemo(() => {
    let list = smartFilter(conversations, search, (c) => [
      c.ig_username,
      c.lead_name,
      c.lead_phone,
      c.last_message,
      c.ig_user_id,
    ])

    if (tabFilter === "dm") {
      list = list.filter((c) => c.last_type === "dm" || !c.last_type)
    } else if (tabFilter === "comment") {
      list = list.filter((c) => c.last_type === "comment")
    } else if (tabFilter === "unread") {
      list = list.filter((c) => (c.unread_count || 0) > 0)
    } else if (tabFilter === "prospects") {
      list = list.filter((c) => c.is_social_prospect === true)
    }

    return list
  }, [conversations, search, tabFilter])

  // Count summaries for tabs
  const counts = useMemo(() => {
    return {
      all: conversations.length,
      dm: conversations.filter((c) => c.last_type === "dm" || !c.last_type).length,
      comment: conversations.filter((c) => c.last_type === "comment").length,
      unread: conversations.filter((c) => (c.unread_count || 0) > 0).length,
      prospects: conversations.filter((c) => c.is_social_prospect === true).length,
    }
  }, [conversations])

  // Convert the active conversation's prospect into a callable CRM lead.
  async function promoteToCrm() {
    if (!activeConv?.lead_id || promoting) return
    setPromoting(true)
    try {
      const res = await fetch(`/api/instagram/leads/${activeConv.lead_id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: promotePhone, sendWhatsAppLink: promoteWa, addToCallQueue: promoteQueue }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(
          `${d.lead?.name || "Prospect"} is now a CRM lead${d.lead?.lead_code ? ` (${d.lead.lead_code})` : ""}` +
          `${d.queued ? " — added to Call Queue" : ""}` +
          `${d.whatsappSent ? " — welcome + form link sent" : ""}`
        )
        setPromoteOpen(false)
        loadConversations()
      } else if (res.status === 409) {
        toast.error(d.message || "That phone already belongs to another CRM lead — review it manually before converting.")
      } else {
        toast.error(d.message || d.error || "Promote failed")
      }
    } catch {
      toast.error("Promote failed — check your connection and try again")
    } finally {
      setPromoting(false)
    }
  }

  function copyId(id: string) {
    navigator.clipboard?.writeText(id).then(() => {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1500)
    })
  }

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 90px)",
        minHeight: 580,
        background: IG_THEME.panelBg,
        color: IG_THEME.textPrimary,
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid ${IG_THEME.hairline}`,
        boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
        position: "relative",
      }}
    >
      {/* LEFT PANEL: Conversation List */}
      <div
        className={mobileDetailOpen ? "hidden md:flex" : "flex"}
        style={{
          width: 340,
          minWidth: 300,
          borderRight: `1px solid ${IG_THEME.hairline}`,
          flexDirection: "column",
          background: IG_THEME.sidebarBg,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 18px",
            borderBottom: `1px solid ${IG_THEME.hairline}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: IG_THEME.headerBg,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "linear-gradient(135deg, #e1306c, #833ab4, #fd1d1d)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 8px rgba(225,48,108,0.35)",
              }}
            >
              <Instagram size={18} style={{ color: "#fff" }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.2 }}>Instagram Chat</div>
              <div style={{ fontSize: 11, color: IG_THEME.textMuted }}>Direct Messages & Comments</div>
            </div>
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 12,
              background: "rgba(225,48,108,0.15)",
              color: IG_THEME.accentPink,
              border: "1px solid rgba(225,48,108,0.3)",
            }}
          >
            {counts.all} threads
          </span>
        </div>

        {/* Search */}
        <div style={{ padding: "12px 14px 8px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,255,255,0.05)",
              borderRadius: 9,
              padding: "7px 11px",
              border: `1px solid ${IG_THEME.hairline}`,
            }}
          >
            <Search size={14} style={{ color: IG_THEME.textSecondary, flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search by username, text, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                color: IG_THEME.textPrimary,
                fontSize: 12.5,
                width: "100%",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", color: IG_THEME.textMuted, cursor: "pointer", padding: 0 }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Filter Pills */}
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "4px 14px 10px",
            overflowX: "auto",
            borderBottom: `1px solid ${IG_THEME.hairline}`,
          }}
        >
          {(
            [
              { key: "all", label: "All", count: counts.all },
              { key: "dm", label: "DMs", count: counts.dm },
              { key: "comment", label: "Comments", count: counts.comment },
              { key: "unread", label: "Unread", count: counts.unread },
              { key: "prospects", label: "Prospects", count: counts.prospects },
            ] as const
          ).map((t) => {
            const isActive = tabFilter === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTabFilter(t.key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 9px",
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 500,
                  background: isActive ? "linear-gradient(135deg, #e1306c, #833ab4)" : "rgba(255,255,255,0.06)",
                  color: isActive ? "#fff" : IG_THEME.textSecondary,
                  border: `1px solid ${isActive ? "transparent" : IG_THEME.hairline}`,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <span>{t.label}</span>
                {t.count > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      opacity: isActive ? 0.9 : 0.6,
                      background: isActive ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.1)",
                      borderRadius: 10,
                      padding: "1px 5px",
                    }}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Conversation List */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: IG_THEME.textMuted, fontSize: 13 }}>
              <RefreshCw size={18} className="animate-spin" style={{ margin: "0 auto 8px", opacity: 0.6 }} />
              Loading conversations...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center", color: IG_THEME.textMuted, fontSize: 13 }}>
              <Instagram size={28} style={{ opacity: 0.25, margin: "0 auto 8px" }} />
              <div>No conversations match filters</div>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isActive = conv.ig_user_id === activeIgUserId
              const title = conv.lead_name || (conv.ig_username ? `@${conv.ig_username}` : `IG User ${conv.ig_user_id.slice(-4)}`)
              const isComment = conv.last_type === "comment"

              return (
                <div
                  key={conv.ig_user_id}
                  onClick={() => {
                    setActiveIgUserId(conv.ig_user_id)
                    setMobileDetailOpen(true)
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    cursor: "pointer",
                    background: isActive ? IG_THEME.selected : "transparent",
                    borderLeft: `3px solid ${isActive ? IG_THEME.accentPink : "transparent"}`,
                    borderBottom: `1px solid ${IG_THEME.hairline}`,
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = IG_THEME.hover
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent"
                  }}
                >
                  <div style={{ position: "relative" }}>
                    <Avatar name={title} size={42} />
                    <span
                      title={isComment ? "Post Comment" : "Direct Message"}
                      style={{
                        position: "absolute",
                        bottom: -2,
                        right: -2,
                        width: 17,
                        height: 17,
                        borderRadius: "50%",
                        background: isComment ? IG_THEME.commentOut : IG_THEME.bubbleOut,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "2px solid #121216",
                        fontSize: 9,
                        color: "#fff",
                      }}
                    >
                      {isComment ? "💬" : "✉️"}
                    </span>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 13.5,
                          color: IG_THEME.textPrimary,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {title}
                      </span>
                      {conv.last_time && (
                        <span style={{ fontSize: 11, color: IG_THEME.textMuted, flexShrink: 0 }}>
                          {new Date(conv.last_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 12,
                          color: isActive ? IG_THEME.textSecondary : IG_THEME.textMuted,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {conv.last_direction === "outbound" && <span style={{ color: IG_THEME.accentBlue }}>You: </span>}
                        {conv.last_message || "No message content"}
                      </span>

                      {/* Unread badge or prospect status */}
                      {conv.unread_count && conv.unread_count > 0 ? (
                        <span
                          style={{
                            background: IG_THEME.accentPink,
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 700,
                            borderRadius: 10,
                            padding: "2px 6px",
                            flexShrink: 0,
                            boxShadow: "0 0 8px rgba(225,48,108,0.5)",
                          }}
                        >
                          {conv.unread_count}
                        </span>
                      ) : conv.is_social_prospect ? (
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 600,
                            color: IG_THEME.accentYellow,
                            background: "rgba(245,158,11,0.12)",
                            padding: "1px 5px",
                            borderRadius: 4,
                            flexShrink: 0,
                          }}
                        >
                          Prospect
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* MIDDLE PANEL: Chat & Thread Window */}
      <div
        className={!mobileDetailOpen ? "hidden md:flex" : "flex"}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: IG_THEME.chatBg,
          minWidth: 0,
        }}
      >
        {activeConv ? (
          <>
            {/* Thread Header */}
            <div
              style={{
                height: 64,
                padding: "0 18px",
                background: IG_THEME.headerBg,
                borderBottom: `1px solid ${IG_THEME.hairline}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <button
                  className="md:hidden"
                  onClick={() => setMobileDetailOpen(false)}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: `1px solid ${IG_THEME.hairline}`,
                    borderRadius: 8,
                    color: IG_THEME.textPrimary,
                    cursor: "pointer",
                    padding: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Back to conversation list"
                >
                  <ChevronLeft size={18} />
                </button>

                <Avatar name={activeConv.lead_name || activeConv.ig_username || "IG"} size={40} />

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 14.5,
                        color: IG_THEME.textPrimary,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {activeConv.lead_name || (activeConv.ig_username ? `@${activeConv.ig_username}` : `IG User`)}
                    </span>
                    {activeConv.ig_username && (
                      <a
                        href={`https://instagram.com/${activeConv.ig_username}`}
                        target="_blank"
                        rel="noreferrer"
                        title="View profile on Instagram"
                        style={{ color: IG_THEME.textMuted, display: "flex", alignItems: "center" }}
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: IG_THEME.textSecondary }}>
                    <span>{activeConv.last_type === "comment" ? "💬 Post Comment" : "✉️ Direct Message"}</span>
                    <span>•</span>
                    {activeConv.is_social_prospect ? (
                      <span style={{ color: IG_THEME.accentYellow, fontWeight: 600 }}>Social Prospect</span>
                    ) : (
                      <span style={{ color: IG_THEME.accentGreen, fontWeight: 600 }}>CRM Lead</span>
                    )}
                    {activeConv.lead_phone && (
                      <>
                        <span>•</span>
                        <span style={{ fontFamily: "monospace", color: IG_THEME.textPrimary }}>{activeConv.lead_phone}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Header Controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {/* AI Toggle Button */}
                <button
                  type="button"
                  onClick={() => setAiEnabled(!aiEnabled)}
                  title={aiEnabled ? "Priya AI auto-replies are active" : "Priya AI auto-replies are paused"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 12px",
                    borderRadius: 20,
                    background: aiEnabled ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.06)",
                    border: `1px solid ${aiEnabled ? "rgba(16,185,129,0.35)" : IG_THEME.hairline}`,
                    color: aiEnabled ? IG_THEME.accentGreen : IG_THEME.textMuted,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Zap size={13} style={{ fill: aiEnabled ? IG_THEME.accentGreen : "none" }} />
                  <span>Priya AI: {aiEnabled ? "ON" : "OFF"}</span>
                </button>

                {/* Info Drawer Toggle */}
                <button
                  onClick={() => setShowInfo(!showInfo)}
                  style={{
                    background: showInfo ? "rgba(225,48,108,0.15)" : "rgba(255,255,255,0.06)",
                    border: `1px solid ${showInfo ? "rgba(225,48,108,0.4)" : IG_THEME.hairline}`,
                    borderRadius: 8,
                    color: showInfo ? IG_THEME.accentPink : IG_THEME.textSecondary,
                    cursor: "pointer",
                    padding: "6px 9px",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                  title="Toggle Contact & Lead details"
                >
                  <Info size={15} />
                  <span className="hidden sm:inline">Details</span>
                </button>
              </div>
            </div>

            {/* Message Thread Area */}
            <div
              style={{
                flex: 1,
                padding: "20px 24px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {loadingMsgs ? (
                <div style={{ textAlign: "center", color: IG_THEME.textMuted, margin: "auto", fontSize: 13 }}>
                  <RefreshCw size={20} className="animate-spin" style={{ margin: "0 auto 8px", opacity: 0.6 }} />
                  Loading message history...
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: "center", color: IG_THEME.textMuted, margin: "auto", maxWidth: 320 }}>
                  <Instagram size={36} style={{ margin: "0 auto 12px", opacity: 0.3, color: IG_THEME.accentPink }} />
                  <div style={{ fontWeight: 600, color: IG_THEME.textPrimary, marginBottom: 4 }}>No messages yet</div>
                  <div style={{ fontSize: 12 }}>Send a DM or comment reply below to engage with this prospect.</div>
                </div>
              ) : (
                messages.map((m, idx) => {
                  const isOut = m.direction === "outbound"
                  const isComment = m.type === "comment"

                  return (
                    <div
                      key={m.id || idx}
                      style={{
                        alignSelf: isOut ? "flex-end" : "flex-start",
                        maxWidth: "75%",
                        background: isOut
                          ? isComment
                            ? `linear-gradient(135deg, ${IG_THEME.commentOut}, #c13584)`
                            : `linear-gradient(135deg, ${IG_THEME.bubbleOut}, #0077e6)`
                          : IG_THEME.bubbleIn,
                        color: "#fff",
                        borderRadius: isOut ? "16px 16px 3px 16px" : "16px 16px 16px 3px",
                        padding: "10px 15px",
                        fontSize: 13.5,
                        lineHeight: "1.45",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                        border: isOut ? "none" : `1px solid ${IG_THEME.hairline}`,
                        wordBreak: "break-word",
                      }}
                    >
                      {isComment && (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            marginBottom: 4,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            background: "rgba(0,0,0,0.2)",
                            padding: "2px 7px",
                            borderRadius: 4,
                          }}
                        >
                          <span>💬</span> Public Post Comment
                        </div>
                      )}

                      <div>{m.content}</div>

                      <div
                        style={{
                          fontSize: 10,
                          color: isOut ? IG_THEME.metaOut : IG_THEME.textMuted,
                          marginTop: 5,
                          textAlign: "right",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 4,
                        }}
                      >
                        <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        {isOut && (
                          <span title={m.status || "sent"}>
                            {m.status === "delivered" || m.status === "read" ? "✓✓" : "✓"}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Reply Suggestion Chips */}
            <div
              style={{
                padding: "8px 18px",
                background: "rgba(255,255,255,0.02)",
                borderTop: `1px solid ${IG_THEME.hairline}`,
                display: "flex",
                gap: 8,
                overflowX: "auto",
              }}
            >
              {QUICK_REPLIES.map((qr, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setInputMsg(qr.text)}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: `1px solid ${IG_THEME.hairline}`,
                    borderRadius: 14,
                    padding: "3px 10px",
                    color: IG_THEME.textSecondary,
                    fontSize: 11.5,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = IG_THEME.textPrimary
                    e.currentTarget.style.background = "rgba(255,255,255,0.1)"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = IG_THEME.textSecondary
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)"
                  }}
                >
                  <span>{qr.label}</span>
                </button>
              ))}
            </div>

            {/* Message Composer Area */}
            <div
              style={{
                padding: "12px 18px 16px",
                background: IG_THEME.headerBg,
                borderTop: `1px solid ${IG_THEME.hairline}`,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {/* Type Switcher: DM vs Comment */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div
                  style={{
                    display: "inline-flex",
                    background: "rgba(0,0,0,0.35)",
                    borderRadius: 8,
                    padding: 3,
                    border: `1px solid ${IG_THEME.hairline}`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setReplyType("dm")}
                    style={{
                      background: replyType === "dm" ? IG_THEME.accentBlue : "transparent",
                      color: replyType === "dm" ? "#fff" : IG_THEME.textSecondary,
                      border: "none",
                      borderRadius: 6,
                      padding: "4px 12px",
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span>✉️</span> Direct Message (DM)
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplyType("comment")}
                    style={{
                      background: replyType === "comment" ? IG_THEME.accentPink : "transparent",
                      color: replyType === "comment" ? "#fff" : IG_THEME.textSecondary,
                      border: "none",
                      borderRadius: 6,
                      padding: "4px 12px",
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span>💬</span> Public Comment Reply
                  </button>
                </div>

                <span style={{ fontSize: 11, color: IG_THEME.textMuted }}>Press Enter to send</span>
              </div>

              {/* Input Row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <VoiceDictation onTranscript={(t) => setInputMsg((prev) => (prev ? prev + " " + t : t))} />

                <input
                  type="text"
                  placeholder={
                    replyType === "dm"
                      ? "Write a private Direct Message..."
                      : "Write a public comment reply..."
                  }
                  value={inputMsg}
                  onChange={(e) => setInputMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  style={{
                    flex: 1,
                    background: "rgba(0,0,0,0.35)",
                    border: `1px solid ${IG_THEME.hairlineStrong}`,
                    borderRadius: 22,
                    padding: "10px 16px",
                    color: IG_THEME.textPrimary,
                    fontSize: 13.5,
                    outline: "none",
                  }}
                />

                <button
                  onClick={handleSend}
                  disabled={sending || !inputMsg.trim()}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background:
                      replyType === "comment"
                        ? "linear-gradient(135deg, #e1306c, #c13584)"
                        : "linear-gradient(135deg, #0095f6, #0077e6)",
                    border: "none",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: sending || !inputMsg.trim() ? "default" : "pointer",
                    opacity: sending || !inputMsg.trim() ? 0.45 : 1,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                    transition: "all 0.15s ease",
                    flexShrink: 0,
                  }}
                  title="Send message"
                >
                  <Send size={17} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: IG_THEME.textMuted,
              padding: 32,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: "linear-gradient(135deg, rgba(225,48,108,0.15), rgba(131,58,180,0.15))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
                border: "1px solid rgba(225,48,108,0.2)",
              }}
            >
              <Instagram size={36} style={{ color: IG_THEME.accentPink }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: IG_THEME.textPrimary, marginBottom: 6 }}>
              Instagram Engagement Hub
            </div>
            <div style={{ fontSize: 13, maxWidth: 360, lineHeight: 1.5 }}>
              Select an ongoing conversation from the left to read messages, send replies, or convert prospects into CRM leads.
            </div>
          </div>
        )}
      </div>

      {/* RIGHT PANEL: Contact & Lead Details (Collapsible) */}
      {showInfo && activeConv && (
        <div
          style={{
            width: 310,
            borderLeft: `1px solid ${IG_THEME.hairline}`,
            background: IG_THEME.sidebarBg,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            overflowY: "auto",
            zIndex: 10,
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: -0.2 }}>Contact Information</span>
            <button
              onClick={() => setShowInfo(false)}
              style={{ background: "none", border: "none", color: IG_THEME.textSecondary, cursor: "pointer", padding: 4 }}
              title="Close panel"
            >
              <X size={16} />
            </button>
          </div>

          {/* Profile Card */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              paddingBottom: 16,
              borderBottom: `1px solid ${IG_THEME.hairline}`,
            }}
          >
            <Avatar name={activeConv.lead_name || activeConv.ig_username || "IG"} size={60} />
            <div style={{ fontWeight: 700, fontSize: 15, textAlign: "center", marginTop: 4 }}>
              {activeConv.lead_name || `@${activeConv.ig_username}`}
            </div>

            {activeConv.ig_username && (
              <a
                href={`https://instagram.com/${activeConv.ig_username}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 12,
                  color: IG_THEME.accentPink,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontWeight: 600,
                }}
              >
                <span>@{activeConv.ig_username}</span>
                <ExternalLink size={11} />
              </a>
            )}

            <div style={{ fontSize: 12, color: IG_THEME.textSecondary, marginTop: 2 }}>
              {activeConv.lead_phone ? (
                <span style={{ color: IG_THEME.accentGreen, fontWeight: 600, fontFamily: "monospace" }}>
                  📞 {activeConv.lead_phone}
                </span>
              ) : (
                <span style={{ color: IG_THEME.textMuted }}>No telephone number listed</span>
              )}
            </div>
          </div>

          {/* Key Facts */}
          <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: IG_THEME.textSecondary }}>Instagram User ID:</span>
              <button
                onClick={() => copyId(activeConv.ig_user_id)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: `1px solid ${IG_THEME.hairline}`,
                  borderRadius: 6,
                  padding: "2px 7px",
                  color: IG_THEME.textPrimary,
                  fontSize: 11,
                  fontFamily: "monospace",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title="Click to copy ID"
              >
                <span>{activeConv.ig_user_id.slice(0, 10)}...</span>
                {copiedId ? <Check size={11} style={{ color: IG_THEME.accentGreen }} /> : <Copy size={11} />}
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: IG_THEME.textSecondary }}>Lead Status:</span>
              <span
                style={{
                  color: IG_THEME.accentGreen,
                  fontWeight: 600,
                  background: "rgba(16,185,129,0.12)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                }}
              >
                {activeConv.lead_status || "New"}
              </span>
            </div>

            {activeConv.promoted_to_crm_at && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: IG_THEME.textSecondary }}>CRM Pipeline:</span>
                <span style={{ color: IG_THEME.accentPink, fontWeight: 700, fontSize: 11 }}>
                  ✓ Promoted Lead
                </span>
              </div>
            )}
          </div>

          {/* Social Prospect Lane & Convert Action Card */}
          {activeConv.is_social_prospect && (
            <div
              style={{
                borderTop: `1px solid ${IG_THEME.hairline}`,
                paddingTop: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.25)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: IG_THEME.accentYellow, fontWeight: 700, fontSize: 12 }}>
                  <AlertCircle size={14} />
                  <span>Social Prospect — not in CRM yet</span>
                </div>
                <div style={{ fontSize: 11, color: IG_THEME.textSecondary, lineHeight: 1.4 }}>
                  This contact has not provided a verified phone number yet. Convert them to add to the telecalling pipeline.
                </div>
              </div>

              {activeConv.ig_phone_extracted && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "rgba(16,185,129,0.08)",
                    border: "1px solid rgba(16,185,129,0.3)",
                    fontSize: 12,
                    color: IG_THEME.textSecondary,
                  }}
                >
                  Detected in DM:{" "}
                  <span style={{ color: IG_THEME.accentGreen, fontWeight: 700, fontFamily: "monospace" }}>
                    {activeConv.ig_phone_extracted}
                  </span>
                </div>
              )}

              {userRole !== "viewer" && activeConv.lead_id && (
                !promoteOpen ? (
                  <button
                    onClick={() => {
                      setPromoteOpen(true)
                      setPromotePhone(activeConv.ig_phone_extracted ? activeConv.ig_phone_extracted.replace(/\D/g, "") : "")
                      setPromoteWa(true)
                      setPromoteQueue(false)
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      height: 38,
                      borderRadius: 9,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      border: "none",
                      color: "#fff",
                      boxShadow: "0 2px 8px rgba(16,185,129,0.3)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <UserPlus size={15} strokeWidth={2.2} />
                    <span>Promote to CRM Lead</span>
                  </button>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      background: "rgba(255,255,255,0.04)",
                      padding: 12,
                      borderRadius: 10,
                      border: `1px solid ${IG_THEME.hairlineStrong}`,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: IG_THEME.textPrimary }}>
                      Enter 10-Digit Mobile:
                    </div>
                    <input
                      value={promotePhone}
                      onChange={(e) => setPromotePhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      maxLength={10}
                      style={{
                        height: 34,
                        fontSize: 13,
                        background: IG_THEME.bubbleIn,
                        border: `1px solid ${IG_THEME.hairlineStrong}`,
                        borderRadius: 7,
                        color: IG_THEME.textPrimary,
                        padding: "0 10px",
                        fontFamily: "monospace",
                        outline: "none",
                      }}
                    />

                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: IG_THEME.textSecondary, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={promoteWa}
                        onChange={(e) => setPromoteWa(e.target.checked)}
                        style={{ accentColor: IG_THEME.accentGreen }}
                      />
                      <span>Send WhatsApp welcome + form link</span>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: IG_THEME.textSecondary, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={promoteQueue}
                        onChange={(e) => setPromoteQueue(e.target.checked)}
                        style={{ accentColor: IG_THEME.accentGreen }}
                      />
                      <span>Add to Call Queue (High Priority)</span>
                    </label>

                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button
                        onClick={() => setPromoteOpen(false)}
                        disabled={promoting}
                        style={{
                          flex: 1,
                          height: 32,
                          borderRadius: 7,
                          fontSize: 12,
                          background: "transparent",
                          border: `1px solid ${IG_THEME.hairline}`,
                          color: IG_THEME.textSecondary,
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>

                      <button
                        onClick={promoteToCrm}
                        disabled={promoting || !/^\d{10}$/.test(promotePhone.replace(/\D/g, ""))}
                        style={{
                          flex: 1,
                          height: 32,
                          borderRadius: 7,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          background: promoting ? "rgba(16,185,129,0.3)" : IG_THEME.accentGreen,
                          border: "none",
                          color: "#fff",
                        }}
                      >
                        {promoting ? "Converting…" : "Confirm"}
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
