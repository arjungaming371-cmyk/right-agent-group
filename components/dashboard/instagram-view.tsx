"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Search, Send, MessageCircle, ChevronLeft, CheckCircle2, Zap, Lock, Pin, Info, X, Phone, Tag, StickyNote, Smile, Instagram, MessageSquare } from "lucide-react"
import { useToast } from "../ui/toast"
import { usePolling } from "@/lib/use-poll"
import VoiceDictation from "../ui/voice-dictation"
import { smartFilter } from "@/lib/smart-search"

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
  lead_phone?: string
  lead_status?: string
  unread_count?: number
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

const IG_THEME = {
  panelBg: "#121212",
  headerBg: "#1a1a1a",
  chatBg: "#0d0d0d",
  hairline: "rgba(255,255,255,0.08)",
  bubbleIn: "#262626",
  bubbleOut: "#3797f0", // Instagram signature DM blue
  commentOut: "#e1306c", // Instagram comment pink
  textPrimary: "#f5f5f5",
  textSecondary: "#a8a8a8",
  selected: "#262626",
  metaOut: "rgba(255,255,255,0.75)",
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const source = (name || "").trim()
  const initials = source ? source.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() : "IG"
  const colors = ["#e1306c", "#fd1d1d", "#f56040", "#833ab4", "#405de6"]
  const color = colors[(source || "IG").charCodeAt(0) % colors.length]
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `linear-gradient(135deg, ${color}, #833ab4)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.35,
        fontWeight: 700,
        color: "#fff",
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  )
}

export default function InstagramView({ initialSearch = "" }: { initialSearch?: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeIgUserId, setActiveIgUserId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [search, setSearch] = useState(initialSearch)
  const [inputMsg, setInputMsg] = useState("")
  const [replyType, setReplyType] = useState<"dm" | "comment">("dm")
  const [sending, setSending] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [userRole, setUserRole] = useState<Role>("viewer")

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

  const activeConv = conversations.find((c) => c.ig_user_id === activeIgUserId)

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

  const filteredConversations = smartFilter(conversations, search, (c) => [
    c.ig_username,
    c.lead_name,
    c.lead_phone,
    c.last_message,
  ])

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 85px)",
        background: IG_THEME.panelBg,
        color: IG_THEME.textPrimary,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${IG_THEME.hairline}`,
      }}
    >
      {/* LEFT PANEL: Conversation List */}
      <div
        style={{
          width: 320,
          borderRight: `1px solid ${IG_THEME.hairline}`,
          display: "flex",
          flexDirection: "column",
          background: IG_THEME.panelBg,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: 16,
            borderBottom: `1px solid ${IG_THEME.hairline}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 16 }}>
            <Instagram size={20} style={{ color: "#e1306c" }} />
            <span>Instagram Chat</span>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: "10px 12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: IG_THEME.headerBg,
              borderRadius: 8,
              padding: "6px 10px",
              border: `1px solid ${IG_THEME.hairline}`,
            }}
          >
            <Search size={14} style={{ color: IG_THEME.textSecondary }} />
            <input
              type="text"
              placeholder="Search chat or username..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                color: IG_THEME.textPrimary,
                fontSize: 13,
                width: "100%",
              }}
            />
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center", color: IG_THEME.textSecondary, fontSize: 13 }}>
              Loading chats...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: IG_THEME.textSecondary, fontSize: 13 }}>
              No Instagram conversations found.
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isActive = conv.ig_user_id === activeIgUserId
              const title = conv.lead_name || (conv.ig_username ? `@${conv.ig_username}` : `IG User ${conv.ig_user_id.slice(-4)}`)
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
                    borderBottom: `1px solid ${IG_THEME.hairline}`,
                    transition: "background 0.15s",
                  }}
                >
                  <Avatar name={title} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5, color: IG_THEME.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {title}
                      </span>
                      {conv.last_time && (
                        <span style={{ fontSize: 11, color: IG_THEME.textSecondary }}>
                          {new Date(conv.last_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: IG_THEME.textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {conv.last_type === "comment" ? "💬 " : "✉️ "}
                        {conv.last_message || "No messages"}
                      </span>
                      {!!conv.unread_count && conv.unread_count > 0 && (
                        <span style={{ background: "#e1306c", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 10, padding: "2px 6px" }}>
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* MIDDLE PANEL: Main Thread */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: IG_THEME.chatBg }}>
        {activeConv ? (
          <>
            {/* Header */}
            <div
              style={{
                height: 60,
                padding: "0 16px",
                background: IG_THEME.headerBg,
                borderBottom: `1px solid ${IG_THEME.hairline}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  className="md:hidden"
                  onClick={() => setMobileDetailOpen(false)}
                  style={{ background: "none", border: "none", color: IG_THEME.textPrimary, cursor: "pointer" }}
                >
                  <ChevronLeft size={20} />
                </button>
                <Avatar name={activeConv.lead_name || activeConv.ig_username || "IG"} size={36} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {activeConv.lead_name || (activeConv.ig_username ? `@${activeConv.ig_username}` : `IG User`)}
                  </div>
                  <div style={{ fontSize: 11, color: IG_THEME.textSecondary }}>
                    {activeConv.lead_phone ? `Phone: ${activeConv.lead_phone}` : "Instagram DM"}
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* AI Toggle */}
                <button
                  type="button"
                  onClick={() => setAiEnabled(!aiEnabled)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 20,
                    background: aiEnabled ? "rgba(37,211,102,0.15)" : "rgba(255,255,255,0.1)",
                    border: `1px solid ${aiEnabled ? "#25d366" : IG_THEME.textSecondary}`,
                    color: aiEnabled ? "#25d366" : IG_THEME.textSecondary,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <Zap size={13} />
                  <span>Priya AI: {aiEnabled ? "ON" : "OFF"}</span>
                </button>

                <button
                  onClick={() => setShowInfo(!showInfo)}
                  style={{ background: "none", border: "none", color: IG_THEME.textSecondary, cursor: "pointer" }}
                >
                  <Info size={18} />
                </button>
              </div>
            </div>

            {/* Message Thread */}
            <div style={{ flex: 1, padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
              {loadingMsgs ? (
                <div style={{ textAlign: "center", color: IG_THEME.textSecondary, marginTop: 40, fontSize: 13 }}>
                  Loading chat history...
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: "center", color: IG_THEME.textSecondary, marginTop: 40, fontSize: 13 }}>
                  No messages yet. Write a message below to start chatting!
                </div>
              ) : (
                messages.map((m) => {
                  const isOut = m.direction === "outbound"
                  const isComment = m.type === "comment"
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isOut ? "flex-end" : "flex-start",
                        maxWidth: "70%",
                        background: isOut ? (isComment ? IG_THEME.commentOut : IG_THEME.bubbleOut) : IG_THEME.bubbleIn,
                        color: "#fff",
                        borderRadius: isOut ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                        padding: "10px 14px",
                        fontSize: 13.5,
                        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                        position: "relative",
                      }}
                    >
                      {isComment && (
                        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 3, opacity: 0.85 }}>
                          💬 Post Comment
                        </div>
                      )}
                      <div>{m.content}</div>
                      <div
                        style={{
                          fontSize: 10,
                          color: isOut ? IG_THEME.metaOut : IG_THEME.textSecondary,
                          marginTop: 4,
                          textAlign: "right",
                        }}
                      >
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply Input Box */}
            <div
              style={{
                padding: 12,
                background: IG_THEME.headerBg,
                borderTop: `1px solid ${IG_THEME.hairline}`,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {/* Type Switcher: DM vs Comment */}
              <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: replyType === "dm" ? "#3797f0" : IG_THEME.textSecondary }}>
                  <input
                    type="radio"
                    name="replyType"
                    checked={replyType === "dm"}
                    onChange={() => setReplyType("dm")}
                  />
                  <span>Direct Message (DM)</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: replyType === "comment" ? "#e1306c" : IG_THEME.textSecondary }}>
                  <input
                    type="radio"
                    name="replyType"
                    checked={replyType === "comment"}
                    onChange={() => setReplyType("comment")}
                  />
                  <span>Public Comment Reply</span>
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <VoiceDictation onTranscript={(t) => setInputMsg((prev) => prev + " " + t)} />

                <input
                  type="text"
                  placeholder={replyType === "dm" ? "Send a Direct Message..." : "Write a public comment reply..."}
                  value={inputMsg}
                  onChange={(e) => setInputMsg(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  style={{
                    flex: 1,
                    background: IG_THEME.chatBg,
                    border: `1px solid ${IG_THEME.hairline}`,
                    borderRadius: 20,
                    padding: "9px 14px",
                    color: IG_THEME.textPrimary,
                    fontSize: 13,
                    outline: "none",
                  }}
                />

                <button
                  onClick={handleSend}
                  disabled={sending || !inputMsg.trim()}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: replyType === "comment" ? "#e1306c" : "#3797f0",
                    border: "none",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: sending || !inputMsg.trim() ? "default" : "pointer",
                    opacity: sending || !inputMsg.trim() ? 0.5 : 1,
                  }}
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: IG_THEME.textSecondary }}>
            <Instagram size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
            <span style={{ fontSize: 14 }}>Select a conversation from the left to start chatting</span>
          </div>
        )}
      </div>

      {/* RIGHT PANEL: Contact Details (Collapsible) */}
      {showInfo && activeConv && (
        <div
          style={{
            width: 280,
            borderLeft: `1px solid ${IG_THEME.hairline}`,
            background: IG_THEME.panelBg,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Contact Info</span>
            <button onClick={() => setShowInfo(false)} style={{ background: "none", border: "none", color: IG_THEME.textSecondary, cursor: "pointer" }}>
              <X size={16} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingBottom: 12, borderBottom: `1px solid ${IG_THEME.hairline}` }}>
            <Avatar name={activeConv.lead_name || activeConv.ig_username || "IG"} size={56} />
            <div style={{ fontWeight: 600, fontSize: 14, textAlign: "center" }}>
              {activeConv.lead_name || `@${activeConv.ig_username}`}
            </div>
            <div style={{ fontSize: 12, color: IG_THEME.textSecondary }}>{activeConv.lead_phone || "No phone listed"}</div>
          </div>

          <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <span style={{ color: IG_THEME.textSecondary }}>Instagram ID: </span>
              <span style={{ fontFamily: "monospace" }}>{activeConv.ig_user_id}</span>
            </div>
            <div>
              <span style={{ color: IG_THEME.textSecondary }}>Lead Status: </span>
              <span style={{ color: "#25d366", fontWeight: 600 }}>{activeConv.lead_status || "New"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
