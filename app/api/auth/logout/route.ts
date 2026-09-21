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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const res = NextResponse.redirect(`${appUrl}/login`, { status: 303 })
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
