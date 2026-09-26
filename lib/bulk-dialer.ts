// Bulk outbound calling — the campaign runner.
//
// The one-shot /api/outbound/process route can only dial a capped slice of
// the queue per click (LIMIT ≤ 50) and reports nothing until it finishes —
// an operator with a 500-row CSV had to click "Start Calling" ten times and
// stare at a silent spinner. This module is the missing engine: it drains
// the ENTIRE pending queue in the background, wave by wave, with live
// progress the dashboard can poll.
//
// Design contracts:
//   • Dependency-injected — claimBatch/dialRow/quotaOk are callbacks, so the
//     route wires the real DB/Exotel deps and tests wire fakes. Zero imports
//     here on purpose: the engine is pure control flow.
//   • Per-branch instance — the route keeps one runner per branch scope
//     (branchId or "hq"), so two branch managers can run campaigns at once
//     without a global runner mixing their queues.
//   • Cooperative stop — stop() only flips a flag; the wave in flight
//     finishes (rows already claimed are dialed or marked failed), and
//     unclaimed rows simply stay pending.
//   • Crash-safe by inheritance — rows are claimed atomically
//     (FOR UPDATE SKIP LOCKED), so if this process dies mid-campaign the
//     rows sit in 'dialing' and the existing 10-minute reaper re-claims
//     them on the next run. No new durability mechanism needed.
//   • Quota-gated EVERY wave, not just once — a 500-call campaign can burn
//     through a branch's monthly cap mid-run; when the cap hits, the runner
//     stops BEFORE claiming more (nothing to release) and reports why.

export type BulkQueueRow = {
  id: string
  lead_id: string | null
  phone: string
  name: string | null
  language: string | null
  product_interest: string | null
  notes: string | null
  branch_id: string | null
}

/** What one dial attempt concluded. A throw counts as "failed". */
export type DialOutcome = "called" | "skipped" | "failed"

export type BulkDialerDeps = {
  /** Atomically claim up to `size` pending rows (status → 'dialing'). */
  claimBatch: (size: number) => Promise<BulkQueueRow[]>
  /** Dial one claimed row; must NOT throw for per-row business failures —
   *  return "skipped"/"failed" instead. A throw is still tolerated and
   *  counted as "failed" so one bad row can never kill the campaign. */
  dialRow: (row: BulkQueueRow) => Promise<DialOutcome>
  /** Branch-level call-quota gate, re-checked before every wave. */
  quotaOk: () => Promise<{ ok: boolean; reason?: string }>
  /** Cap on rows claimed per wave — the effective concurrency limit. */
  maxConcurrency?: number
  /** Delay between waves (ms) so the telephony API is never hammered. */
  pauseMs?: number
  log?: (msg: string) => void
}

export type BulkRunSnapshot = {
  runId: string
  running: boolean
  stopRequested: boolean
  /** "drained" | "stopped" | "quota: <reason>" | error message. Null while running. */
  reason: string | null
  startedAt: number
  finishedAt: number | null
  claimed: number
  called: number
  failed: number
  skipped: number
  waves: number
  concurrency: number
  /** Phones currently being dialed (for the live "now calling" chips). */
  current: string[]
}

function zeroedSnapshot(): BulkRunSnapshot {
  return {
    runId: "", running: false, stopRequested: false, reason: null,
    startedAt: 0, finishedAt: null,
    claimed: 0, called: 0, failed: 0, skipped: 0, waves: 0,
    concurrency: 0, current: [],
  }
}

export function createBulkDialer(deps: BulkDialerDeps) {
  const maxConcurrency = Math.max(1, Math.min(10, deps.maxConcurrency ?? 10))
  const pauseMs = Math.max(0, deps.pauseMs ?? 500)
  let run: BulkRunSnapshot | null = null
  let idle: Promise<void> = Promise.resolve()

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  async function mainLoop(s: BulkRunSnapshot) {
    const log = deps.log ?? (() => {})
    try {
      while (true) {
        if (s.stopRequested) { s.reason = "stopped"; break }

        // Quota gate BEFORE claiming — if the branch cap is exhausted there
        // is nothing to release, the wave simply never starts.
        const quota = await deps.quotaOk().catch(() => ({ ok: false, reason: "quota check failed" }))
        if (!quota.ok) { s.reason = `quota: ${quota.reason || "branch call cap reached"}`; break }

        const batch = await deps.claimBatch(s.concurrency)
        if (!batch.length) { s.reason = "drained"; break }
        s.waves++
        s.claimed += batch.length
        s.current = batch.map((r) => r.phone)
        log(`bulk wave ${s.waves}: dialing ${batch.length} (${s.called} done, ${s.failed} failed so far)`)

        const results = await Promise.allSettled(batch.map((r) => deps.dialRow(r)))
        s.current = []
        for (let i = 0; i < results.length; i++) {
          const res = results[i]
          if (res.status === "fulfilled") {
            if (res.value === "called") s.called++
            else if (res.value === "skipped") s.skipped++
            else s.failed++
          } else {
            // dialRow threw — never abort the campaign for one row.
            s.failed++
            log(`bulk: dial threw for ${batch[i]?.phone}: ${String((res as PromiseRejectedResult).reason).slice(0, 200)}`)
          }
        }

        if (s.stopRequested) { s.reason = "stopped"; break }
        if (pauseMs > 0) await sleep(pauseMs)
      }
    } catch (e) {
      s.current = []
      s.reason = (e as Error)?.message || "bulk runner crashed"
    } finally {
      s.running = false
      s.finishedAt = Date.now()
      log(`bulk run ${s.runId} finished: ${s.called} called, ${s.failed} failed, ${s.skipped} skipped (${s.reason})`)
    }
  }

  return {
    /** Start draining the queue. Resolves immediately — poll status(). */
    async start(opts: { concurrency?: number } = {}): Promise<{ ok: boolean; runId?: string; reason?: string }> {
      if (run?.running) return { ok: false, reason: "A bulk campaign is already running" }
      const s = zeroedSnapshot()
      s.runId = `bulk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      s.running = true
      s.startedAt = Date.now()
      s.concurrency = Math.max(1, Math.min(maxConcurrency, Math.round(opts.concurrency ?? 3)))
      run = s
      idle = mainLoop(s)
      return { ok: true, runId: s.runId }
    },

    /** Ask the current campaign to stop after the in-flight wave. */
    stop(): boolean {
      if (!run?.running) return false
      run.stopRequested = true
      return true
    },

    /** Live snapshot — safe to call any time (never throws, never null). */
    status(): BulkRunSnapshot {
      return run ?? zeroedSnapshot()
    },

    /** Resolves when no campaign is in flight (tests + graceful shutdown). */
    async done(): Promise<void> {
      await idle
    },
  }
}

export type BulkDialer = ReturnType<typeof createBulkDialer>

/**
 * Per-branch runner registry. Key is the branch scope: the branch UUID for
 * branch-scoped sessions, "hq" for HQ admins (whose claim SQL spans every
 * branch). A new scope lazily gets its own engine, so two branch managers
 * can run independent campaigns simultaneously — and the GET status endpoint
 * only ever reports the caller's own scope.
 */
const registry = new Map<string, BulkDialer>()

export function getBulkDialer(branchKey: string, deps: BulkDialerDeps): BulkDialer {
  let d = registry.get(branchKey)
  if (!d) {
    d = createBulkDialer(deps)
    registry.set(branchKey, d)
  }
  return d
}
