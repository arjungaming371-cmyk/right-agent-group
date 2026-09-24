import { NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/logger"

// Production hardening for every API route:
//  1. withRoute()    — no unhandled rejection can ever escape a route handler.
//                      Crashes previously surfaced as Next's opaque 500 with the
//                      stack in server logs only; now every failure is logged as
//                      one structured JSON line (route, method, path, request id,
//                      duration) and the client gets a safe generic body.
//  2. readJson()     — body parsing with a hard size cap and a guaranteed
//                      object/array result (request.json() used to throw raw
//                      SyntaxError on malformed bodies and blow past the handler).
//  3. Validators     — query param coercion + text sanitization used on every
//                      value that reaches a query builder or an LLM prompt.

const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB — largest legit payload is a KB ingest

export type RouteContext = {
  requestId: string
}

type Handler = (req: NextRequest, ctx: RouteContext) => Promise<NextResponse> | NextResponse
type ParamHandler<P> = (req: NextRequest, ctx: RouteContext & { params: Promise<P> }) => Promise<NextResponse> | NextResponse

function errorStatus(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err)
  if (/unauthorized|forbidden/i.test(msg)) return 401
  if (/not[_ ]found/i.test(msg)) return 404
  return 500
}

function safeErrorBody(err: unknown): { error: string } {
  // Never leak Postgres text / stack traces / connection info to the client.
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === "unauthorized" || msg === "forbidden") return { error: msg }
  if (/not[_ ]found/i.test(msg)) return { error: "not found" }
  return { error: "Something went wrong. Please try again." }
}

/**
 * Wrap a route handler so every throw (sync or async), every malformed
 * request and every downstream failure becomes: one structured log line +
 * a safe JSON response. Also stamps x-request-id so an ops user can quote
 * an id that maps 1:1 to the server log.
 */
export function withRoute(name: string, handler: Handler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const start = Date.now()
    const requestId =
      req.headers.get("x-request-id") ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const scoped = logger.child(name)
    try {
      const res = await handler(req, { requestId })
      res.headers.set("x-request-id", requestId)
      const dur = Date.now() - start
      if (res.status >= 500) {
        scoped.error("route_5xx", { method: req.method, path: req.nextUrl.pathname, status: res.status, dur })
      } else if (process.env.LOG_LEVEL === "debug") {
        scoped.debug("route_ok", { method: req.method, status: res.status, dur })
      }
      return res
    } catch (err) {
      const dur = Date.now() - start
      scoped.error("route_threw", {
        route: name,
        method: req.method,
        path: req.nextUrl.pathname,
        requestId,
        dur,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      const res = NextResponse.json(safeErrorBody(err), { status: errorStatus(err) })
      res.headers.set("x-request-id", requestId)
      return res
    }
  }
}

// Dynamic routes ([id]/[token]) get a dedicated wrapper whose exported
// signature matches Next's expected RouteContext exactly — Next's route type
// validation rejects anything else (optional params, Record placeholders).
export function withParams<P>(name: string, handler: ParamHandler<P>) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<NextResponse> => {
    const start = Date.now()
    const requestId =
      req.headers.get("x-request-id") ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const scoped = logger.child(name)
    try {
      const res = await handler(req, { requestId, params: routeCtx.params })
      res.headers.set("x-request-id", requestId)
      const dur = Date.now() - start
      if (res.status >= 500) {
        scoped.error("route_5xx", { method: req.method, path: req.nextUrl.pathname, status: res.status, dur })
      }
      return res
    } catch (err) {
      const dur = Date.now() - start
      scoped.error("route_threw", {
        method: req.method,
        path: req.nextUrl.pathname,
        requestId,
        dur,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      const res = NextResponse.json(safeErrorBody(err), { status: errorStatus(err) })
      res.headers.set("x-request-id", requestId)
      return res
    }
  }
}

// ---- Body parsing ----

export type JsonBody = Record<string, unknown>

/** Parse a JSON body defensively. Returns null for empty/invalid/oversized bodies. */
export async function readJson(req: NextRequest): Promise<JsonBody | null> {
  try {
    const lenHeader = req.headers.get("content-length")
    if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) return null
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return null
    if (!text) return null
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return parsed as JsonBody
  } catch {
    return null
  }
}

/** Parse a JSON array body defensively (export/bulk endpoints). */
export async function readJsonArray(req: NextRequest): Promise<unknown[] | null> {
  try {
    const text = await req.text()
    if (!text || text.length > MAX_BODY_BYTES) return null
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// ---- Query param validators (every value that reaches SQL / business logic) ----

/** Trimmed string param, or null when absent/empty/over-long. */
export function queryString(req: NextRequest, key: string, maxLen = 500): string | null {
  const v = req.nextUrl.searchParams.get(key)
  if (!v) return null
  const t = v.trim()
  if (!t) return null
  return t.length > maxLen ? t.slice(0, maxLen) : t
}

/** Integer param (safe range), or null when absent/non-numeric. */
export function queryInt(req: NextRequest, key: string, min = 1, max = 10_000): number | null {
  const v = req.nextUrl.searchParams.get(key)
  if (v === null || v === "") return null
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n)) return null
  return Math.min(Math.max(n, min), max)
}

/** Param restricted to a fixed set — anything else returns the fallback. */
export function queryEnum<T extends string>(req: NextRequest, key: string, allowed: readonly T[], fallback: T): T {
  const v = req.nextUrl.searchParams.get(key)
  return allowed.includes(v as T) ? (v as T) : fallback
}

// ---- Text sanitization (user text → DB / LLM / email) ----

/**
 * Normalize free-text user input before persistence:
 * strip control characters (except \n \t), collapse \r\n, trim, cap length.
 * Prevents log-forging via \n and weird unicode control abuse downstream.
 */
export function sanitizeText(value: unknown, maxLen = 4000): string {
  if (typeof value !== "string") return ""
  return value
    .replace(/\r\n/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen)
}

/** Normalize a phone number to digits + leading +, capped length. */
export function sanitizePhone(value: unknown): string {
  if (typeof value !== "string") return ""
  const digits = value.replace(/[^\d+]/g, "")
  return digits.slice(0, 20)
}

/** True only for http(s) URLs — blocks javascript:/data: injection into hrefs. */
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const u = new URL(value)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}

// ---- Responses ----

export function jsonOk(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init)
}

export function jsonError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export function jsonUnauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}
