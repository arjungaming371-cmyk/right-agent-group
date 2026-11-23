import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { createSessionToken, createOtpPendingToken, isSafeNextPath, SESSION_COOKIE, sessionCookieOptions, type Role } from "@/lib/auth"
import { createLoginNotificationOncePerDay } from "@/lib/notifications"
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
  // Default destination is the console ("/" is the public marketing homepage
  // since 2026-09-24 — signed-in staff must never bounce back to it).
  const nextPath = req.cookies.get("oauth_next")?.value || "/dashboard"

  const fail = (reason: string) =>
    NextResponse.redirect(`${appUrl}/login?error=${encodeURIComponent(reason)}`)

  // Open-redirect hardening (2026-09-20): when NEXT_PUBLIC_APP_URL is unset,
  // appUrl is "" and NextResponse.redirect("/\\evil.com") emits a RELATIVE
  // Location that browsers resolve as protocol-relative → off-site redirect.
  // Fail closed instead of emitting relative redirects.
  if (!appUrl || !/^https?:\/\//.test(appUrl)) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is not configured — login disabled" }, { status: 500 })
  }

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
    // Everyone else's role comes from allowed_emails.role (defaults to "agent")
    // — and their ORG/BRANCH binding comes from the same row (multi-branch:
    // branch_manager and branch-bound agents get their scope stamped into the
    // session at login; they cannot change it afterwards).
    const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase()
    let role: Role | null = adminEmail !== "" && email === adminEmail ? "admin" : null
    let orgId: string | null = null
    let branchId: string | null = null
    if (!role) {
      const r = await query(`SELECT role, org_id, branch_id FROM allowed_emails WHERE lower(email) = $1 LIMIT 1`, [email])
      if (r.rowCount) {
        const rawRole = r.rows[0].role || "agent"
        orgId = r.rows[0].org_id || null
        branchId = r.rows[0].branch_id || null
        if (["admin", "agent", "viewer", "developer", "branch_manager"].includes(rawRole)) {
          role = rawRole as Role
        } else {
          try {
            const cf = await query(`SELECT config FROM form_configs WHERE id = 'custom_roles_config'`)
            if (cf.rowCount && cf.rows[0]?.config?.roles) {
              const found = cf.rows[0].config.roles.find((cr: any) => cr.id === rawRole)
              if (found?.baseRole) role = found.baseRole as Role
            }
          } catch {}
          if (!role) role = "agent"
        }
      }
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

    // Reject backslash + protocol-relative forms (see isSafeNextPath).
    const safeNext = isSafeNextPath(nextPath) ? nextPath : "/dashboard"

    // ---- TWO-FACTOR AUTH (Access Controls toggle) ----
    // When enabled, sign-ins for ANY account in Team Access get a 6-digit code
    // before the session cookie is issued. Delivered directly to their email
    // (and WhatsApp for admin).
    if (await isSecurityEnabled("two_factor_auth")) {
      const mailConfigured = isMailConfigured()
      const adminPhone = process.env.ADMIN_PHONE || "+916301689511"
      const waConfigured = Boolean(process.env.WHATSAPP_TOKEN && adminPhone && role === "admin")

      if (mailConfigured || waConfigured) {
        const code = String(randomInt(100000, 1000000))
        const codeHash = createHash("sha256").update(code).digest("hex")
        await query(
          `INSERT INTO login_otps (email, code_hash, attempts, expires_at)
           VALUES ($1, $2, 0, now() + interval '10 minutes')
           ON CONFLICT (email) DO UPDATE SET code_hash = $2, attempts = 0, expires_at = now() + interval '10 minutes', created_at = now()`,
          [email, codeHash]
        )

        // Send via Email to the team member's specific email address
        if (mailConfigured) {
          await sendMail({
            to: email,
            subject: `${code} is your Right Agent Group verification code`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #0f121d; color: #ffffff; border-radius: 12px; border: 1px solid #1f2438;">
                <div style="font-size: 20px; font-weight: 700; color: #8b7cff; margin-bottom: 16px;">Right Agent Group</div>
                <p style="font-size: 15px; color: #e2e8f0; margin-bottom: 20px;">Hello,</p>
                <p style="font-size: 14px; color: #94a3b8; margin-bottom: 24px;">Your one-time sign-in verification code for the operations console is:</p>
                <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #ffffff; background: #1a1e30; padding: 16px; border-radius: 8px; text-align: center; border: 1px solid #2e3654; margin-bottom: 24px;">
                  ${code}
                </div>
                <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">This code will expire in <strong>10 minutes</strong>. If you did not attempt to sign in to Right Agent Group, please contact your administrator immediately.</p>
                <hr style="border: none; border-top: 1px solid #222944; margin: 24px 0;" />
                <p style="font-size: 11px; color: #64748b;">Right Agent Group · Operations Console Security</p>
              </div>
            `,
          }).catch((e) => console.error("2FA mail error:", e.message))
        }

        // Send via WhatsApp to Admin Phone if WhatsApp is configured and user is admin
        if (waConfigured) {
          const { sendWhatsAppText } = await import("@/lib/whatsapp")
          sendWhatsAppText(
            adminPhone,
            `🔐 *Right Agent Group Verification*\n\nYour sign-in code is: *${code}*\n\nValid for 10 minutes.`
          ).catch((e) => {
            console.error("2FA WhatsApp exception:", e.message)
            return { ok: false, error: e.message }
          })
        }

        const pending = await createOtpPendingToken(email, role, safeNext, { orgId, branchId })
        const res = NextResponse.redirect(`${appUrl}/login?otp=1`)
        res.cookies.set("otp_pending", pending, { httpOnly: true, secure: appUrl.startsWith("https"), sameSite: "lax", path: "/", maxAge: 600 })
        res.cookies.delete("oauth_state")
        res.cookies.delete("oauth_next")
        return res
      }
      console.warn("2FA is enabled but neither SMTP nor WhatsApp is configured")
      query(
        `INSERT INTO audit_logs (action, performed_by, metadata) VALUES ('2FA blocked — no delivery channel', $1, '{"source":"login"}')`,
        [email]
      ).catch(() => {})
      return fail("2FA is enabled but neither email nor WhatsApp is configured. Contact the administrator.")
    }

    // The full-access role's sign-ins never appear here — this notification
    // is visible to every logged-in role, so posting it would broadcast that
    // account's email and existence to everyone, undoing the point of hiding
    // it from Team Access / the audit log / the Ops Assistant elsewhere.
    if (role !== "developer") {
      // Once-per-day dedupe: logins must not bury escalations in the bell.
      createLoginNotificationOncePerDay(`${email} (${role})`)
    }

    const token = await createSessionToken(email, role, { orgId, branchId })
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
