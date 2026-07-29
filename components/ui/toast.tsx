"use client"
// Toast notifications — replaces browser alert() popups everywhere.
// Usage: const toast = useToast(); toast.success("Lead added")

import { createContext, useCallback, useContext, useRef, useState } from "react"
import { CheckCircle2, XCircle, Info, X } from "lucide-react"

type Kind = "success" | "error" | "info"
type Toast = { id: number; kind: Kind; text: string; leaving?: boolean }

type ToastApi = {
  success: (text: string) => void
  error: (text: string) => void
  info: (text: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  // Views render inside ToastProvider in the shell; a no-op fallback keeps
  // any stray usage (tests, isolated renders) from crashing.
  return ctx ?? { success: () => {}, error: () => {}, info: () => {} }
}

const KIND_STYLE: Record<Kind, { color: string; bg: string; Icon: typeof CheckCircle2 }> = {
  success: { color: "var(--accent-green)", bg: "rgba(45,212,160,0.12)", Icon: CheckCircle2 },
  error:   { color: "var(--accent-red)", bg: "rgba(251,86,112,0.12)", Icon: XCircle },
  info:    { color: "var(--accent-cyan)", bg: "rgba(56,189,248,0.12)", Icon: Info },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    // Play the exit animation, then actually remove.
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 180)
  }, [])

  const push = useCallback((kind: Kind, text: string) => {
    const id = nextId.current++
    setToasts(prev => [...prev.slice(-3), { id, kind, text }]) // max 4 on screen
    setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3800)
  }, [dismiss])

  const api: ToastApi = {
    success: (t) => push("success", t),
    error: (t) => push("error", t),
    info: (t) => push("info", t),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 3000, display: "flex", flexDirection: "column", gap: 8, alignItems: "center", pointerEvents: "none" }}>
        {toasts.map(t => {
          const { color, bg, Icon } = KIND_STYLE[t.kind]
          return (
            <div
              key={t.id}
              role="status"
              style={{
                display: "flex", alignItems: "center", gap: 10,
                maxWidth: 480, padding: "11px 14px 11px 12px",
                background: "rgba(14,19,32,0.97)", border: "1px solid var(--border)",
                borderRadius: 12, boxShadow: "var(--shadow-soft)",
                backdropFilter: "blur(12px)", pointerEvents: "auto",
                animation: t.leaving ? "toastOut 0.18s ease forwards" : "toastIn 0.22s cubic-bezier(0.21,1.02,0.73,1)",
              }}
            >
              <span style={{ width: 28, height: 28, borderRadius: 8, background: bg, display: "inline-flex", alignItems: "center", justifyContent: "center", color, flexShrink: 0 }}>
                <Icon size={15} strokeWidth={2.1} />
              </span>
              <span style={{ fontSize: 13.5, color: "var(--text-primary)", lineHeight: 1.4 }}>{t.text}</span>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", padding: 4, marginLeft: 2, flexShrink: 0 }}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
