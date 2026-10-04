"use client"

// Shared keyboard-accessible interaction primitives (2026-10-05 a11y pass).
//
// ClickableRow — the console has many clickable <div>/<li> rows (lead rows,
// call rows, chat rows). A div with onClick is invisible to keyboard and
// screen-reader users: no focus, no Enter/Space, no button semantics. This
// wrapper keeps the exact same DOM/styling freedom while adding
// role="button" + tabIndex + Enter/Space activation.
//
// useEscapeDismiss — closes overlays (modals, drawers, popovers) on Escape,
// the behavior the marketing nav already had but the console lacked.

import { useEffect } from "react"

type ClickableRowProps = React.HTMLAttributes<HTMLDivElement> & {
  onActivate: () => void
  /** Accessible name when the row content alone isn't descriptive. */
  label?: string
}

export function ClickableRow({ onActivate, label, children, ...rest }: ClickableRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onActivate()
        }
      }}
      {...rest}
    >
      {children}
    </div>
  )
}

/** Fires onClose when Escape is pressed while `active` is true. */
export function useEscapeDismiss(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, onClose])
}
