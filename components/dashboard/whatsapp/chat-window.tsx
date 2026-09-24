"use client"

// Right panel — the real WhatsApp Web conversation view: contact header with
// online/last-seen, end-to-end encryption notice, TODAY/YESTERDAY date pills,
// unread separator, grouped bubbles with tails, hover actions, scroll-to-
// bottom FAB, in-chat search, and the full composer (emoji picker, photo &
// document attach with upload, reply bar, mic dictation, send).

import { useEffect, useRef, useState, useLayoutEffect } from "react"
import {
  ChevronLeft, ChevronDown, Search, PhoneCall, MoreVertical, Smile, Paperclip,
  Send, X, ImagePlus, FileText, Lock, MessageCircle, Info, BellOff, Bell, Archive,
  Download, History,
} from "lucide-react"
import { WA, WA_FONT, CHAT_WALLPAPER, fmtDatePill, fmtLastSeen, type Lead, type Msg } from "./palette"
import { Avatar, IconBtn } from "./bits"
import MessageBubble from "./message-bubble"
import EmojiPicker from "./emoji-picker"
import VoiceDictation from "../../ui/voice-dictation"

export default function ChatWindow({
  lead, messages, ready, canEdit, sending, text, setText, onSend,
  onBack, replyTo, setReplyTo, onReact, onForward, onToggleInfo,
  unreadAtOpen, onAIcall, calling, onMute, onArchive,
  uploading, uploadName, onFilePicked,
  hasMore, loadingEarlier, onLoadEarlier,
}: {
  lead: Lead
  messages: Msg[]
  ready: boolean
  canEdit: boolean
  sending: boolean
  text: string
  setText: React.Dispatch<React.SetStateAction<string>>
  onSend: () => void
  onBack: () => void
  replyTo: Msg | null
  setReplyTo: (m: Msg | null) => void
  onReact: (m: Msg, emoji: string) => void
  onForward: (m: Msg) => void
  onToggleInfo: () => void
  unreadAtOpen: number
  onAIcall: () => void
  calling: boolean
  onMute: () => void
  onArchive: () => void
  uploading: boolean
  uploadName: string
  onFilePicked: (file: File, kind: "media" | "document") => void
  hasMore?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => Promise<void>
}) {
  const [showEmoji, setShowEmoji] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState("")
  const [matchIdx, setMatchIdx] = useState(0)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  // fullscreen image viewer (real WhatsApp opens photos in an overlay)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)
  // scroll anchor for "Load earlier" — { prevHeight, prevTop } snapshot taken
  // before the prepend; restored after commit so the viewport stays glued to
  // the message the user was reading (exactly like WhatsApp history paging)
  const restoreAnchorRef = useRef<{ prevHeight: number; prevTop: number } | null>(null)

  const lastInbound = [...messages].reverse().find(m => m.direction === "inbound")

  // autoscroll when new messages arrive (only when the user is at the bottom —
  // exactly like WhatsApp: reading history is never yanked to the present)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (atBottom) el.scrollTop = el.scrollHeight
  }, [messages])
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lead.id])

  // keep the reading position stable after older messages are prepended
  useLayoutEffect(() => {
    const anchor = restoreAnchorRef.current
    const el = scrollRef.current
    if (!anchor || !el) return
    restoreAnchorRef.current = null
    el.scrollTop = el.scrollHeight - anchor.prevHeight + anchor.prevTop
  }, [messages.length])

  async function handleLoadEarlier() {
    const el = scrollRef.current
    if (!el || !onLoadEarlier) return
    restoreAnchorRef.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop }
    await onLoadEarlier()
  }

  // Esc closes overlays top-down: lightbox → emoji → attach → menu → reply
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (lightbox) { setLightbox(null); return }
      if (showEmoji) { setShowEmoji(false); return }
      if (attachOpen) { setAttachOpen(false); return }
      if (menuOpen) { setMenuOpen(false); return }
      if (replyTo) setReplyTo(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [lightbox, showEmoji, attachOpen, menuOpen, replyTo])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120)
  }
  function scrollBottom() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setAtBottom(true)
  }

  function growTA() {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(96, ta.scrollHeight)}px`
  }

  // ---- in-chat search ----
  const matches = searchQ.trim()
    ? messages.filter(m => (m.content || "").toLowerCase().includes(searchQ.trim().toLowerCase())).map(m => String(m.id))
    : []
  function jumpToMsg(id: string) {
    const el = document.getElementById(`wa-msg-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      setHighlight(id)
      setTimeout(() => setHighlight(null), 1600)
    }
  }
  function stepMatch(dir: 1 | -1) {
    if (!matches.length) return
    const next = (matchIdx + dir + matches.length) % matches.length
    setMatchIdx(next)
    jumpToMsg(matches[next])
  }

  const unreadCount = lead.unread ?? 0
  // separator sits before the first unread inbound message (computed BEFORE
  // the read receipt flips the badge — snapshot passed by the parent)
  const sepIndex = unreadAtOpen > 0 ? Math.max(0, messages.length - unreadAtOpen) : -1
  const scrollToUnread = sepIndex >= 0 && unreadAtOpen > 0

  useEffect(() => {
    // open straight to the first unread message when there are any
    if (scrollToUnread && messages[sepIndex]) {
      const t = setTimeout(() => jumpToMsg(String(messages[sepIndex].id)), 150)
      return () => clearTimeout(t)
    }
  }, [lead.id, messages.length])

  const replyPreview = replyTo?.content && !/^\[.*\]$/.test((replyTo.content || "").trim())
    ? replyTo.content
    : replyTo
      ? ({ image: "📷 Photo", video: "🎬 Video", audio: "🎤 Voice message", document: "📄 Document", sticker: "🌼 Sticker" } as Record<string, string>)[replyTo.msg_type || ""] || "[message]"
      : ""

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: WA.chatBg, minWidth: 0, fontFamily: WA_FONT, position: "relative" }}>
      {/* ---- header ---- */}
      <div style={{ padding: "9px 12px 9px 8px", background: WA.headerBg, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span className="md:hidden" style={{ display: "flex" }}>
          <IconBtn title="Back" onClick={onBack}><ChevronLeft size={24} /></IconBtn>
        </span>
        <button
          onClick={onToggleInfo}
          style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
        >
          <Avatar name={lead.name} phone={lead.phone} size={40} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 16, color: WA.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name}</div>
            <div style={{ fontSize: 12.5, color: WA.textSecondary, marginTop: 0 }}>
              {fmtLastSeen(lastInbound?.created_at || (lead.last_direction === "inbound" ? lead.last_message_time : null))}
            </div>
          </div>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          {canEdit && (
            <IconBtn title="Call this lead with Priya (AI voice agent)" onClick={onAIcall} disabled={calling}>
              <PhoneCall size={19} opacity={calling ? 0.5 : 1} />
            </IconBtn>
          )}
          <IconBtn title="Search messages" active={searchOpen} onClick={() => { setSearchOpen(v => !v); setSearchQ(""); setMatchIdx(0) }}>
            <Search size={19} />
          </IconBtn>
          <div style={{ position: "relative" }}>
            <IconBtn title="Menu" active={menuOpen} onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}>
              <MoreVertical size={19} />
            </IconBtn>
            {menuOpen && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: "absolute", right: 0, top: 42, minWidth: 210, background: "#233138", zIndex: 40,
                  borderRadius: 8, boxShadow: "0 8px 30px rgba(0,0,0,0.55)", padding: "6px 0", border: `1px solid ${WA.hairline}`,
                }}
              >
                <MItem icon={<Info size={16} />} label="Contact info" onClick={() => { setMenuOpen(false); onToggleInfo() }} />
                <MItem icon={lead.wa_muted ? <Bell size={16} /> : <BellOff size={16} />} label={lead.wa_muted ? "Unmute notifications" : "Mute notifications"} onClick={() => { setMenuOpen(false); onMute() }} />
                <MItem icon={<Archive size={16} />} label={lead.wa_archived ? "Unarchive chat" : "Archive chat"} onClick={() => { setMenuOpen(false); onArchive() }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* in-chat search bar */}
      {searchOpen && (
        <div style={{ background: WA.headerBg, padding: "0 12px 10px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ flex: 1, background: WA.panelBg, borderRadius: 10, display: "flex", alignItems: "center", padding: "7px 12px", gap: 8 }}>
            <Search size={14} color={WA.textSecondary} />
            <input
              autoFocus
              value={searchQ}
              onChange={e => { setSearchQ(e.target.value); setMatchIdx(0) }}
              onKeyDown={e => { if (e.key === "Enter") stepMatch(e.shiftKey ? -1 : 1) }}
              placeholder={`Search in ${lead.name}`}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: WA.textPrimary, fontSize: 13.5 }}
            />
          </div>
          {searchQ && (
            <>
              <span style={{ fontSize: 12.5, color: WA.textSecondary, whiteSpace: "nowrap" }}>
                {matches.length ? `${matchIdx + 1} of ${matches.length}` : "No results"}
              </span>
              <IconBtn title="Previous" onClick={() => stepMatch(-1)}><ChevronDown size={16} style={{ transform: "rotate(180deg)" }} /></IconBtn>
              <IconBtn title="Next" onClick={() => stepMatch(1)}><ChevronDown size={16} /></IconBtn>
            </>
          )}
        </div>
      )}

      {/* ---- messages ---- */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1, overflowY: "auto", padding: "16px 7% 12px", position: "relative",
          backgroundImage: CHAT_WALLPAPER, backgroundSize: "140px 140px",
        }}
      >
        {/* encryption notice — the real chat opens with this */}
        {/* "Load earlier messages" — real WhatsApp pages history upward */}
        {hasMore && messages.length > 0 && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <button
              onClick={handleLoadEarlier}
              disabled={loadingEarlier}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, background: WA.pill,
                color: WA.tealBright, fontSize: 12.5, fontWeight: 500, border: "none",
                borderRadius: 999, padding: "6px 16px", cursor: loadingEarlier ? "default" : "pointer",
                opacity: loadingEarlier ? 0.7 : 1, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)",
              }}
            >
              {loadingEarlier
                ? <span style={{ width: 13, height: 13, borderRadius: "50%", border: `2px solid ${WA.tealBright}44`, borderTopColor: WA.tealBright, display: "inline-block", animation: "spin 0.8s linear infinite" }} />
                : <History size={14} />}
              {loadingEarlier ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <div style={{
            background: WA.pill, borderRadius: 8, padding: "7px 14px", maxWidth: "88%",
            fontSize: 12.5, color: "#ffd279", textAlign: "center", lineHeight: 1.45,
            display: "flex", alignItems: "center", gap: 7, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)",
          }}>
            <Lock size={12} style={{ flexShrink: 0, color: WA.textSecondary }} />
            <span>Messages are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.</span>
          </div>
        </div>

        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: WA.textSecondary, fontSize: 14, marginTop: 70 }}>
            <MessageCircle size={52} strokeWidth={1.2} style={{ margin: "0 auto 14px", opacity: 0.35, display: "block" }} />
            <div style={{ fontWeight: 500, color: WA.textPrimary }}>No messages yet</div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>Say hello to start the conversation</div>
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : null
          const dateBreak = !prev || new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString()
          const grouped = !!prev && !dateBreak && prev.direction === msg.direction &&
            (new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60_000
          const showTail = !grouped
          const isSep = i === sepIndex && unreadAtOpen > 0
          const isHighlighted = highlight != null && String(msg.id) === highlight
          return (
            <div key={msg.id}>
              {dateBreak && (
                <div style={{ textAlign: "center", margin: "16px 0 12px" }}>
                  <span style={{
                    background: WA.pill, color: WA.textSecondary, fontSize: 12.5, fontWeight: 500,
                    padding: "6px 14px", borderRadius: 8, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)",
                  }}>
                    {fmtDatePill(msg.created_at)}
                  </span>
                </div>
              )}
              {isSep && (
                <div style={{ textAlign: "center", margin: "12px 0" }}>
                  <span style={{
                    background: WA.pill, color: WA.tealBright, fontSize: 12, fontWeight: 500,
                    padding: "5px 14px", borderRadius: 8,
                  }}>
                    {unreadAtOpen} UNREAD MESSAGE{unreadAtOpen > 1 ? "S" : ""}
                  </span>
                </div>
              )}
              <div
                style={{
                  borderRadius: 8, transition: "box-shadow 300ms ease",
                  boxShadow: isHighlighted ? `0 0 0 2px ${WA.accentIn}` : "none",
                }}
              >
                <MessageBubble
                  msg={msg}
                  contactName={lead.name}
                  showTail={showTail}
                  grouped={grouped}
                  onReply={canEdit ? setReplyTo : undefined}
                  onReact={canEdit ? onReact : undefined}
                  onForward={canEdit ? onForward : undefined}
                  onJump={jumpToMsg}
                  onOpenImage={setLightbox}
                />
              </div>
            </div>
          )
        })}
        <div style={{ height: 8 }} />
      </div>

      {/* scroll-to-bottom FAB with unread badge */}
      {!atBottom && (
        <button
          onClick={scrollBottom}
          title="Scroll to latest"
          style={{
            position: "absolute", right: 26, bottom: 96, width: 42, height: 42, borderRadius: "50%",
            background: WA.headerBg, border: `1px solid ${WA.hairline}`, cursor: "pointer", zIndex: 20,
            display: "flex", alignItems: "center", justifyContent: "center", color: WA.textPrimary,
            boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
          }}
        >
          <ChevronDown size={22} />
          {unreadCount > 0 && (
            <span style={{
              position: "absolute", top: -5, right: -3, background: WA.tealBright, color: "#111b21",
              fontSize: 10.5, fontWeight: 700, borderRadius: 999, minWidth: 18, height: 18,
              display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
            }}>{unreadCount}</span>
          )}
        </button>
      )}

      {/* ---- composer ---- */}
      {canEdit ? (
        <div style={{ padding: "8px 12px 10px", background: WA.headerBg, position: "relative", flexShrink: 0 }}>
          {/* reply bar */}
          {replyTo && (
            <div style={{ background: "#1d282f", borderRadius: 8, margin: "0 0 8px", padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 3, alignSelf: "stretch", background: replyTo.direction === "outbound" ? WA.accentOut : WA.accentIn, borderRadius: 3 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: replyTo.direction === "outbound" ? WA.accentOut : WA.accentIn }}>
                  {replyTo.direction === "outbound" ? "You" : lead.name}
                </div>
                <div style={{ fontSize: 13, color: WA.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {replyPreview}
                </div>
              </div>
              <IconBtn title="Cancel reply" onClick={() => setReplyTo(null)}><X size={17} /></IconBtn>
            </div>
          )}

          {/* upload progress strip */}
          {uploading && (
            <div style={{ background: WA.chipActiveBg, borderRadius: 8, margin: "0 0 8px", padding: "8px 12px", fontSize: 13, color: WA.tealBright, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${WA.tealBright}44`, borderTopColor: WA.tealBright, display: "inline-block", animation: "spin 0.8s linear infinite" }} />
              Uploading {uploadName}…
            </div>
          )}

          {showEmoji && (
            <EmojiPicker onPick={(em) => { setText(t => t + em); taRef.current?.focus() }} onClose={() => setShowEmoji(false)} />
          )}
          {attachOpen && (
            <div style={{
              position: "absolute", bottom: 66, left: 44, background: "#233138", borderRadius: 12, zIndex: 35,
              boxShadow: "0 8px 30px rgba(0,0,0,0.55)", padding: "6px 0", minWidth: 230, border: `1px solid ${WA.hairline}`,
            }}>
              <MItem icon={<ImagePlus size={17} />} label="Photos & videos" onClick={() => { setAttachOpen(false); mediaInputRef.current?.click() }} />
              <MItem icon={<FileText size={17} />} label="Document" onClick={() => { setAttachOpen(false); docInputRef.current?.click() }} />
            </div>
          )}

          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <IconBtn title="Emoji" active={showEmoji} onClick={() => { setShowEmoji(v => !v); setAttachOpen(false) }}><Smile size={22} /></IconBtn>
            <IconBtn title="Attach" active={attachOpen} onClick={() => { setAttachOpen(v => !v); setShowEmoji(false) }}><Paperclip size={20} /></IconBtn>

            <div style={{ flex: 1, background: WA.panelBg, borderRadius: 10, display: "flex", alignItems: "flex-end", padding: "2px 6px 2px 14px" }}>
              <textarea
                ref={taRef}
                rows={1}
                placeholder="Type a message"
                value={text}
                onChange={e => { setText(e.target.value); growTA() }}
                onFocus={() => { setShowEmoji(false); setAttachOpen(false) }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend() } }}
                disabled={ready === false}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none", resize: "none",
                  color: WA.textPrimary, fontSize: 15, padding: "11px 6px", lineHeight: 1.4,
                  maxHeight: 96, fontFamily: WA_FONT,
                }}
              />
            </div>

            {text.trim() ? (
              <IconBtn title="Send" onClick={onSend} disabled={sending || ready === false} tint={WA.teal}>
                <Send size={21} style={{ transform: "rotate(0deg)" }} />
              </IconBtn>
            ) : (
              <VoiceDictation
                onTranscript={(spoken) => setText(prev => (prev ? `${prev} ${spoken}` : spoken))}
                size={21}
                style={{ border: "none", background: "transparent", color: WA.textSecondary, width: 36, height: 36, borderRadius: "50%" }}
                title="Dictate a message (mic)"
              />
            )}
          </div>

          {/* hidden file inputs */}
          <input
            ref={mediaInputRef} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4"
            onChange={e => { const f = e.target.files?.[0]; if (f) onFilePicked(f, "media"); e.target.value = "" }}
          />
          <input
            ref={docInputRef} type="file" hidden
            accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.ppt,.pptx"
            onChange={e => { const f = e.target.files?.[0]; if (f) onFilePicked(f, "document"); e.target.value = "" }}
          />
        </div>
      ) : (
        <div style={{ padding: "14px 16px", background: WA.headerBg, textAlign: "center", color: WA.textSecondary, fontSize: 13 }}>
          View only — no send permission
        </div>
      )}

      {/* ---- fullscreen photo viewer (click a photo in the chat) ---- */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 120, background: "rgba(11,20,26,0.94)",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", top: 14, right: 14, display: "flex", gap: 8, zIndex: 121, cursor: "default" }}
          >
            <a
              href={lightbox}
              download
              title="Download photo"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 40, height: 40, borderRadius: "50%", background: WA.headerBg, color: WA.textPrimary,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                boxShadow: "0 4px 14px rgba(0,0,0,0.5)", textDecoration: "none",
              }}
            >
              <Download size={19} />
            </a>
            <button
              title="Close (Esc)"
              onClick={() => setLightbox(null)}
              style={{
                width: 40, height: 40, borderRadius: "50%", background: WA.headerBg, border: "none",
                color: WA.textPrimary, display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
              }}
            >
              <X size={21} />
            </button>
          </div>
          <img
            src={lightbox}
            alt="Photo"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "92vw", maxHeight: "88vh", borderRadius: 6, objectFit: "contain",
              boxShadow: "0 30px 80px rgba(0,0,0,0.6)", cursor: "default",
            }}
          />
        </div>
      )}
    </div>
  )
}

function MItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 13, width: "100%", padding: "11px 18px",
        background: "transparent", border: "none", cursor: "pointer", fontSize: 14, fontFamily: WA_FONT,
        color: WA.textPrimary, textAlign: "left", whiteSpace: "nowrap",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)" }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent" }}
    >
      {icon}
      {label}
    </button>
  )
}
