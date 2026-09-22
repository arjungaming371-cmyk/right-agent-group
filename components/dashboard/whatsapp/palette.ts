// Shared palette, types and formatting helpers for the WhatsApp module.
//
// The goal of this module is REAL WhatsApp Web (dark) fidelity — the app's
// usual purple/blue dashboard theme doesn't belong here; every surface below
// is a fixed WhatsApp colour that does NOT follow the console theme, so the
// text/line colours on top of it are fixed too (a theme variable here lands
// on a background it was never measured against).

export type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

export type Lead = {
  id: string; name: string; phone: string
  last_message?: string; last_message_time?: string; last_direction?: string
  last_status?: string; last_type?: string; last_media_name?: string
  unread?: number; pinned?: boolean; pinned_at?: string | null
  wa_archived?: boolean; wa_muted?: boolean
  address?: string | null; email?: string | null; whatsapp_number?: string | null
  product_interest?: string | null; loan_amount?: number | null; notes?: string | null
  status?: string | null; interested?: string | null; language?: string | null; source?: string | null
  ai_summary?: string | null; sentiment?: string | null; stage?: string | null
  facts?: Record<string, any> | null
}

export type Msg = {
  id: string | number
  direction: string
  content: string
  status?: string
  created_at: string
  msg_type?: string
  media_id?: string | null
  media_mime?: string | null
  media_name?: string | null
  quoted_wa_id?: string | null
  quoted_text?: string | null
  quoted_from?: string | null
  reaction?: string | null
  wa_message_id?: string | null
  branch_id?: string | null
}

export const WA = {
  panelBg: "#111b21",
  headerBg: "#202c33",
  chatBg: "#0b141a",
  hairline: "rgba(255,255,255,0.06)",
  bubbleIn: "#202c33",
  bubbleInDeep: "#1d282f",
  bubbleOut: "#005c4b",
  bubbleOutDeep: "#025144",
  teal: "#00a884",
  tealBright: "#21c063",
  chipActiveBg: "#103529",
  tick: "#8696a0",
  tickRead: "#53bdeb",
  textPrimary: "#e9edef",
  textSecondary: "#8696a0",
  metaOut: "rgba(233,237,239,0.6)",
  selected: "#2a3942",
  hover: "#202c33",
  pill: "#182229",
  accentIn: "#53bdeb",
  accentOut: "#06cf9c",
  danger: "#ef697a",
  overlay: "rgba(11,20,26,0.8)",
}

export const WA_FONT = "'Segoe UI', 'Helvetica Neue', Helvetica, 'Lucida Grande', Arial, Ubuntu, Cantarell, 'Fira Sans', sans-serif"

// WhatsApp's chat background is never a flat color — it's a faint repeating
// doodle pattern. Reproduced as a tiled inline SVG so it doesn't depend on
// any external asset.
export const CHAT_WALLPAPER = `url("data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>
    <g fill='none' stroke='#ffffff' stroke-width='1' opacity='0.032'>
      <circle cx='22' cy='24' r='8'/>
      <path d='M56 14 l10 10 -10 10 -10 -10 z'/>
      <path d='M100 40 q12 -12 24 0 q-12 12 -24 0 z'/>
      <circle cx='34' cy='92' r='6'/>
      <path d='M82 100 l12 14 M94 100 l-12 14'/>
      <circle cx='118' cy='110' r='10'/>
      <path d='M10 116 q10 -16 20 0'/>
      <path d='M124 74 h16 M132 66 v16'/>
      <circle cx='66' cy='56' r='3.5'/>
    </g>
  </svg>
`)}")`

// ---- Time formatting, WhatsApp-style ----

export function fmtListTime(dateStr?: string): string {
  if (!dateStr) return ""
  const d = new Date(dateStr)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayDiff = Math.round((startOfToday.getTime() - startOfMsg.getTime()) / 86400000)
  if (dayDiff === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
  if (dayDiff === 1) return "Yesterday"
  if (dayDiff < 7) return d.toLocaleDateString([], { weekday: "long" })
  const yy = now.getFullYear() === d.getFullYear() ? "" : `/${String(d.getFullYear()).slice(2)}`
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}${yy}`
}

export function fmtMsgTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
}

export function fmtDatePill(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayDiff = Math.round((startOfToday.getTime() - startOfMsg.getTime()) / 86400000)
  if (dayDiff === 0) return "TODAY"
  if (dayDiff === 1) return "YESTERDAY"
  if (dayDiff < 7) return d.toLocaleDateString([], { weekday: "long" }).toUpperCase()
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })
}

/** "online" / "last seen today at 14:32" — from the last inbound message. */
export function fmtLastSeen(lastInboundAt?: string | null): string {
  if (!lastInboundAt) return "click here for contact info"
  const t = new Date(lastInboundAt).getTime()
  if (Date.now() - t < 120_000) return "online"
  const d = new Date(lastInboundAt)
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase()
  const now = new Date()
  const dayDiff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000)
  if (dayDiff === 0) return `last seen today at ${hm}`
  if (dayDiff === 1) return `last seen yesterday at ${hm}`
  return `last seen ${d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" })} at ${hm}`
}

/** Media preview text for the chat list / no-text bubbles. */
export function mediaPreview(msgType?: string, mediaName?: string | null): string | null {
  switch (msgType) {
    case "image": return "📷 Photo"
    case "video": return "🎬 Video"
    case "audio": return "🎤 Voice message"
    case "sticker": return "🌼 Sticker"
    case "location": return "📍 Location"
    case "document": return `📄 ${mediaName || "Document"}`
    default: return null
  }
}

/** Body text that is really a "[...]" AI placeholder shouldn't show as caption. */
export function isPlaceholder(text?: string | null): boolean {
  return !!text && /^\[.*\]$/.test(text.trim())
}

export function fmtMoney(n: any): string {
  if (!n) return "—"
  return `₹${Number(n).toLocaleString("en-IN")}`
}

export const SENTIMENT_COLOR: Record<string, string> = {
  positive: WA.tealBright, neutral: WA.tick, frustrated: "#f7b731", hostile: WA.danger,
}
export const STAGE_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", interested: "Interested", docs_pending: "Docs pending",
  negotiating: "Negotiating", converted: "Converted", lost: "Lost", do_not_call: "Do not call",
}
