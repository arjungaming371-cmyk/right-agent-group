import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"

// Paths that MUST stay public:
// - /login + /api/auth/*          → the login flow itself
// - /api/calls/turn               → voicebot bridge (x-api-key protected inside)
// - /api/calls/status             → Exotel status webhook
// - /api/calls/passthru           → Exotel Passthru applet webhook (delivers RecordingUrl)
// - /form/*, /api/form/*          → the customer-facing loan form
// - /apply, /api/apply            → the public promo/marketing site + its application form
// - /api/whatsapp (POST inbound)  → Meta webhook (HMAC-verified)
// - /api/warmup                   → cron warmup
// - /api/digest                   → scheduled digest email (x-api-key protected inside, see DIGEST.ps1)
// - /api/lead-brain/scan-idle     → scheduled Lead Brain scan (x-api-key protected inside, see lib/scheduler.ts)
// - /api/prompt-tuner/scan        → scheduled Prompt Tuner run (x-api-key protected inside, see lib/scheduler.ts)
const PUBLIC_PREFIXES = [
  "/login",
  "/about",
  "/apply",
  "/promo/",
  "/api/auth/",
  "/form/",
  "/api/form/",
  "/api/apply",
  "/api/warmup",
]

// EXACT matches only — everything else stays session-protected.
// SECURITY: /api/calls (list + trigger outbound), /api/calls/recording
// (Exotel-credentialed audio proxy), and /api/tts are dashboard-only and
// MUST require a login session. Only the two telephony webhooks below and
// the Meta webhook are public.
const PUBLIC_EXACT = [
  "/api/whatsapp", "/api/instagram", "/api/calls/turn", "/api/calls/status", "/api/calls/passthru", "/api/digest",
  "/api/system/status", // coarse booleans only — no error details (see route)
  "/api/security/flags", // one boolean, read back by this middleware itself
  "/api/branding", // white-label public branding (public-safe fields only)
  "/api/form-config", // public form schema for customer loan form
  "/api/lead-brain/scan-idle", "/api/prompt-tuner/scan",
]

// ---- IP allowlist (Access Controls toggle) ----
// The toggle lives in Postgres, which Edge middleware can't query — so the
// enabled flag is fetched from /api/security/flags and cached 30s. The
// approved addresses come from the IP_ALLOWLIST env var (comma-separated;
// exact IPs, or prefixes ending in "." for whole ranges). Fail-open when
// the toggle is on but no list is configured — an empty list must never
// lock the admin out.
let _ipFlagCache = false
let _ipFlagAt = 0

async function ipAllowlistEnabled(origin: string): Promise<boolean> {
  if (Date.now() - _ipFlagAt < 30_000) return _ipFlagCache
  try {
    const res = await fetch(`${origin}/api/security/flags`, { cache: "no-store" })
    if (res.ok) {
      _ipFlagCache = !!(await res.json())?.ip_allowlist
      _ipFlagAt = Date.now()
    }
  } catch {
    // flags endpoint unreachable — keep last known value
  }
  return _ipFlagCache
}

function ipAllowed(clientIp: string): boolean {
  const entries = (process.env.IP_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean)
  if (entries.length === 0) return true
  if (clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "") return true
  return entries.some((e) => (e.endsWith(".") ? clientIp.startsWith(e) : clientIp === e))
}

/**
 * SECURITY (2026-09 fix): pick the client IP from TRUSTED proxy headers.
 * nginx sets X-Real-IP to the actual socket address; with
 * $proxy_add_x_forwarded_for the FIRST X-Forwarded-For entry is whatever the
 * CLIENT typed (spoofable — an attacker sent "X-Forwarded-For: 1.2.3.4" and
 * passed a previously-allowlisted IP check). Fall back to the LAST XFF entry,
 * which is the address our own trusted proxy appended.
 */
function trustedClientIp(req: NextRequest): string {
  const realIp = (req.headers.get("x-real-ip") || "").trim()
  if (realIp) return realIp
  const xff = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean)
  return xff.length ? xff[xff.length - 1] : ""
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))
  ) {
    return NextResponse.next()
  }

  // Console (session-protected) surface only — webhooks and the customer
  // form above are never IP-restricted.
  if (await ipAllowlistEnabled(req.nextUrl.origin)) {
    if (!ipAllowed(trustedClientIp(req))) {
      return new NextResponse("Access restricted to approved network ranges.", { status: 403 })
    }
  }

  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)
  if (session) return NextResponse.next()

  // APIs get 401 JSON; pages get redirected to /login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const loginUrl = new URL("/login", req.url)
  loginUrl.searchParams.set("next", pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|map)$).*)"],
}
