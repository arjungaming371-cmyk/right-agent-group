"use client"

// A single WhatsApp message: real bubble geometry (tails, grouping), quoted
// reply block, native media rendering, reaction chip, and the hover action
// toolbar (react / reply / forward) exactly where WhatsApp Web puts it.

import { useState } from "react"
import { Reply, Forward, Download, FileText, SmilePlus, PhoneIncoming, PhoneMissed } from "lucide-react"
import { WA, WA_FONT, fmtMsgTime, isPlaceholder, type Msg } from "./palette"
import { Ticks } from "./bits"

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "👌"]

function BubbleTail({ out }: { out: boolean }) {
  return (
    <span aria-hidden style={{ position: "absolute", top: 0, [out ? "right" : "left"]: -8, width: 9, height: 13 }}>
      <svg width="9" height="13" viewBox="0 0 9 13" style={{ display: "block" }}>
        <path d={out ? "M0 0 L9 0 L0 13 Z" : "M9 0 L0 0 L9 13 Z"} fill={out ? WA.bubbleOut : WA.bubbleIn} />
      </svg>
    </span>
  )
}

function QuoteBlock({ msg, onJump }: { msg: Msg; onJump?: (id: string) => void }) {
  const out = msg.direction === "outbound"
  const quoteIsOut = msg.quoted_from === "outbound"
  return (
    <div
      onClick={(e) => { e.stopPropagation(); msg.quoted_wa_id && onJump?.(String(msg.quoted_wa_id)) }}
      style={{
        background: out ? WA.bubbleOutDeep : WA.bubbleInDeep,
        borderLeft: `4px solid ${out ? WA.accentOut : WA.accentIn}`,
        borderRadius: 5, padding: "5px 10px", marginBottom: 3, cursor: msg.quoted_wa_id ? "pointer" : "default",
        maxWidth: 420,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: out ? WA.accentOut : WA.accentIn, marginBottom: 1 }}>
        {quoteIsOut ? "You" : msg.quoted_from === "inbound" ? "Customer" : "Message"}
      </div>
      <div style={{
        fontSize: 13, color: WA.textSecondary, lineHeight: 1.35,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {msg.quoted_text || "[message]"}
      </div>
    </div>
  )
}

function MediaBody({ msg, onOpenImage }: { msg: Msg; onOpenImage: (url: string) => void }) {
  const kind = (msg.msg_type || "text").toLowerCase()
  const src = msg.media_id
    ? `/api/whatsapp/media/${encodeURIComponent(msg.media_id)}${msg.branch_id ? `?branch=${encodeURIComponent(msg.branch_id)}` : ""}`
    : ""
  if (!src) return null

  if (kind === "image") {
    return (
      <img
        src={src} alt="Photo" loading="lazy"
        onClick={(e) => { e.stopPropagation(); onOpenImage(src) }}
        style={{ maxWidth: 316, maxHeight: 336, borderRadius: 6, display: "block", objectFit: "cover", cursor: "pointer" }}
      />
    )
  }
  if (kind === "sticker") {
    return <img src={src} alt="Sticker" loading="lazy" style={{ width: 172, height: 172, objectFit: "contain", display: "block" }} />
  }
  if (kind === "video") {
    return <video src={src} controls preload="metadata" style={{ maxWidth: 316, maxHeight: 336, borderRadius: 6, display: "block", background: "#000" }} />
  }
  if (kind === "audio") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 250, padding: "2px" }}>
        <span style={{
          width: 34, height: 34, borderRadius: "50%", background: "rgba(0,0,0,0.18)", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
        }}>🎤</span>
        <audio src={src} controls preload="metadata" style={{ height: 36, maxWidth: 230 }} />
      </div>
    )
  }
  if (kind === "document") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 250, maxWidth: 320 }}>
        <span style={{
          width: 40, height: 40, borderRadius: "50%", background: "rgba(0,0,0,0.18)", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}><FileText size={19} color={WA.accentIn} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: WA.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {msg.media_name || "Document"}
          </div>
          <div style={{ fontSize: 11, color: WA.textSecondary, marginTop: 1 }}>
            {(msg.media_mime || "file").split(";")[0]}
          </div>
        </div>
        <a
          href={src}
          download={msg.media_name || true}
          onClick={e => e.stopPropagation()}
          title="Download document"
          style={{ color: WA.textSecondary, display: "flex", padding: 6, borderRadius: "50%" }}
        >
          <Download size={17} />
        </a>
      </div>
    )
  }
  return null
}

export default function MessageBubble({
  msg, contactName, showTail, grouped, onReply, onReact, onForward, onJump,
}: {
  msg: Msg
  contactName: string
  showTail: boolean
  grouped: boolean
  onReply?: (m: Msg) => void
  onReact?: (m: Msg, emoji: string) => void
  onForward?: (m: Msg) => void
  onJump?: (id: string) => void
}) {
  const out = msg.direction === "outbound"
  const [reactOpen, setReactOpen] = useState(false)
  const canAct = !!msg.wa_message_id && (!!onReact || !!onReply || !!onForward)

  const kind = (msg.msg_type || "text").toLowerCase()

  // ---- VOICE CALL ROW (WhatsApp Business Calling) ----
  // Real WhatsApp renders calls as centered pill rows, not bubbles: icon
  // circle + "Voice call · 2m 14s" + time. Missed/declined/failed get the
  // red icon; answered calls the teal one. Inserted BEFORE the bubble path
  // — a call row never has a tail, quote block or action toolbar.
  if (kind === "call") {
    const missed = /missed|failed|declined/i.test(msg.content || "")
    return (
      <div
        id={`wa-msg-${msg.wa_message_id || msg.id}`}
        data-mid={String(msg.id)}
        className="wa-msg"
        style={{ display: "flex", justifyContent: "center", marginTop: grouped ? 6 : 14, marginBottom: 4 }}
      >
        <div
          title={missed ? "Missed WhatsApp voice call" : "WhatsApp voice call"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: WA.pill, borderRadius: 999, padding: "4px 14px 4px 6px",
            boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)", fontFamily: WA_FONT,
          }}
        >
          <span style={{
            width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
            background: missed ? "rgba(239,105,122,0.16)" : "rgba(0,168,132,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {missed ? <PhoneMissed size={13} color={WA.danger} /> : <PhoneIncoming size={13} color={WA.teal} />}
          </span>
          <span style={{ fontSize: 12.5, color: missed ? WA.danger : WA.textPrimary, fontWeight: missed ? 600 : 400, whiteSpace: "nowrap" }}>
            {msg.content || "Voice call"}
          </span>
          <span style={{ fontSize: 10.5, color: WA.tick, whiteSpace: "nowrap" }}>{fmtMsgTime(msg.created_at)}</span>
        </div>
      </div>
    )
  }

  const isMedia = ["image", "video", "audio", "document", "sticker"].includes(kind)
  const isImageish = kind === "image" || kind === "sticker"
  const caption = isMedia && msg.content && !isPlaceholder(msg.content) ? msg.content : ""
  const bodyText = isMedia ? caption : msg.content
  const hasMetaOverlay = isImageish && !caption

  return (
    <div
      id={`wa-msg-${msg.wa_message_id || msg.id}`}
      data-mid={String(msg.id)}
      className="wa-msg"
      style={{
        display: "flex", justifyContent: out ? "flex-end" : "flex-start",
        marginTop: grouped ? 3 : 14, position: "relative",
        marginBottom: msg.reaction ? 16 : 0,
      }}
      onMouseEnter={e => { e.currentTarget.classList.add("wa-msg-hover") }}
      onMouseLeave={e => { e.currentTarget.classList.remove("wa-msg-hover"); setReactOpen(false) }}
    >
      {/* hover action toolbar — react / reply / forward, like WhatsApp Web */}
      {canAct && (
        <div
          className="wa-msg-actions"
          style={{
            position: "absolute", top: -14, [out ? "left" : "right"]: 6, zIndex: 5,
            display: "flex", alignItems: "center", gap: 2, background: WA.headerBg,
            borderRadius: 999, padding: "2px 4px", boxShadow: "0 3px 12px rgba(0,0,0,0.45)",
            opacity: 0, pointerEvents: "none", transition: "opacity 120ms ease",
          }}
        >
          {onReact && (
            <button title="React" onClick={(e) => { e.stopPropagation(); setReactOpen(v => !v) }} style={actionBtnStyle}>
              <SmilePlus size={15} />
            </button>
          )}
          {onReply && (
            <button title="Reply" onClick={(e) => { e.stopPropagation(); onReply(msg) }} style={actionBtnStyle}>
              <Reply size={15} style={{ transform: "scaleX(-1)" }} />
            </button>
          )}
          {onForward && (
            <button title="Forward" onClick={(e) => { e.stopPropagation(); onForward(msg) }} style={actionBtnStyle}>
              <Forward size={15} />
            </button>
          )}
          {onReact && reactOpen && (
            <div style={{
              position: "absolute", bottom: 40, [out ? "left" : "right"]: 0, background: WA.headerBg,
              borderRadius: 999, padding: "4px 8px", display: "flex", gap: 4,
              boxShadow: "0 6px 18px rgba(0,0,0,0.5)",
            }}>
              {QUICK_REACTIONS.map(em => (
                <button
                  key={em}
                  onClick={(e) => { e.stopPropagation(); setReactOpen(false); onReact(msg, em) }}
                  style={{ fontSize: 21, background: "transparent", border: "none", cursor: "pointer", lineHeight: 1 }}
                >{em}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{
        position: "relative", maxWidth: "min(65%, 560px)", minWidth: 88,
        borderRadius: 7.5,
        borderTopRightRadius: out && !showTail ? 4 : 7.5,
        borderTopLeftRadius: !out && !showTail ? 4 : 7.5,
        background: out ? WA.bubbleOut : WA.bubbleIn,
        boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)",
        padding: hasMetaOverlay ? 3 : "6px 9px 8px 9px",
        fontFamily: WA_FONT,
      }}>
        {showTail && <BubbleTail out={out} />}
        {msg.quoted_wa_id && <QuoteBlock msg={msg} onJump={onJump} />}

        {isMedia && <MediaBody msg={msg} onOpenImage={(url) => window.open(url, "_blank")} />}

        {bodyText ? (
          <div style={{
            fontSize: 14.2, color: WA.textPrimary, lineHeight: "19px",
            whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: isMedia ? 5 : 0,
          }}>
            {/* meta floats to the classic bottom-right slot; text wraps around it */}
            <span style={{
              float: "right", display: "inline-flex", alignItems: "center", gap: 4,
              marginLeft: 10, marginTop: 6, fontSize: 11, color: out ? WA.metaOut : WA.tick,
              userSelect: "none", whiteSpace: "nowrap",
            }}>
              {fmtMsgTime(msg.created_at)}
              {out && <Ticks status={msg.status} />}
            </span>
            {bodyText}
          </div>
        ) : null}

        {/* overlay meta for photos/stickers without caption */}
        {hasMetaOverlay && (
          <span style={{
            position: "absolute", right: 8, bottom: 8, display: "inline-flex", alignItems: "center", gap: 5,
            background: "rgba(11,20,26,0.45)", borderRadius: 999, padding: "1px 7px",
            fontSize: 11, color: "rgba(255,255,255,0.92)", userSelect: "none",
          }}>
            {fmtMsgTime(msg.created_at)}
            {out && <Ticks status={msg.status} size={14} />}
          </span>
        )}
      </div>

      {/* reaction chip — overlaps the bubble bottom like the real app */}
      {msg.reaction && (
        <div style={{
          position: "absolute", bottom: -15, [out ? "left" : "right"]: 14,
          background: WA.headerBg, border: `1px solid ${WA.hairline}`, borderRadius: 999,
          padding: "1px 7px", fontSize: 13, boxShadow: "0 1px 3px rgba(0,0,0,0.35)", cursor: "default", zIndex: 2,
        }} title={`Reaction${out ? "" : ` from ${contactName}`}`}>
          {msg.reaction}
        </div>
      )}
    </div>
  )
}

const actionBtnStyle: React.CSSProperties = {
  width: 26, height: 26, borderRadius: "50%", border: "none", background: "transparent",
  color: WA.textSecondary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
}
