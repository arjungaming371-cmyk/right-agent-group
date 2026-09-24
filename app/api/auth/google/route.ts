import { NextRequest, NextResponse } from "next/server"
import { isSafeNextPath } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"

export const dynamic = "force-dynamic"

// Step 1 of Google Sign-In: redirect to Google's consent screen.
// A random `state` value is stored in a short-lived cookie to block CSRF.
export const GET = withRoute("auth/google", async (req: NextRequest) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID / NEXT_PUBLIC_APP_URL not configured" }, { status: 500 })
  }

  const state = crypto.randomUUID()
  const nextPath = req.nextUrl.searchParams.get("next") || "/"
  // Only allow same-site relative redirects — never absolute URLs, and also
  // reject "/\\evil.com" (browsers normalize "\\" to "/" for special schemes).
  const safeNext = isSafeNextPath(nextPath) ? nextPath : "/"

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  })

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  const secure = appUrl.startsWith("https")
  res.cookies.set("oauth_state", state, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 })
  res.cookies.set("oauth_next", safeNext, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 })
  return res
})
