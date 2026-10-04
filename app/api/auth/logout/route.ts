import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { SESSION_COOKIE } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  // FIX (2026-09-20): revocation. Logout used to only clear THIS browser's
  // cookie — a stolen rag_session stayed valid for the remaining 7 days with
  // no way to invalidate it. Bumping session_epoch invalidates every cookie
  // minted before now (checked in getLiveSession).
  try {
    const { getSessionFromRequest } = await import("@/lib/auth")
    const session = await getSessionFromRequest(req)
    if (session) {
      await query(
        `UPDATE allowed_emails SET session_epoch = COALESCE(session_epoch, 0) + 1 WHERE lower(email) = $1`,
        [session.email.toLowerCase()]
      ).catch(() => {})
    }
  } catch {}
  // SECURITY (2026-10-05): the redirect target used to fall back to the
  // request origin — attacker-controlled Host header. The OAuth callback
  // fails closed in exactly this situation; logout now does too. When
  // NEXT_PUBLIC_APP_URL is unset we clear the cookie and answer a plain
  // JSON ok instead of bouncing anywhere.
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")
  const res = configured
    ? NextResponse.redirect(`${configured}/login`, { status: 303 })
    : NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
