"use client"

// Small shared visual atoms for the WhatsApp module.

import { WA } from "./palette"

/** Local initials avatar — no third-party avatar service (PII). */
export function Avatar({ name, size = 40, phone }: { name: string; size?: number; phone?: string | null }) {
  const source = (name || "").trim()
  const fallbackDigits = (phone || "").replace(/\D/g, "")
  const initials = source
    ? source.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : fallbackDigits.slice(-2) || "?"
  const colors = ["#00a884", "#38bdf8", "#8b7cff", "#f7b731", "#fb5670", "#a78bfa", "#5ec2a8"]
  const color = colors[(source || fallbackDigits || "?").charCodeAt(0) % colors.length]
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: `color-mix(in oklab, ${color} 20%, #1f2c34)`,
        border: `1px solid color-mix(in oklab, ${color} 35%, transparent)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.34, fontWeight: 700, color, userSelect: "none",
      }}
    >
      {initials}
    </div>
  )
}

/**
 * WhatsApp's REAL tick marks as SVG — single check (sent), double grey
 * (delivered), double blue (read). The old text "✓✓" rendered with the
 * wrong glyph proportions; these are the actual WhatsApp shapes.
 */
export function Ticks({ status, size = 16 }: { status?: string; size?: number }) {
  const color = status === "read" ? WA.tickRead : WA.metaOut
  if (status === "sending") {
    // small clock while the send API hasn't confirmed yet
    return (
      <svg width={size} height={size * 0.75} viewBox="0 0 16 12" fill="none">
        <circle cx="8" cy="6" r="4.6" stroke={WA.metaOut} strokeWidth="1.2" />
        <path d="M8 3.4 V6 L10 7.4" stroke={WA.metaOut} strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }
  if (status === "failed") {
    return (
      <svg width={size} height={size * 0.75} viewBox="0 0 16 12" fill="none">
        <circle cx="8" cy="6" r="4.6" stroke={WA.danger || "#ef697a"} strokeWidth="1.2" />
        <path d="M8 3.6 V6.8 M8 8.4 V8.5" stroke={WA.danger || "#ef697a"} strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (status === "delivered" || status === "read") {
    return (
      <svg width={size + 3} height={size * 0.75} viewBox="0 0 19 12" fill="none" style={{ flexShrink: 0 }}>
        <path d="M1 6.6 L4.2 9.8 L10.4 2.4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.6 6.8 L9.4 9.8 L15.6 2.4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 16 12" fill="none" style={{ flexShrink: 0 }}>
      <path d="M2 6.6 L5.4 10 L13.4 2.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Square-ish icon button used across list header / chat header. */
export function IconBtn({
  children, onClick, title, active, disabled, tint,
}: {
  children: React.ReactNode; onClick?: (e: React.MouseEvent) => void
  title?: string; active?: boolean; disabled?: boolean; tint?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-label={title}
      style={{
        width: 36, height: 36, borderRadius: "50%", border: "none", cursor: disabled ? "default" : "pointer",
        background: active ? WA.selected : "transparent", color: tint || WA.textSecondary,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        transition: "background 120ms ease, color 120ms ease",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = "rgba(255,255,255,0.06)" }}
      onMouseLeave={e => { if (!disabled && !active) e.currentTarget.style.background = "transparent" }}
    >
      {children}
    </button>
  )
}

/** WhatsApp-style toggle switch (contact info panel: mute / archive). */
export function Switch({ on, onChange }: { on: boolean; onChange?: (next: boolean) => void }) {
  return (
    <button
      onClick={() => onChange?.(!on)}
      role="switch"
      aria-checked={on}
      style={{
        width: 34, height: 20, borderRadius: 999, border: "none", cursor: "pointer", flexShrink: 0,
        background: on ? WA.teal : "rgba(134,150,160,0.35)", position: "relative", transition: "background 150ms ease",
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: "50%",
        background: on ? "#111b21" : "#c4ccd2", transition: "left 150ms ease, background 150ms ease",
      }} />
    </button>
  )
}

/** Circular menu item icon used inside contact info action rows. */
export function RoundAction({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "transparent",
        border: "none", cursor: "pointer", color: danger ? WA.danger : WA.textSecondary, minWidth: 72,
      }}
    >
      <span style={{
        width: 42, height: 42, borderRadius: "50%", background: WA.headerBg,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{icon}</span>
      <span style={{ fontSize: 11.5 }}>{label}</span>
    </button>
  )
}
