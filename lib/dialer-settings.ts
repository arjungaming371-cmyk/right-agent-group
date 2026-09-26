// Dialer runtime settings — the persisted concurrency slider + auto-retry
// policy (Feature 3/4 of the bulk plan). Stored in a tiny kv table so the
// runner reads the LIVE value on every claim cycle: the dashboard slider is
// genuinely "on the fly" because there is no long-lived process holding a
// stale copy. Created lazily (same contract as ai_scripts) so a missed
// migration can never hard-fail the dialer.
//
// The old UI let the operator type a concurrency of 20 while the route
// silently capped at 10 — settings here are clamped 1-10 end to end so the
// slider and the engine finally agree.

import { query } from "@/lib/db"

export type DialerSettings = {
  concurrency: number // simultaneous calls, 1-10
  autoRetry: boolean // re-queue busy/no-answer automatically
  retryDelayMinutes: number // delay before an auto-retry dials again
  maxRetries: number // hard cap per queue row
}

export const DIALER_SETTINGS_DEFAULTS: DialerSettings = {
  concurrency: 1, // matches the historic sequential default
  autoRetry: true,
  retryDelayMinutes: 120, // plan default: re-queue 2h later
  maxRetries: 2, // plan default: max 2 retries per lead
}

let cache: { value: DialerSettings; at: number } | null = null
let ensured = false
const CACHE_TTL_MS = 15 * 1000 // short on purpose — the slider should feel live

function clampSettings(raw: Partial<Record<string, unknown>>): DialerSettings {
  const num = (v: unknown, def: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : def
  }
  return {
    concurrency: Math.min(10, Math.max(1, Math.round(num(raw.concurrency, DIALER_SETTINGS_DEFAULTS.concurrency)))),
    autoRetry: raw.autoRetry === undefined ? DIALER_SETTINGS_DEFAULTS.autoRetry : raw.autoRetry === true || raw.autoRetry === "true",
    retryDelayMinutes: Math.min(1440, Math.max(5, Math.round(num(raw.retryDelayMinutes, DIALER_SETTINGS_DEFAULTS.retryDelayMinutes)))),
    maxRetries: Math.min(5, Math.max(0, Math.round(num(raw.maxRetries, DIALER_SETTINGS_DEFAULTS.maxRetries)))),
  }
}

async function ensureTable(): Promise<void> {
  if (ensured) return
  await query(`CREATE TABLE IF NOT EXISTS dialer_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT
  )`)
  ensured = true
}

export function invalidateDialerSettingsCache(): void {
  cache = null
}

export async function getDialerSettings(): Promise<DialerSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value
  try {
    await ensureTable()
    const res = await query(`SELECT key, value FROM dialer_settings`)
    const map: Record<string, string> = {}
    for (const row of res.rows as { key: string; value: string }[]) map[row.key] = row.value
    const value = clampSettings({
      concurrency: map.concurrency,
      autoRetry: map.auto_retry,
      retryDelayMinutes: map.retry_delay_minutes,
      maxRetries: map.max_retries,
    })
    cache = { value, at: Date.now() }
    return value
  } catch {
    // Settings are an operator convenience — a missing table/DB blip must
    // never stop the dialer. Historic defaults apply.
    return { ...DIALER_SETTINGS_DEFAULTS }
  }
}

export async function setDialerSettings(
  patch: Partial<DialerSettings>,
  updatedBy?: string
): Promise<DialerSettings> {
  await ensureTable()
  // Clamp against the CURRENT stored settings so a PATCH of one key cannot
  // reset the others to defaults.
  const current = await getDialerSettings()
  const merged = clampSettings({ ...current, ...patch })
  const entries: [string, string][] = [
    ["concurrency", String(merged.concurrency)],
    ["auto_retry", String(merged.autoRetry)],
    ["retry_delay_minutes", String(merged.retryDelayMinutes)],
    ["max_retries", String(merged.maxRetries)],
  ]
  for (const [key, value] of entries) {
    await query(
      `INSERT INTO dialer_settings (key, value, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3`,
      [key, value, updatedBy || null]
    )
  }
  invalidateDialerSettingsCache()
  return merged
}
