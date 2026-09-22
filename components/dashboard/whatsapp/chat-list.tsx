"use client"

// Left panel — the real WhatsApp Web chat list: profile-row header, search,
// All / Unread / Favourites / Groups filter chips, the Archived row, and rows
// with hover menus (pin / mute / archive) — every action wired to the API.

import { useState, useRef } from "react"
import { Search, MessageSquarePlus, MoreVertical, Archive, Pin, BellOff, ChevronDown, Users, ArrowLeft } from "lucide-react"
import { WA, WA_FONT, fmtListTime, mediaPreview, type Lead } from "./palette"
import { Avatar, IconBtn, Ticks } from "./bits"
import VoiceDictation from "../../ui/voice-dictation"
import { smartFilter } from "@/lib/smart-search"

export type ListTab = "all" | "unread" | "favourites" | "groups"

export default function ChatList({
  leads, selected, ready, canEdit, tab, onTab, archivedOpen, onArchivedOpen,
  onOpenArchived, onSelect, onNewChat, onPin, onMute, onArchive, onRefresh,
}: {
  leads: Lead[]
  selected: Lead | null
  ready: boolean
  canEdit: boolean
  tab: ListTab
  onTab: (t: ListTab) => void
  archivedOpen: boolean
  onArchivedOpen: (open: boolean) => void
  onOpenArchived: () => void
  onSelect: (l: Lead) => void
  onNewChat: () => void
  onPin: (l: Lead) => void
  onMute: (l: Lead) => void
  onArchive: (l: Lead) => void
  onRefresh: () => void
}) {
  const [search, setSearch] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const archivedCount = leads.filter(l => l.wa_archived).length
  const visible = leads.filter(l => archivedOpen ? !!l.wa_archived : !l.wa_archived)

  const tabFiltered = visible.filter(l => {
    if (tab === "unread") return (l.unread ?? 0) > 0
    if (tab === "favourites") return !!l.pinned
    if (tab === "groups") return false // 1:1 Cloud API chats only — honest empty state
    return true
  })
  const filtered = smartFilter(tabFiltered, search, (l) => [
    l.name, l.phone, l.whatsapp_number, l.last_message, l.product_interest, l.address, l.notes,
  ])
  const unreadChats = visible.filter(l => (l.unread ?? 0) > 0).length
  const unreadTotal = visible.reduce((n, l) => n + (l.unread ?? 0), 0)

  // ---- Archived screen (full list replacement, like WhatsApp) ----
  if (archivedOpen) {
    return (
      <div style={{ borderRight: `1px solid ${WA.hairline}`, flexDirection: "column", background: WA.panelBg, flexShrink: 0, display: "flex", width: "100%" }} className="w-full md:w-[380px]">
        <div style={{ padding: "18px 12px 18px 8px", background: WA.headerBg, display: "flex", alignItems: "center", gap: 6 }}>
          <IconBtn title="Back to chats" onClick={() => onArchivedOpen(false)}><ArrowLeft size={20} /></IconBtn>
          <div style={{ fontWeight: 600, fontSize: 16.5, color: WA.textPrimary, display: "flex", alignItems: "center", gap: 10 }}>
            <Archive size={18} /> Archived
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: WA.textSecondary, fontSize: 13.5 }}>
              No archived chats
            </div>
          )}
          {filtered.map(lead => (
            <Row
              key={lead.id} lead={lead} selected={selected} canEdit={canEdit}
              onSelect={l => { onSelect(l); onArchivedOpen(false) }}
              onPin={onPin} onMute={onMute} onArchive={onArchive}
              rowMenu={rowMenu} setRowMenu={setRowMenu} unarchive
            />
          ))}
        </div>
      </div>
    )
  }

  // ---- Normal list ----
  return (
    <div
      className={`${selected ? "hidden md:flex" : "flex"} w-full md:w-[380px]`}
      style={{ borderRight: `1px solid ${WA.hairline}`, flexDirection: "column", background: WA.panelBg, flexShrink: 0 }}
      onClick={() => setRowMenu(null)}
    >
      {/* WhatsApp Web header row */}
      <div style={{ padding: "10px 12px 10px 16px", background: WA.headerBg, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <span style={{
            width: 40, height: 40, borderRadius: "50%", background: WA.teal, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <WhatsAppGlyph size={22} />
          </span>
          <div style={{ fontWeight: 600, fontSize: 17, color: WA.textPrimary, fontFamily: WA_FONT }}>Chats</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconBtn title="New chat" onClick={onNewChat}><MessageSquarePlus size={20} /></IconBtn>
          <div style={{ position: "relative" }}>
            <IconBtn title="Menu" active={menuOpen} onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}>
              <MoreVertical size={20} />
            </IconBtn>
            {menuOpen && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: "absolute", right: 0, top: 42, minWidth: 190, background: "#233138", zIndex: 40,
                  borderRadius: 8, boxShadow: "0 8px 30px rgba(0,0,0,0.55)", padding: "6px 0", border: `1px solid ${WA.hairline}`,
                }}
              >
                <MenuItem icon={<Archive size={16} />} label={`Archived chats${archivedCount ? ` (${archivedCount})` : ""}`} onClick={() => { setMenuOpen(false); onOpenArchived() }} />
                <MenuItem icon={<Search size={15} />} label="Refresh chats" onClick={() => { setMenuOpen(false); onRefresh() }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* offline strip — WhatsApp shows a slim connecting bar, never a big banner */}
      {!ready && (
        <div style={{ background: "#49272c", color: "#ffd7d7", fontSize: 12.5, padding: "7px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef697a", flexShrink: 0 }} />
          Offline — check WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID. Messages can't send.
        </div>
      )}

      {/* search */}
      <div style={{ padding: "8px 12px 4px" }}>
        <div style={{ background: WA.headerBg, borderRadius: 10, display: "flex", alignItems: "center", padding: "7px 12px", gap: 10 }}>
          <Search size={15} strokeWidth={2.2} style={{ color: WA.textSecondary, flexShrink: 0 }} />
          <input
            placeholder="Search or start a new chat"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: WA.textPrimary, fontSize: 14, padding: 0, fontFamily: WA_FONT }}
          />
          <VoiceDictation onTranscript={(t: string) => setSearch(t)} title="Search contacts by voice" />
        </div>
      </div>

      {/* filter chips — All / Unread / Favourites / Groups */}
      <div style={{ display: "flex", gap: 8, padding: "10px 12px 8px", flexWrap: "wrap" }}>
        {([["all", "All"], ["unread", unreadChats ? `Unread ${unreadChats}` : "Unread"], ["favourites", "Favourites"], ["groups", "Groups"]] as [ListTab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => onTab(t)}
            style={{
              padding: "6px 15px", borderRadius: 999, fontSize: 13.5, fontWeight: 500, border: "none", cursor: "pointer",
              fontFamily: WA_FONT,
              background: tab === t ? WA.chipActiveBg : WA.headerBg,
              color: tab === t ? WA.tealBright : WA.textSecondary,
              boxShadow: tab === t ? `inset 0 0 0 1px ${WA.teal}` : "none",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* archived row */}
      {archivedCount > 0 && (
        <div
          onClick={onOpenArchived}
          style={{
            padding: "12px 16px", display: "flex", alignItems: "center", gap: 18, cursor: "pointer",
            borderBottom: `1px solid ${WA.hairline}`,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = WA.hover }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent" }}
        >
          <Archive size={19} color={WA.teal} style={{ marginLeft: 14, flexShrink: 0 }} />
          <div style={{ fontSize: 15, color: WA.textPrimary, fontWeight: 500, flex: 1, fontFamily: WA_FONT }}>Archived</div>
          <div style={{ fontSize: 12.5, color: WA.textSecondary }}>{archivedCount}</div>
        </div>
      )}

      {/* rows */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", paddingBottom: 76 }}>
        {filtered.length === 0 && (
          <div style={{ padding: 28, textAlign: "center", color: WA.textSecondary, fontSize: 13.5 }}>
            {tab === "groups" ? (
              <>
                <Users size={34} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
                <div style={{ color: WA.textPrimary, fontWeight: 500, marginBottom: 4 }}>No group conversations</div>
                <div>WhatsApp Cloud API chats are 1-on-1 with customers</div>
              </>
            ) : tab === "favourites" ? (
              "Pin a chat to see it under Favourites"
            ) : tab === "unread" ? (
              "You're all caught up 🎉"
            ) : search ? "No chats match your search" : "No conversations yet"}
          </div>
        )}
        {filtered.map(lead => (
          <Row
            key={lead.id} lead={lead} selected={selected} canEdit={canEdit}
            onSelect={onSelect} onPin={onPin} onMute={onMute} onArchive={onArchive}
            rowMenu={rowMenu} setRowMenu={setRowMenu}
          />
        ))}
      </div>
    </div>
  )
}

// ---- one chat row ----
function Row({
  lead, selected, canEdit, onSelect, onPin, onMute, onArchive, rowMenu, setRowMenu, unarchive,
}: {
  lead: Lead; selected: Lead | null; canEdit: boolean
  onSelect: (l: Lead) => void; onPin: (l: Lead) => void; onMute: (l: Lead) => void; onArchive: (l: Lead) => void
  rowMenu: string | null; setRowMenu: (id: string | null) => void; unarchive?: boolean
}) {
  const isActive = selected?.id === lead.id
  const hasUnread = (lead.unread ?? 0) > 0
  const mediaPrev = mediaPreview(lead.last_type, lead.last_media_name)
  const preview = mediaPrev || lead.last_message || lead.phone
  const lastIsOut = lead.last_direction === "outbound"

  return (
    <div
      onClick={() => onSelect(lead)}
      style={{
        padding: "10px 12px 10px 16px", cursor: "pointer", position: "relative",
        background: isActive ? WA.selected : "transparent",
        display: "flex", alignItems: "center", gap: 13, fontFamily: WA_FONT,
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = WA.hover }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent" }}
    >
      <Avatar name={lead.name} phone={lead.phone} size={47} />
      <div style={{ flex: 1, minWidth: 0, borderBottom: `1px solid ${WA.hairline}`, paddingBottom: 11, marginBottom: -11, paddingTop: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
          <div style={{ fontWeight: 500, fontSize: 15.5, color: WA.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, paddingRight: 8 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{lead.name}</span>
            {lead.wa_muted && <BellOff size={13} style={{ color: WA.textSecondary, flexShrink: 0 }} />}
          </div>
          <div style={{ fontSize: 12, color: hasUnread ? WA.tealBright : WA.textSecondary, flexShrink: 0 }}>
            {fmtListTime(lead.last_message_time)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 13.5, color: WA.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
            {lastIsOut && <Ticks status={lead.last_status} size={15} />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{preview}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
            {(lead.unread ?? 0) > 0 && (
              <span style={{
                background: WA.tealBright, color: "#111b21", fontSize: 11, fontWeight: 700,
                borderRadius: 999, minWidth: 19, height: 19, display: "flex", alignItems: "center",
                justifyContent: "center", padding: "0 5px",
              }}>
                {lead.unread}
              </span>
            )}
            {lead.pinned && <Pin size={13} style={{ color: WA.textSecondary, flexShrink: 0, transform: "rotate(45deg)" }} />}
            {canEdit && (
              <button
                onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === lead.id ? null : lead.id) }}
                title="Chat options"
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2, display: "flex", color: WA.textSecondary, opacity: rowMenu === lead.id ? 1 : 0 }}
              >
                <ChevronDown size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {rowMenu === lead.id && canEdit && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "absolute", right: 14, top: 44, minWidth: 200, background: "#233138", zIndex: 40,
            borderRadius: 8, boxShadow: "0 8px 30px rgba(0,0,0,0.55)", padding: "6px 0",
            border: `1px solid ${WA.hairline}`,
          }}
        >
          <MenuItem icon={<Pin size={15} style={{ transform: "rotate(45deg)" }} />} label={lead.pinned ? "Unpin chat" : "Pin chat"} onClick={() => { setRowMenu(null); onPin(lead) }} />
          <MenuItem icon={<BellOff size={15} />} label={lead.wa_muted ? "Unmute notifications" : "Mute notifications"} onClick={() => { setRowMenu(null); onMute(lead) }} />
          <MenuItem icon={<Archive size={15} />} label={unarchive ? "Unarchive chat" : "Archive chat"} onClick={() => { setRowMenu(null); onArchive(lead) }} />
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 16px",
        background: "transparent", border: "none", cursor: "pointer", fontSize: 14, fontFamily: WA_FONT,
        color: danger ? WA.danger : WA.textPrimary, textAlign: "left",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)" }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent" }}
    >
      {icon}
      {label}
    </button>
  )
}

export function WhatsAppGlyph({ size = 20, color = "white" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12.04 2a9.9 9.9 0 0 0-8.4 15.2L2.05 22l4.94-1.55A9.9 9.9 0 1 0 12.04 2Zm0 18.02a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-2.93.92.93-2.86-.2-.3a8.12 8.12 0 1 1 6.63 3.55Zm4.45-6.08c-.24-.12-1.44-.71-1.66-.79-.22-.08-.38-.12-.55.12-.16.24-.62.79-.76.95-.14.16-.28.18-.52.06-.24-.12-1.03-.38-1.96-1.21-.72-.65-1.21-1.44-1.35-1.69-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.32-.75-1.8-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.1.16 1.52.1.46-.07 1.44-.59 1.64-1.16.2-.57.2-1.05.14-1.16-.06-.1-.22-.16-.46-.28Z" />
    </svg>
  )
}
