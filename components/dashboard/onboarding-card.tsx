"use client"
import { useEffect, useState } from "react"
import { Circle, CheckCircle2, X, ArrowRight, Rocket } from "lucide-react"

// "Complete your setup" — the onboarding checklist computed live from the
// system state (GET /api/onboarding). Every row dispatches the shell's
// rag:navigate event to jump straight to the view that completes it.
// Dismissible for the session (localStorage) — reappears never once
// complete, only "Show again" from… nothing, it simply stays gone.

type Step = { key: string; label: string; done: boolean; view: string }

const DISMISS_KEY = "rag_onboarding_dismissed_v1"

export default function OnboardingCard() {
  const [data, setData] = useState<{ steps: Step[]; done: number; total: number; complete: boolean } | null>(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1")
    } catch {}
    fetch("/api/onboarding")
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d && Array.isArray(d.steps) && d.steps.length) setData(d)
      })
      .catch(() => {})
  }, [])

  if (!data || data.complete || dismissed) return null

  function go(view: string) {
    window.dispatchEvent(new CustomEvent("rag:navigate", { detail: { view } }))
  }

  function dismiss() {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISS_KEY, "1")
    } catch {}
  }

  return (
    <div className="mb-5 rounded-xl border border-[rgba(139,124,255,0.28)] bg-[var(--bg-card)] p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: "var(--gradient-brand)" }}>
            <Rocket size={15} />
          </span>
          <div>
            <div className="text-[14px] font-bold text-[var(--text-primary)]">Complete your setup</div>
            <div className="text-[11.5px] text-[var(--text-secondary)]">
              {data.done} / {data.total} steps complete — Priya is at her best when every piece is in place.
            </div>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss setup checklist"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--overlay-hover)] hover:text-[var(--text-primary)]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--overlay-soft)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.round((data.done / Math.max(1, data.total)) * 100)}%`, background: "var(--gradient-brand)" }}
        />
      </div>

      <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
        {data.steps.map(s => (
          <li key={s.key}>
            <button
              onClick={() => go(s.view)}
              className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] transition-colors hover:bg-[var(--overlay-hover)] ${
                s.done ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"
              }`}
            >
              {s.done ? (
                <CheckCircle2 size={15} className="flex-shrink-0 text-[var(--accent-green)]" />
              ) : (
                <Circle size={15} className="flex-shrink-0 text-[var(--accent-violet)]" />
              )}
              <span className={`flex-1 truncate ${s.done ? "line-through decoration-[var(--text-muted)]/50" : "font-medium"}`}>
                {s.label}
              </span>
              {!s.done && <ArrowRight size={13} className="flex-shrink-0 text-[var(--text-muted)]" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
