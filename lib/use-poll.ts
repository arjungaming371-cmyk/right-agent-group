"use client"

import { createContext, useContext, useEffect, useRef } from "react"

/**
 * Background refresh on an interval — but only while the tab is actually
 * being looked at.
 *
 * Every dashboard view polls (3s-30s). Nothing checked visibility, so a
 * console left open in a background tab kept hammering Postgres for a screen
 * nobody could see: the WhatsApp view's 4s lead poll + 3s message poll alone
 * come to ~35,000 queries over a night, times every ops user with a tab
 * open. Pausing while hidden and firing once on return is also FRESHER than
 * the old behaviour — the user used to see whatever the last background tick
 * fetched, which could be nearly a full interval stale at the moment they
 * looked back.
 *
 * KEEP-ALIVE AWARENESS (second pause dimension): the shell now keeps visited
 * views mounted (display:none) so switching tabs is instant and form/scroll
 * state survives. A parked view is NOT visible even when the tab is, so its
 * polling must pause too — otherwise switching tabs would MULTIPLY the
 * database load instead of reducing it (every view you ever visited polling
 * in the background forever). The shell wraps each view host in
 * PollingViewContext with its ViewKey and reports the active key through
 * setActivePollingView(); a tick whose context key is parked is skipped
 * before it can fire a fetch. Context is null outside the shell (login page,
 * floating widgets, tests) → behaviour is exactly as before.
 *
 * The callback is read through a ref, so passing a new inline closure every
 * render (the normal case — these all capture component state) does NOT
 * restart the timer, and each tick still runs against the latest state.
 *
 * Pass intervalMs <= 0 to disable polling entirely — useful when a view
 * should only poll while something is selected.
 */

// The view the shell currently shows (module-level so ticks read it without
// re-rendering anything — this is a "when did the user switch tabs" signal,
// not component state).
let activePollingView: string | null = null

export function setActivePollingView(key: string | null): void {
  activePollingView = key
}

/** Provided per-view by the shell's keep-alive hosts; null elsewhere. */
export const PollingViewContext = createContext<string | null>(null)

export function usePolling(fn: () => void, intervalMs: number): void {
  const saved = useRef(fn)
  const viewKey = useContext(PollingViewContext)

  useEffect(() => {
    saved.current = fn
  })

  useEffect(() => {
    if (!(intervalMs > 0)) return

    let timer: ReturnType<typeof setInterval> | null = null
    const tick = () => {
      // Parked keep-alive view (host is display:none): the user cannot see
      // this screen — skip the fetch. activePollingView is read live so the
      // check reflects the CURRENT tab, not the one at mount time.
      if (viewKey && activePollingView && activePollingView !== viewKey) return
      saved.current()
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const start = () => {
      if (!timer) timer = setInterval(tick, intervalMs)
    }
    const onVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        // Catch up immediately rather than making the user wait out a full
        // interval on a screen they just came back to. tick() (not
        // saved.current()) so a parked view's catch-up is skipped too.
        tick()
        start()
      }
    }

    if (!document.hidden) start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [intervalMs, viewKey])
}
