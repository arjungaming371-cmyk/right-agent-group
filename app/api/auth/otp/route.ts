import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { createSessionToken, verifyOtpPendingToken, isSafeNextPath, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth"
import { createLoginNotificationOncePerDay } from "@/lib/notifications"
import { rateLimit, clientIp } from "@/lib/rate-limit"
import { createHash, timingSafeEqual } from "crypto"

export const dynamic = "force-dynamic"

// Same-site relative path guard — also rejects backslash forms ("/\\evil.com")
// which browsers normalize to protocol-relative redirects. (Shared via lib/auth.)

// Step 2 of an admin sign-in when Two-Factor Authentication is enabled:
// the OAuth callback stored a signed pending token in the otp_pending
// cookie and emailed a 6-digit code. This endpoint checks both and only
// then issues the real session cookie. 5 wrong attempts kills the code.
export async function POST(req: NextRequest) {
  if (!rateLimit(`otp:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts — wait a minute" }, { status: 429 })
  }

  const pending = await verifyOtpPendingToken(req.cookies.get("otp_pending")?.value)
  if (!pending) return NextResponse.json({ error: "Sign-in session expired — please sign in again" }, { status: 401 })

  const { code } = await req.json().catch(() => ({}) as any)
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
    return NextResponse.json({ error: "Enter the 6-digit code from your email" }, { status: 400 })
  }

  // FIX (2026-09-20): the old flow raced — concurrent guesses all read
  // `attempts` before any increment landed, stretching the 5-attempt cap.
  // Atomically claim one attempt; if the row is gone/expired/exhausted the
  // UPDATE matches nothing. Also compare hashes constant-time.
  const spent = await query(
    `UPDATE login_otps SET attempts = attempts + 1
     WHERE email = $1 AND expires_at > now() AND attempts < 5
     RETURNING code_hash`,
    [pending.email]
  )
  const row = spent.rows[0]
  if (!row) {
    const still = (await query(`SELECT 1 FROM login_otps WHERE email = $1`, [pending.email])).rows[0]
    if (!still) return NextResponse.json({ error: "Code expired — please sign in again" }, { status: 410 })
    return NextResponse.json({ error: "Too many wrong codes — please sign in again" }, { status: 410 })
  }

  const codeHash = createHash("sha256").update(code.trim()).digest("hex")
  const a = Buffer.from(codeHash)
  const b = Buffer.from(String(row.code_hash || ""))
  const ok = a.length === b.length && timingSafeEqual(a, b)
  if (!ok) {
    return NextResponse.json({ error: "Wrong code — check your email and try again" }, { status: 401 })
  }

  await query(`DELETE FROM login_otps WHERE email = $1`, [pending.email]).catch(() => {})
  // Same exclusion as the primary login path (app/api/auth/google/callback) —
  // OTP is only ever issued to admin logins today, but guard it here too so
  // this doesn't silently start leaking if that ever changes.
  if (pending.role !== "developer") {
    // Once-per-day dedupe: logins must not bury escalations in the bell.
    createLoginNotificationOncePerDay(`${pending.email} (${pending.role}, 2FA verified)`)
  }
  query(
    `INSERT INTO audit_logs (action, performed_by, metadata) VALUES ('2FA code verified', $1, '{"source":"login"}')`,
    [pending.email]
  ).catch(() => {})

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ""
  // Carry the branch scope decided at OAuth time into the real session.
  const token = await createSessionToken(pending.email, pending.role, { orgId: pending.orgId, branchId: pending.branchId })
  // Open-redirect hardening: only same-site relative paths that don't start
  // with "/"+"/" or "/"+"\\" survive to the client.
  const nextPath = isSafeNextPath(pending.next) ? pending.next! : "/"
  const res = NextResponse.json({ ok: true, next: nextPath })
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(appUrl.startsWith("https")))
  res.cookies.delete("otp_pending")
  return res
}
