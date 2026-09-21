// Simple in-memory sliding-window rate limiter for PUBLIC endpoints
// (the loan form is reachable without login, so it needs protection).
// Suitable for a single-server deployment — no Redis required.

type Bucket = { timestamps: number[] }
const buckets = new Map<string, Bucket>()

// Housekeeping: prevent unbounded memory growth
const MAX_BUCKETS = 10_000
let lastSweep = Date.now()

function sweep(windowMs: number) {
  const now = Date.now()
  if (now - lastSweep < 60_000 && buckets.size < MAX_BUCKETS) return
  lastSweep = now
  for (const [key, b] of buckets) {
    b.timestamps = b.timestamps.filter((t) => now - t < windowMs)
    if (b.timestamps.length === 0) buckets.delete(key)
  }
}

/**
 * Returns true if the request is ALLOWED, false if rate-limited.
 * @param key    unique key, e.g. `form:${ip}` or `form:${token}`
 * @param limit  max requests per window (default 20)
 * @param windowMs window size in ms (default 60s)
 */
export function rateLimit(key: string, limit = 20, windowMs = 60_000): boolean {
  sweep(windowMs)
  const now = Date.now()
  let b = buckets.get(key)
  if (!b) {
    b = { timestamps: [] }
    buckets.set(key, b)
  }
  b.timestamps = b.timestamps.filter((t) => now - t < windowMs)
  if (b.timestamps.length >= limit) return false
  b.timestamps.push(now)
  return true
}

/**
 * Extract the client IP from a Next.js request (works behind Cloudflare/nginx).
 * SECURITY (2026-09-20): the old chain preferred cf-connecting-ip, which nginx
 * does NOT strip — any client could rotate it per request and reset every
 * rate-limit bucket. Now x-real-ip (overwritten by our nginx) wins, and
 * x-forwarded-for uses the LAST entry (the hop our own proxy appended).
 */
export function clientIp(req: Request): string {
  const h = (name: string) => (req.headers.get(name) || "").trim()
  const real = h("x-real-ip")
  if (real) return real.split(",")[0].trim()
  const cf = h("cf-connecting-ip")
  if (cf) return cf.split(",")[0].trim()
  const xff = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean)
  if (xff.length > 0) return xff[xff.length - 1]
  return "unknown"
}
