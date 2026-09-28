// Shared arithmetic for every number the dashboard computes, sorts by, or
// shows a human. The rule this file exists to enforce: percentages, rates
// and averages are NEVER hand-rolled at the call site — one divide-by-zero
// in a SQL row of zeros used to be all it took to render "NaN%" on the
// analytics screen. Pure functions only: no DB, no fetch, safe in the
// browser (client components import this too) and on the server.

/** Clamp n into [lo, hi]. Inputs that aren't finite numbers come back as lo. */
export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

/** Round to `dp` decimal places without float dust (roundTo(1.005, 2) → 1.01). */
export function roundTo(n: number, dp = 0): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f
}

/**
 * a/b that refuses to poison the UI: zero/NaN denominators return 0 instead
 * of Infinity/NaN. Every "rate" on the dashboard funnels through here.
 */
export function safeDivide(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0
  return a / b
}

/** part/whole as a 0-100 percentage, rounded to `dp` (default 1). */
export function pctOf(part: number, whole: number, dp = 1): number {
  return roundTo(safeDivide(part, whole) * 100, dp)
}

/** part/whole as a 0-1 fraction — for weights and probability math. */
export function rateOf(part: number, whole: number): number {
  return safeDivide(part, whole)
}

/**
 * Percentage change from oldV to newV ("+18.5% vs last week"). Going from
 * zero to anything is defined as +100 (not Infinity); sign is preserved.
 */
export function pctChange(oldV: number, newV: number, dp = 1): number {
  if (!Number.isFinite(oldV) || oldV === 0) return newV === 0 ? 0 : 100
  return roundTo(safeDivide(newV - oldV, Math.abs(oldV)) * 100, dp)
}

/** Arithmetic mean of a non-empty-ish list; empty input → 0. */
export function mean(values: number[]): number {
  if (!values.length) return 0
  return safeDivide(values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0), values.length)
}

/** Median (average of the two middle values on even-length input); empty → 0. */
export function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Σ weights·values / Σ weights — duration-weighted averages, score blends. */
export function weightedAverage(values: number[], weights: number[]): number {
  const wSum = weights.reduce((s, w) => s + (Number.isFinite(w) ? w : 0), 0)
  if (wSum === 0) return 0
  const vSum = values.reduce((s, v, i) => s + (Number.isFinite(v) ? v : 0) * (Number.isFinite(weights[i]) ? weights[i] : 0), 0)
  return vSum / wSum
}

/** "12.5" with a % suffix for tiles/labels. */
export function formatPct(n: number, dp = 1): string {
  return `${roundTo(n, dp)}%`
}

/**
 * 0-1 fraction as a rounded percentage number — the shape chart tooltips
 * and StatTiles want (pass through formatPct only when a % sign is needed).
 */
export function asPct(fraction: number, dp = 1): number {
  return roundTo(fraction * 100, dp)
}
