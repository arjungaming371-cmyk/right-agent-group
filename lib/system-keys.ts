import { query } from "./db"

// In-memory cache for ultra-fast turns (refreshed every 30s)
let _keyCache: Record<string, string> = {}
let _cacheTime = 0
const CACHE_TTL_MS = 30_000

export const ALL_SYSTEM_KEYS = [
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_APP_SECRET",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_APP_SECRET",
  "GROQ_API_KEY",
  "SARVAM_API_KEY",
  "CARTESIA_API_KEY",
  "CARTESIA_VOICE_ID",
  "EXOTEL_SID",
  "EXOTEL_TOKEN",
  "EXOTEL_CALLER_ID",
] as const

export type SystemKeyName = typeof ALL_SYSTEM_KEYS[number]

/**
 * Load system key from database, falling back to process.env.
 */
export async function getSystemKey(keyName: string): Promise<string> {
  const now = Date.now()
  if (now - _cacheTime > CACHE_TTL_MS) {
    try {
      const res = await query(`SELECT key_name, key_value FROM system_api_keys`)
      const freshCache: Record<string, string> = {}
      for (const row of res.rows) {
        if (row.key_value) {
          freshCache[row.key_name] = row.key_value
        }
      }
      _keyCache = freshCache
      _cacheTime = now
    } catch {
      // Ignore DB error, use existing cache or process.env
    }
  }

  // 1. Check DB Cache
  if (_keyCache[keyName]) {
    return _keyCache[keyName]
  }

  // 2. Fallback to process.env
  return process.env[keyName] || ""
}

/**
 * Save / Update system keys in DB.
 */
export async function setSystemKeys(keys: Record<string, string>, userEmail: string): Promise<void> {
  for (const [keyName, keyValue] of Object.entries(keys)) {
    if (!keyValue.trim()) continue

    await query(
      `INSERT INTO system_api_keys (key_name, key_value, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key_name) DO UPDATE
       SET key_value = EXCLUDED.key_value,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
      [keyName, keyValue.trim(), userEmail]
    )

    _keyCache[keyName] = keyValue.trim()
  }

  // Log audit
  await query(
    `INSERT INTO developer_logs (level, category, message, meta)
     VALUES ('info', 'security', $1, $2)`,
    [
      `API keys updated by ${userEmail}`,
      JSON.stringify({ keys: Object.keys(keys), userEmail }),
    ]
  ).catch(() => {})
}

/**
 * Get configuration status and masked previews for all keys.
 */
export async function getSystemKeysStatus(): Promise<
  Record<string, { configured: boolean; preview: string; source: "database" | "env" | "none" }>
> {
  const dbKeysRes = await query(`SELECT key_name, key_value FROM system_api_keys`).catch(() => ({ rows: [] }))
  const dbMap: Record<string, string> = {}
  for (const row of dbKeysRes.rows) {
    if (row.key_value) dbMap[row.key_name] = row.key_value
  }

  const result: Record<string, { configured: boolean; preview: string; source: "database" | "env" | "none" }> = {}

  for (const name of ALL_SYSTEM_KEYS) {
    const dbVal = dbMap[name]
    const envVal = process.env[name] || ""

    const val = dbVal || envVal
    const configured = !!val.trim()
    const source = dbVal ? "database" : envVal ? "env" : "none"

    let preview = "Not configured"
    if (configured) {
      if (val.length <= 8) {
        preview = "••••" + val.slice(-2)
      } else {
        preview = val.slice(0, 4) + "••••••••" + val.slice(-4)
      }
    }

    result[name] = { configured, preview, source }
  }

  return result
}

/**
 * Log live token consumption (e.g. Groq, Sarvam, WhatsApp, Instagram).
 */
export async function recordTokenUsage(provider: string, tokens: number, details?: any): Promise<void> {
  if (tokens <= 0) return
  await query(
    `INSERT INTO api_usage_logs (provider, tokens_used, details) VALUES ($1, $2, $3)`,
    [provider, tokens, details ? JSON.stringify(details) : null]
  ).catch(() => {})
}

/**
 * Get token usage statistics (Today & This Month).
 */
export async function getTokenUsageStats(): Promise<{
  today: Record<string, number>
  month: Record<string, number>
}> {
  try {
    const todayRes = await query(
      `SELECT provider, SUM(tokens_used)::int as total
       FROM api_usage_logs
       WHERE created_at >= CURRENT_DATE
       GROUP BY provider`
    )

    const monthRes = await query(
      `SELECT provider, SUM(tokens_used)::int as total
       FROM api_usage_logs
       WHERE created_at >= date_trunc('month', CURRENT_DATE)
       GROUP BY provider`
    )

    const today: Record<string, number> = {}
    const month: Record<string, number> = {}

    for (const r of todayRes.rows) today[r.provider] = r.total || 0
    for (const r of monthRes.rows) month[r.provider] = r.total || 0

    return { today, month }
  } catch {
    return { today: {}, month: {} }
  }
}
