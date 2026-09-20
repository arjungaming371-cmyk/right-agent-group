// Live reads of the Access Controls toggles (security_settings table) for
// the code paths that ENFORCE them. Cached for 30s per server instance so
// hot paths (login, recording proxy) don't pay a DB round-trip every hit.

import crypto from "crypto"
import { query } from "./db"

export type SecurityFlag =
  | "two_factor_auth"
  | "single_sign_on"
  | "ip_allowlist"
  | "call_recording_encryption"

let _cache: Record<string, boolean> = {}
let _cacheTime = 0
const TTL = 30_000

export async function getSecurityFlags(): Promise<Record<string, boolean>> {
  const now = Date.now()
  if (now - _cacheTime < TTL && Object.keys(_cache).length) return _cache
  try {
    const res = await query(`SELECT key, enabled FROM security_settings`)
    _cache = Object.fromEntries(res.rows.map((r: any) => [r.key, !!r.enabled]))
    _cacheTime = now
  } catch {
    // DB hiccup — keep whatever we had; default off if nothing cached.
  }
  return _cache
}

export async function isSecurityEnabled(flag: SecurityFlag): Promise<boolean> {
  return !!(await getSecurityFlags())[flag]
}

/**
 * IP allowlist check. The list of approved addresses comes from the
 * IP_ALLOWLIST env var (comma-separated). Each entry is an exact IP or a
 * prefix ending in "." (e.g. "203.0.113." approves the whole /24).
 * FAIL-OPEN when the toggle is on but no list is configured — an empty
 * list must never lock everyone (including the admin) out.
 */
export function ipAllowed(clientIp: string): boolean {
  const raw = (process.env.IP_ALLOWLIST || "").trim()
  if (!raw) return true
  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean)
  if (entries.length === 0) return true
  // Local/dev addresses always pass — enforcement targets the public tunnel.
  if (clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "unknown") return true
  return entries.some((e) => (e.endsWith(".") ? clientIp.startsWith(e) : clientIp === e))
}

/**
 * Constant-time string equality for secret comparisons (service API keys,
 * webhook verify tokens). A plain === leaks the secret byte-by-byte through
 * timing; for low-value internal keys the risk is theoretical, but the fix
 * is one function — so every secret compare goes through this.
 * Length-mismatch fast path is safe: lengths are public, contents are not.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a || "")
  const bb = Buffer.from(b || "")
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}
