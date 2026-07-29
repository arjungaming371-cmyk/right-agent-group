import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { createSessionToken, createOtpPendingToken, SESSION_COOKIE, sessionCookieOptions, type Role } from "@/lib/auth"
import { createNotification } from "@/lib/notifications"
import { isSecurityEnabled } from "@/lib/security"
import { isMailConfigured, sendMail } from "@/lib/mail"
import { logAudit } from "@/lib/audit"
import { createHash, randomInt } from "crypto"

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

    // ---- ALLOWLIST CHECK + ROLE LOOKUP ----
    // ADMIN_EMAIL is always the "admin" role, regardless of what's in the DB.
    // Everyone else's role comes from allowed_emails.role (defaults to "agent").
    const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase()
    let role: Role | null = adminEmail !== "" && email === adminEmail ? "admin" : null
    if (!role) {
      const r = await query(`SELECT role FROM allowed_emails WHERE lower(email) = $1 LIMIT 1`, [email])
      if (r.rowCount) role = (r.rows[0].role as Role) || "agent"
    }
    if (!role) {
      console.warn(`Login DENIED for ${email} — not in allowed_emails`)
      return fail("This email is not authorized. Ask the admin to add it.")
    }

    // ---- TEAM PROFILE — captured automatically from Google, no manual entry ----
    // Google's userinfo response (requested via scope "openid email profile")
    // already includes name/picture; this is the first place anything reads
    // them. Own table, not columns on allowed_emails — that table governs WHO
    // CAN LOG IN, a separate concern from what their profile looks like, and
    // the admin (identified via ADMIN_EMAIL, not necessarily a row in
    // allowed_emails) still gets a profile row this way.
    //
    // profile_customized guards name/avatar once someone edits them by hand
    // (see /api/team/profile) — without it, this upsert would silently wipe
    // a manual edit back to Google's values on the very next login.
    query(
      `INSERT INTO team_profiles (email, display_name, avatar_url, last_login_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (email) DO UPDATE SET
         display_name = CASE WHEN team_profiles.profile_customized THEN team_profiles.display_name ELSE $2 END,
         avatar_url = CASE WHEN team_profiles.profile_customized THEN team_profiles.avatar_url ELSE $3 END,
         last_login_at = now()`,
      [email, profile.name || null, profile.picture || null]
    ).catch((e) => console.error("team_profiles upsert error:", e.message))
    logAudit("signed in", email, {})

    const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/"

    // ---- TWO-FACTOR AUTH (Access Controls toggle) ----
    // Admin sign-ins get an emailed 6-digit code before the session cookie
    // is issued. Requires SMTP; if mail isn't configured the sign-in
    // proceeds (fail-open, audit-logged) rather than locking the admin out.
    if (role === "admin" && (await isSecurityEnabled("two_factor_auth"))) {
      if (isMailConfigured()) {
        const code = String(randomInt(100000, 1000000))
        const codeHash = createHash("sha256").update(code).digest("hex")
        await query(
          `INSERT INTO login_otps (email, code_hash, attempts, expires_at)
           VALUES ($1, $2, 0, now() + interval '10 minutes')
           ON CONFLICT (email) DO UPDATE SET code_hash = $2, attempts = 0, expires_at = now() + interval '10 minutes', created_at = now()`,
          [email, codeHash]
        )
        sendMail({
          to: email,
          subject: `${code} is your Right Agent Group sign-in code`,
          html: `<p>Your one-time sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you didn't try to sign in, you can ignore this email.</p>`,
        }).catch((e) => console.error("2FA mail error:", e.message))

        const pending = await createOtpPendingToken(email, role, safeNext)
        const res = NextResponse.redirect(`${appUrl}/login?otp=1`)
        res.cookies.set("otp_pending", pending, { httpOnly: true, secure: appUrl.startsWith("https"), sameSite: "lax", path: "/", maxAge: 600 })
        res.cookies.delete("oauth_state")
        res.cookies.delete("oauth_next")
        return res
      }
      console.warn("2FA is enabled but SMTP is not configured — admin sign-in proceeding without a code")
      query(
        `INSERT INTO audit_logs (action, performed_by, metadata) VALUES ('2FA skipped — SMTP not configured', $1, '{"source":"login"}')`,
        [email]
      ).catch(() => {})
    }

    // The full-access role's sign-ins never appear here — this notification
    // is visible to every logged-in role, so posting it would broadcast that
    // account's email and existence to everyone, undoing the point of hiding
    // it from Team Access / the audit log / the Ops Assistant elsewhere.
    if (role !== "developer") {
      createNotification({ type: "login", title: "Team member signed in", body: `${email} (${role})` })
    }

    const token = await createSessionToken(email, role)
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
