"use client"

import { useEffect, useRef } from "react"

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
 * The callback is read through a ref, so passing a new inline closure every
 * render (the normal case — these all capture component state) does NOT
 * restart the timer, and each tick still runs against the latest state.
 *
 * Pass intervalMs <= 0 to disable polling entirely — useful when a view
 * should only poll while something is selected.
 */
export function usePolling(fn: () => void, intervalMs: number): void {
  const saved = useRef(fn)

  useEffect(() => {
    saved.current = fn
  })

  useEffect(() => {
    if (!(intervalMs > 0)) return

    let timer: ReturnType<typeof setInterval> | null = null
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const start = () => {
      if (!timer) timer = setInterval(() => saved.current(), intervalMs)
    }
    const onVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        // Catch up immediately rather than making the user wait out a full
        // interval on a screen they just came back to.
        saved.current()
        start()
      }
    }

    if (!document.hidden) start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [intervalMs])
}
