import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"

// Paths that MUST stay public:
// - /login + /api/auth/*          → the login flow itself
// - /api/calls/turn               → voicebot bridge (x-api-key protected inside)
// - /api/calls/status             → Exotel status webhook
// - /form/*, /api/form/*          → the customer-facing loan form
// - /api/whatsapp (POST inbound)  → Meta webhook (HMAC-verified)
// - /api/warmup                   → cron warmup
// - /api/digest                   → scheduled digest email (x-api-key protected inside, see DIGEST.ps1)
// - /api/lead-brain/scan-idle     → scheduled Lead Brain scan (x-api-key protected inside, see lib/scheduler.ts)
// - /api/prompt-tuner/scan        → scheduled Prompt Tuner run (x-api-key protected inside, see lib/scheduler.ts)
const PUBLIC_PREFIXES = [
  "/login",
  "/about",
  "/api/auth/",
  "/form/",
  "/api/form/",
  "/api/warmup",
]

// EXACT matches only — everything else stays session-protected.
// SECURITY: /api/calls (list + trigger outbound), /api/calls/recording
// (Exotel-credentialed audio proxy), and /api/tts are dashboard-only and
// MUST require a login session. Only the two telephony webhooks below and
// the Meta webhook are public.
const PUBLIC_EXACT = [
  "/api/whatsapp", "/api/calls/turn", "/api/calls/status", "/api/digest",
  "/api/system/status", // coarse booleans only — no error details (see route)
  "/api/lead-brain/scan-idle", "/api/prompt-tuner/scan",
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))
  ) {
    return NextResponse.next()
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
