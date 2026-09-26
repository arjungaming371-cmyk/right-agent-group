#!/usr/bin/env node
/**
 * Regression tests for the bulk outbound calling engine (lib/bulk-dialer.ts).
 *
 * The campaign runner drains the ENTIRE outbound_queue in the background
 * (the old one-shot /api/outbound/process capped every click at 50 rows and
 * reported nothing until it finished). The engine is dependency-injected on
 * purpose, so these tests run its real control flow against fake deps:
 *   • drain-until-empty + wave counting
 *   • concurrency ceiling (max simultaneous dials ≤ configured)
 *   • outcome tallying (called / skipped / failed, throws count as failed)
 *   • quota gate before EVERY wave (start-blocked + mid-run stop)
 *   • cooperative stop (in-flight wave finishes, rest stays pending)
 *   • double-start guard, per-branch runner registry, zeroed status
 *
 * Run: node scripts/test-bulk-dialer.js
 */
"use strict"
const { execSync } = require("child_process")
const path = require("path")

const ROOT = path.join(__dirname, "..")
// lib/bulk-dialer.ts imports NOTHING (pure control flow by design), so a
// plain tsc pass is enough — no "@/lib/*" resolver hook needed here.
execSync("npx tsc -p scripts/tsconfig.bulk.json", { cwd: ROOT, stdio: "pipe" })
const { createBulkDialer, getBulkDialer } = require("./.bulk-build/lib/bulk-dialer.js")

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `row-${i}`, lead_id: null, phone: `+9198000000${String(i).padStart(2, "0")}`,
    name: `Lead ${i}`, language: "telugu", product_interest: "Home Loan", notes: null, branch_id: null,
  }))
}

/**
 * Fake deps with observable state.
 * opts.outcome: (row, i) => DialOutcome            — per-row result
 * opts.throwOn: (row) => boolean                    — make dialRow throw
 * opts.quotaFailAfter: number                       — quotaOk fails after N calls
 * opts.dialDelayMs / opts.pauseMs                   — timing knobs
 */
function makeDeps(rows, opts = {}) {
  const state = { claimed: [], dialed: [], inFlight: 0, maxInFlight: 0, quotaCalls: 0, quotaResults: [] }
  // Stable per-row index — row.id is "row-N", immune to out-of-order waves.
  const rowIndex = (row) => Number(row.id.split("-")[1])
  const deps = {
    maxConcurrency: opts.maxConcurrency ?? 10,
    pauseMs: opts.pauseMs ?? 1,
    claimBatch: async (size) => {
      const batch = rows.splice(0, size)
      state.claimed.push(...batch.map((r) => r.id))
      return batch
    },
    dialRow: async (row) => {
      state.inFlight++
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      await sleep(opts.dialDelayMs ?? 1)
      state.inFlight--
      state.dialed.push(row.id)
      if (opts.throwOn && opts.throwOn(row, rowIndex(row))) { throw new Error("exotel exploded") }
      return opts.outcome ? opts.outcome(row, rowIndex(row)) : "called"
    },
    quotaOk: async () => {
      state.quotaCalls++
      const res = state.quotaCalls <= (opts.quotaFailAfter ?? Infinity) ? { ok: true } : { ok: false, reason: "monthly call cap reached" }
      state.quotaResults.push(res)
      return res
    },
  }
  return { deps, state }
}

async function waitFinished(dialer, timeoutMs = 5000) {
  const t0 = Date.now()
  while (dialer.status().running) {
    if (Date.now() - t0 > timeoutMs) throw new Error("test timed out waiting for run to finish")
    await sleep(5)
  }
  await dialer.done()
}

(async () => {
  console.log("── status before any run ──")
  {
    const { deps } = makeDeps([])
    const d = createBulkDialer(deps)
    const s = d.status()
    ok("zeroed snapshot (not running)", s.running === false && s.runId === "" && s.called === 0 && s.current.length === 0)
    ok("stop() with no run is a no-op returning false", d.stop() === false)
    ok("done() resolves with no run", await d.done() === undefined)
  }

  console.log("── drain the entire queue ──")
  {
    const rows = makeRows(7)
    const { deps, state } = makeDeps(rows, { pauseMs: 1 })
    const d = createBulkDialer(deps)
    const startRes = await d.start({ concurrency: 3 })
    ok("start resolves immediately with ok:true + runId", startRes.ok === true && !!startRes.runId)
    ok("running right after start", d.status().running === true)
    await waitFinished(d)
    const s = d.status()
    ok("all 7 rows dialed", state.dialed.length === 7)
    ok("7 called tallied", s.called === 7 && s.failed === 0 && s.skipped === 0)
    ok("claimed counter = 7", s.claimed === 7)
    ok("3 waves for 7 rows @ concurrency 3 (3+3+1)", s.waves === 3)
    ok("reason = drained", s.reason === "drained")
    ok("no longer running, finishedAt stamped", s.running === false && typeof s.finishedAt === "number" && s.finishedAt >= s.startedAt)
    ok("no phones left 'on the line now'", s.current.length === 0)
  }

  console.log("── concurrency ceiling is respected ──")
  {
    const rows = makeRows(24)
    const { deps, state } = makeDeps(rows, { pauseMs: 1, dialDelayMs: 5 })
    const d = createBulkDialer(deps)
    await d.start({ concurrency: 4 })
    await waitFinished(d)
    ok("max simultaneous dials never exceeded 4", state.maxInFlight <= 4)
    ok("all 24 dialed despite throttled dials", state.dialed.length === 24)
  }

  console.log("── concurrency clamping ──")
  {
    const { deps, state } = makeDeps([], { maxConcurrency: 10 })
    const d = createBulkDialer(deps)
    await d.start({ concurrency: 99 })
    ok("concurrency 99 clamped to 10", d.status().concurrency === 10)
    await waitFinished(d)
    await d.start({ concurrency: 0 })
    ok("concurrency 0 clamped up to 1", d.status().concurrency === 1)
    await waitFinished(d)
    await d.start({}) // no opts
    ok("default concurrency is 3", d.status().concurrency === 3)
    await waitFinished(d)
    ok("quota checked each wave even for empty queue", state.quotaCalls >= 3)
  }

  console.log("── double-start guard ──")
  {
    const rows = makeRows(12)
    const { deps } = makeDeps(rows, { pauseMs: 10, dialDelayMs: 5 })
    const d = createBulkDialer(deps)
    await d.start({ concurrency: 2 })
    const second = await d.start({ concurrency: 2 })
    ok("second start rejected while running", second.ok === false && !!second.reason)
    ok("original run untouched (same runId)", d.status().running === true)
    await waitFinished(d)
    const third = await d.start({ concurrency: 2 })
    ok("start allowed again once finished", third.ok === true)
    await waitFinished(d)
  }

  console.log("── outcome tallying (called / skipped / failed / throws) ──")
  {
    const rows = makeRows(10)
    const { deps, state } = makeDeps(rows, {
      pauseMs: 1,
      // rows 0-2 → called; 3,4 → skipped (DND); 5 → failed; 6 → throw; 7-9 → called
      outcome: (row, i) => (i <= 2 ? "called" : i <= 4 ? "skipped" : i === 5 ? "failed" : "called"),
      throwOn: (row, i) => i === 6,
    })
    const d = createBulkDialer(deps)
    await d.start({ concurrency: 5 })
    await waitFinished(d)
    const s = d.status()
    ok("6 called (rows 0-2 + 7-9)", s.called === 6)
    ok("2 skipped tallied (compliance, not errors)", s.skipped === 2)
    ok("2 failed (1 business + 1 thrown)", s.failed === 2)
    ok("a throwing dialRow did NOT kill the campaign (all 10 attempted)", state.dialed.length === 10)
    ok("reason still drained after mixed outcomes", s.reason === "drained")
  }

  console.log("── quota gate ──")
  {
    // Blocked BEFORE the first wave
    const rowsA = makeRows(5)
    const { deps: depsA, state: stateA } = makeDeps(rowsA, { quotaFailAfter: 0 })
    const dA = createBulkDialer(depsA)
    const resA = await dA.start({ concurrency: 3 })
    ok("start still returns ok (failure surfaces via status)", resA.ok === true)
    await waitFinished(dA)
    const sA = dA.status()
    ok("0 rows claimed when quota fails before wave 1", stateA.claimed.length === 0 && sA.claimed === 0)
    ok("reason explains the quota cap", sA.reason === "quota: monthly call cap reached")
    ok("nothing dialed", sA.called === 0)

    // Exhausted MID-run: in-flight batch finishes, next wave never claims
    const rowsB = makeRows(20)
    const { deps: depsB, state: stateB } = makeDeps(rowsB, { quotaFailAfter: 2, pauseMs: 1 })
    const dB = createBulkDialer(depsB)
    await dB.start({ concurrency: 5 })
    await waitFinished(dB)
    const sB = dB.status()
    ok("mid-run quota stop left the rest pending (claimed < 20)", stateB.claimed.length < 20)
    ok("rows claimed before the cap were still dialed", sB.called === stateB.claimed.length && sB.called > 0)
    ok("reason = quota", sB.reason === "quota: monthly call cap reached")
  }

  console.log("── cooperative stop ──")
  {
    const rows = makeRows(60)
    const { deps, state } = makeDeps(rows, { pauseMs: 40, dialDelayMs: 3 })
    const d = createBulkDialer(deps)
    await d.start({ concurrency: 5 })
    // Wait for the first wave to be in flight, then request the stop.
    await sleep(15)
    ok("stop() accepted while running", d.stop() === true)
    ok("stopRequested visible in status", d.status().stopRequested === true)
    await waitFinished(d)
    const s = d.status()
    ok("run ended with reason 'stopped'", s.reason === "stopped")
    ok("campaign stopped early (not all 60 dialed)", state.dialed.length < 60)
    ok("the wave already in flight was completed, not abandoned", s.called === state.dialed.length)
    ok("late stop() after finish returns false", d.stop() === false)
  }

  console.log("── live 'on the line now' chips ──")
  {
    const rows = makeRows(6)
    const firstWavePhones = rows.slice(0, 3).map((r) => r.phone) // claimBatch splices `rows` — capture BEFORE
    const { deps } = makeDeps(rows, { pauseMs: 1, dialDelayMs: 60 })
    const d = createBulkDialer(deps)
    await d.start({ concurrency: 3 })
    await sleep(20) // first wave in flight
    const s = d.status()
    ok("current[] shows exactly the in-flight wave (3 phones)", s.current.length === 3)
    ok("chips are the queued phones", firstWavePhones.every((p) => s.current.includes(p)))
    await waitFinished(d)
    ok("current[] cleared when finished", d.status().current.length === 0)
  }

  console.log("── per-branch runner registry ──")
  {
    const { deps } = makeDeps([])
    const a1 = getBulkDialer("branch-A", deps)
    const a2 = getBulkDialer("branch-A", deps)
    const b1 = getBulkDialer("branch-B", deps)
    const hq = getBulkDialer("hq", deps)
    ok("same branch key → same runner instance", a1 === a2)
    ok("different branch keys → independent runners", a1 !== b1 && b1 !== hq && a1 !== hq)
    // Independent state: a run on branch B does not leak into branch A's status
    const rows = makeRows(2)
    const { deps: depsB } = makeDeps(rows, { pauseMs: 1 })
    const bFresh = getBulkDialer("branch-registry-test", depsB)
    await bFresh.start({ concurrency: 2 })
    await waitFinished(bFresh)
    ok("branch A status untouched by branch B run", a1.status().running === false && a1.status().called === 0)
    ok("branch B run tallied on its own runner", bFresh.status().called === 2)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
