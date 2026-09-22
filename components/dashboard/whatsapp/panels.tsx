"use client"

// Side panels & modals: WhatsApp contact info (with mute/archive switches),
// the "New chat" screen and the Forward-to picker.

import { useState } from "react"
import { X, PhoneCall, Search, Wallet, MapPin, Phone, Languages, Tag, StickyNote, Users, Bell, BellOff, Archive } from "lucide-react"
import { WA, WA_FONT, fmtMoney, SENTIMENT_COLOR, STAGE_LABEL, type Lead, type Msg } from "./palette"
import { Avatar, IconBtn, RoundAction } from "./bits"

// ---- Contact info (right drawer) ----
export function ContactInfo({
  lead, onClose, canEdit, onMute, onArchive, onAIcall, calling,
}: {
  lead: Lead
  onClose: () => void
  canEdit: boolean
  onMute: () => void
  onArchive: () => void
  onAIcall: () => void
  calling: boolean
}) {
  const knownIncome = lead.facts?.monthly_income ? fmtMoney(lead.facts.monthly_income) : null
  return (
    <div
      className="fixed inset-0 z-40 md:relative md:inset-auto"
      style={{ background: WA.panelBg, borderLeft: `1px solid ${WA.hairline}`, display: "flex", flexDirection: "column", width: "100%", flexShrink: 0 }}
    >
      <div className="md:w-[360px] w-full" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* header */}
        <div style={{ padding: "14px 20px", background: WA.headerBg, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: WA.textPrimary, fontFamily: WA_FONT }}>Contact info</span>
          <IconBtn title="Close" onClick={onClose}><X size={19} /></IconBtn>
        </div>

        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 76 }}>
          {/* identity */}
          <div style={{ padding: "30px 24px", textAlign: "center", borderBottom: `1px solid ${WA.hairline}`, background: WA.headerBg }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <Avatar name={lead.name} phone={lead.phone} size={110} />
            </div>
            <div style={{ fontSize: 19, fontWeight: 500, color: WA.textPrimary, fontFamily: WA_FONT }}>{lead.name}</div>
            <div style={{ fontSize: 14, color: WA.textSecondary, marginTop: 3 }}>{lead.phone}</div>
            {lead.stage && (
              <span style={{
                display: "inline-block", marginTop: 12, fontSize: 11.5, fontWeight: 600, padding: "4px 12px", borderRadius: 999,
                background: `${SENTIMENT_COLOR[lead.sentiment || "neutral"]}1e`, color: SENTIMENT_COLOR[lead.sentiment || "neutral"],
              }}>
                {STAGE_LABEL[lead.stage] || lead.stage}
              </span>
            )}
          </div>

          {/* quick actions — everything here is a live button */}
          {canEdit && (
            <div style={{ display: "flex", justifyContent: "center", gap: 18, padding: "18px 12px", borderBottom: `1px solid ${WA.hairline}` }}>
              <RoundAction icon={<PhoneCall size={18} />} label="AI call" onClick={onAIcall} />
              <RoundAction icon={lead.wa_muted ? <Bell size={18} /> : <BellOff size={18} />} label={lead.wa_muted ? "Unmute" : "Mute"} onClick={onMute} />
              <RoundAction icon={<Archive size={18} />} label={lead.wa_archived ? "Unarchive" : "Archive"} onClick={onArchive} />
            </div>
          )}

          {lead.ai_summary && (
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${WA.hairline}` }}>
              <div style={{ fontSize: 13, color: WA.textSecondary, marginBottom: 6 }}>About</div>
              <div style={{ fontSize: 13.5, color: WA.textPrimary, lineHeight: 1.55, fontFamily: WA_FONT }}>{lead.ai_summary}</div>
            </div>
          )}

          <div style={{ borderBottom: `1px solid ${WA.hairline}`, padding: "6px 0" }}>
            <InfoRow icon={Tag} label="Loan interest" value={lead.product_interest} />
            <InfoRow icon={Wallet} label="Loan amount" value={lead.loan_amount ? fmtMoney(lead.loan_amount) : null} />
            <InfoRow icon={Wallet} label="Monthly income (from conversation)" value={knownIncome} />
            <InfoRow icon={MapPin} label="Address" value={lead.address} />
            <InfoRow icon={Phone} label="Alternate / WhatsApp number" value={lead.whatsapp_number !== lead.phone ? lead.whatsapp_number : null} />
            <InfoRow icon={Languages} label="Preferred language" value={lead.language ? lead.language[0].toUpperCase() + lead.language.slice(1) : null} />
          </div>

          {lead.notes && (
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${WA.hairline}` }}>
              <div style={{ display: "flex", gap: 14 }}>
                <StickyNote size={17} strokeWidth={1.8} style={{ color: WA.textSecondary, flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: WA.textSecondary, marginBottom: 2 }}>Notes</div>
                  <div style={{ fontSize: 13.5, color: WA.textPrimary, lineHeight: 1.5, fontFamily: WA_FONT }}>{lead.notes}</div>
                </div>
              </div>
            </div>
          )}

          <div style={{ padding: "12px 20px", fontSize: 11.5, color: WA.textSecondary }}>
            Source: {lead.source || "manual"}{lead.status ? ` · Status: ${lead.status}` : ""}
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div style={{ display: "flex", gap: 16, padding: "12px 20px" }}>
      <Icon size={17} strokeWidth={1.8} style={{ color: WA.textSecondary, flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: WA.textSecondary, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 14, color: WA.textPrimary, wordBreak: "break-word", fontFamily: WA_FONT }}>{value}</div>
      </div>
    </div>
  )
}

// ---- New chat modal ----
export function NewChatModal({
  allLeads, onClose, onPick, onCreate,
}: {
  allLeads: Lead[]
  onClose: () => void
  onPick: (lead: Lead) => void
  onCreate: (phone: string, name: string) => void
}) {
  const [q, setQ] = useState("")
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const filtered = allLeads.filter(l =>
    !q.trim() ||
    l.name?.toLowerCase().includes(q.toLowerCase()) ||
    l.phone?.includes(q.replace(/\D/g, ""))
  )
  return (
    <div style={{
      position: "fixed", inset: 0, background: WA.overlay, backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16,
    }}>
      <div style={{
        background: WA.panelBg, border: `1px solid ${WA.hairline}`, borderRadius: 14,
        maxWidth: 440, width: "100%", padding: 0, boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        color: WA.textPrimary, overflow: "hidden", maxHeight: "80vh", display: "flex", flexDirection: "column", fontFamily: WA_FONT,
      }}>
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${WA.hairline}`, flexShrink: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 600 }}>New chat</div>
          <IconBtn title="Close" onClick={onClose}><X size={18} /></IconBtn>
        </div>

        <div style={{ padding: "12px 16px", flexShrink: 0 }}>
          <div style={{ background: WA.headerBg, borderRadius: 10, display: "flex", alignItems: "center", padding: "8px 12px", gap: 8 }}>
            <Search size={15} color={WA.textSecondary} />
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search name or number"
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: WA.textPrimary, fontSize: 14 }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: WA.teal, padding: "8px 20px 4px" }}>CONTACTS ON WHATSAPP</div>
          {filtered.length === 0 && (
            <div style={{ padding: "14px 20px", color: WA.textSecondary, fontSize: 13 }}>No contacts match</div>
          )}
          {filtered.map(l => (
            <div
              key={l.id}
              onClick={() => onPick(l)}
              style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 13, cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.background = WA.hover }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent" }}
            >
              <Avatar name={l.name} phone={l.phone} size={40} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14.5, color: WA.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
                <div style={{ fontSize: 12.5, color: WA.textSecondary }}>{l.phone}</div>
              </div>
            </div>
          ))}

          <div style={{ fontSize: 12, fontWeight: 600, color: WA.teal, padding: "14px 20px 6px", borderTop: `1px solid ${WA.hairline}` }}>
            NEW CONTACT
          </div>
          <div style={{ padding: "6px 20px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Phone number e.g. 9876543210"
              style={{ height: 40, background: WA.headerBg, border: `1px solid ${WA.hairline}`, borderRadius: 8, color: WA.textPrimary, padding: "0 12px", outline: "none", fontSize: 14 }}
            />
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Contact name (optional)"
              style={{ height: 40, background: WA.headerBg, border: `1px solid ${WA.hairline}`, borderRadius: 8, color: WA.textPrimary, padding: "0 12px", outline: "none", fontSize: 14 }}
            />
            <button
              onClick={() => onCreate(phone, name)}
              style={{ height: 40, borderRadius: 8, border: "none", background: WA.teal, color: "white", fontWeight: 600, cursor: "pointer", fontSize: 14 }}
            >
              Start chat
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Forward modal ----
export function ForwardModal({
  leads, msg, onClose, onForward,
}: {
  leads: Lead[]
  msg: Msg
  onClose: () => void
  onForward: (target: Lead) => void
}) {
  const [q, setQ] = useState("")
  const filtered = leads.filter(l =>
    !q.trim() ||
    l.name?.toLowerCase().includes(q.toLowerCase()) ||
    l.phone?.includes(q.replace(/\D/g, ""))
  )
  const isMedia = !!msg.media_id && msg.msg_type && msg.msg_type !== "text"
  const preview = msg.content?.slice(0, 60) || (isMedia ? `[${msg.msg_type}]` : "")
  return (
    <div style={{
      position: "fixed", inset: 0, background: WA.overlay, backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16,
    }}>
      <div style={{
        background: WA.panelBg, border: `1px solid ${WA.hairline}`, borderRadius: 14,
        maxWidth: 420, width: "100%", boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        color: WA.textPrimary, overflow: "hidden", maxHeight: "75vh", display: "flex", flexDirection: "column", fontFamily: WA_FONT,
      }}>
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${WA.hairline}`, flexShrink: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 600 }}>Forward message…</div>
          <IconBtn title="Close" onClick={onClose}><X size={18} /></IconBtn>
        </div>
        <div style={{ padding: "12px 16px", fontSize: 12.5, color: WA.textSecondary, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isMedia ? `${preview} — media will be sent without caption` : preview}
        </div>
        <div style={{ padding: "0 16px 12px", flexShrink: 0 }}>
          <div style={{ background: WA.headerBg, borderRadius: 10, display: "flex", alignItems: "center", padding: "8px 12px", gap: 8 }}>
            <Search size={15} color={WA.textSecondary} />
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search chats"
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: WA.textPrimary, fontSize: 14 }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
          {filtered.length === 0 && (
            <div style={{ padding: "14px 20px", color: WA.textSecondary, fontSize: 13 }}>
              <Users size={26} style={{ margin: "0 auto 8px", display: "block", opacity: 0.4 }} />
              No chats match
            </div>
          )}
          {filtered.map(l => (
            <div
              key={l.id}
              onClick={() => onForward(l)}
              style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 13, cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.background = WA.hover }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent" }}
            >
              <Avatar name={l.name} phone={l.phone} size={40} />
              <div style={{ fontSize: 14.5, color: WA.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
