import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Step 2 of Google Sign-In:
//  1. Verify the CSRF state cookie.
//  2. Exchange the code for tokens (server-to-server, over TLS).
//  3. Fetch the verified profile from Google's userinfo endpoint.
//  4. ALLOWLIST CHECK — email must exist in allowed_emails (or be ADMIN_EMAIL).
//  5. Issue an HMAC-signed session cookie.
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ""
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  const code = req.nextUrl.searchParams.get("code")
  const state = req.nextUrl.searchParams.get("state")
  const cookieState = req.cookies.get("oauth_state")?.value
  const nextPath = req.cookies.get("oauth_next")?.value || "/"

  const fail = (reason: string) =>
    NextResponse.redirect(`${appUrl}/login?error=${encodeURIComponent(reason)}`)

  if (!clientId || !clientSecret) return fail("Google login not configured on server")
  if (!code || !state || !cookieState || state !== cookieState) return fail("Invalid login state. Please try again.")

  try {
    // Exchange authorization code for tokens.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${appUrl}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokenRes.ok || !tokens.access_token) return fail("Google token exchange failed")

    // Fetch the verified user profile directly from Google.
    const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await profileRes.json()
    const email: string | undefined = profile?.email?.toLowerCase()
    if (!profileRes.ok || !email) return fail("Could not read Google profile")
    if (profile.email_verified === false) return fail("This Google account's email is not verified")

    // ---- ALLOWLIST CHECK ----
    const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase()
    let allowed = adminEmail !== "" && email === adminEmail
    if (!allowed) {
      const r = await query(`SELECT 1 FROM allowed_emails WHERE lower(email) = $1 LIMIT 1`, [email])
      allowed = (r.rowCount ?? 0) > 0
    }
    if (!allowed) {
      console.warn(`Login DENIED for ${email} — not in allowed_emails`)
      return fail("This email is not authorized. Ask the admin to add it.")
    }

    const token = await createSessionToken(email)
    const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/"
    const res = NextResponse.redirect(`${appUrl}${safeNext}`)
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(appUrl.startsWith("https")))
    res.cookies.delete("oauth_state")
    res.cookies.delete("oauth_next")
    return res
  } catch (e: any) {
    console.error("OAuth callback error:", e)
    return fail("Login failed. Please try again.")
  }
}
