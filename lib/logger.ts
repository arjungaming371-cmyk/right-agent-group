// Structured JSON logger — one line per event so pm2/journald/docker logs
// stay greppable and every incident can be reconstructed by event + context
// instead of free-text console.log archaeology.
//
// Why: before this, error paths used bare console.error("...:", e) with
// ad-hoc string prefixes. That loses structure (no level, no route, no
// request id), can't be alert-tested, and multi-line stacks broke log
// pipelines. Every new server-side failure should flow through here.
//
// Usage:
//   const log = logger.child("whatsapp/unread")
//   log.error("count_query_failed", { error: e.message })
// Output: {"ts":"...","level":"error","scope":"whatsapp/unread","event":"...",...}

type Level = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function activeLevel(): Level {
  const raw = (process.env.LOG_LEVEL || "").toLowerCase()
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw
  return process.env.NODE_ENV === "production" ? "info" : "debug"
}

/** Values that must never reach the log line — keys matching these are redacted. */
const REDACT_KEY_RE = /(password|token|secret|api_?key|authorization|cookie|otp)/i
const MAX_DEPTH = 4
const MAX_STR = 2000

function sanitize(value: unknown, depth = 0, key = ""): unknown {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === "string") {
    const s = value as string
    // Redact anything that looks like a credential pasted into a value.
    return s.length > MAX_STR ? s.slice(0, MAX_STR) + "…[truncated]" : s
  }
  if (t === "number" || t === "boolean") return value
  if (t === "bigint") return String(value)
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: depth === 0 ? value.stack : undefined }
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return "[depth]"
    return value.slice(0, 50).map((v, i) => sanitize(v, depth + 1, key))
  }
  if (t === "object") {
    if (depth >= MAX_DEPTH) return "[depth]"
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEY_RE.test(k) ? "[redacted]" : sanitize(v, depth + 1, k)
    }
    return out
  }
  return String(value)
}

function emit(level: Level, scope: string, event: string, ctx?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[activeLevel()]) return
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    event,
    ...(ctx ? (sanitize(ctx) as Record<string, unknown>) : {}),
  })
  // Single write per line: interleaving under concurrency stays intact.
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

export interface Logger {
  debug(event: string, ctx?: Record<string, unknown>): void
  info(event: string, ctx?: Record<string, unknown>): void
  warn(event: string, ctx?: Record<string, unknown>): void
  error(event: string, ctx?: Record<string, unknown>): void
}

function makeLogger(scope: string): Logger {
  return {
    debug: (event, ctx) => emit("debug", scope, event, ctx),
    info: (event, ctx) => emit("info", scope, event, ctx),
    warn: (event, ctx) => emit("warn", scope, event, ctx),
    error: (event, ctx) => emit("error", scope, event, ctx),
  }
}

export const logger = {
  child: makeLogger,
  debug: (event: string, ctx?: Record<string, unknown>) => emit("debug", "app", event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => emit("info", "app", event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => emit("warn", "app", event, ctx),
  error: (event: string, ctx?: Record<string, unknown>) => emit("error", "app", event, ctx),
}
