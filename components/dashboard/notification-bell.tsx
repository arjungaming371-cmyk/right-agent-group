"use client"
// Real notification bell — replaces the old decorative one. Polls for new
// loan applications, escalations, team logins, and new WhatsApp contacts.

import { useEffect, useRef, useState } from "react"
import { Bell, FileText, AlertTriangle, LogIn, MessageCircle, Check, PenLine } from "lucide-react"
import { timeAgo, formatDateTime } from "@/lib/utils"
import type { ViewKey } from "./shell"

type Notification = {
  id: string
  type: "loan_application" | "escalation" | "login" | "whatsapp_message" | "loan_edit_request"
  title: string
  body: string | null
  link_view: ViewKey | null
  read: boolean
  created_at: string
}

const TYPE_META: Record<Notification["type"], { icon: typeof Bell; color: string }> = {
  loan_application: { icon: FileText, color: "#38bdf8" },
  escalation: { icon: AlertTriangle, color: "#fb5670" },
  login: { icon: LogIn, color: "#a5b0ff" },
  whatsapp_message: { icon: MessageCircle, color: "#2dd4a0" },
  loan_edit_request: { icon: PenLine, color: "#f7b731" },
}

export default function NotificationBell({ onNavigate }: { onNavigate: (view: ViewKey) => void }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  async function load() {
    try {
      const res = await fetch("/api/notifications")
      if (!res.ok) return
      const data = await res.json()
      setItems(data.notifications || [])
      setUnread(data.unreadCount || 0)
    } catch {}
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  async function markAllRead() {
    setItems(prev => prev.map(n => ({ ...n, read: true })))
    setUnread(0)
    await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }).catch(() => {})
  }

  async function openNotification(n: Notification) {
    if (!n.read) {
      setItems(prev => prev.map(x => (x.id === n.id ? { ...x, read: true } : x)))
      setUnread(prev => Math.max(0, prev - 1))
      fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: n.id }) }).catch(() => {})
    }
    if (n.link_view) onNavigate(n.link_view)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-transparent text-[var(--text-secondary)] hover:border-[var(--border)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]"
      >
        <Bell size={16} strokeWidth={1.9} />
        {unread > 0 && (
          <span
            className="absolute right-[6px] top-[6px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ background: "var(--accent-red)" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute", right: 0, top: 44, width: 360, maxHeight: 440,
            background: "rgba(12,17,29,0.98)", border: "1px solid #232c45", borderRadius: 14,
            boxShadow: "0 20px 60px -12px rgba(0,0,0,0.7)", zIndex: 200, overflow: "hidden",
            display: "flex", flexDirection: "column", animation: "paletteIn 0.14s ease",
          }}
        >
          <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--border-light)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
                <Check size={12} strokeWidth={2} /> Mark all read
              </button>
            )}
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {items.length === 0 && (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                Nothing yet — new loan applications, escalations, and logins will show up here.
              </div>
            )}
            {items.map(n => {
              const meta = TYPE_META[n.type] ?? TYPE_META.login
              const Icon = meta.icon
              return (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  style={{
                    width: "100%", textAlign: "left", display: "flex", gap: 11, padding: "12px 16px",
                    borderBottom: "1px solid var(--border-light)", background: n.read ? "transparent" : "rgba(139,124,255,0.05)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: `${meta.color}1c`, border: `1px solid ${meta.color}3d`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: meta.color, flexShrink: 0, marginTop: 1 }}>
                    <Icon size={13} strokeWidth={2} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: n.read ? 500 : 650, color: "var(--text-primary)" }}>{n.title}</span>
                      {!n.read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8b7cff", flexShrink: 0 }} />}
                    </span>
                    {n.body && <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.body}</span>}
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>{timeAgo(n.created_at)} · {formatDateTime(n.created_at)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
