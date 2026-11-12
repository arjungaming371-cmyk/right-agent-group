import { NextRequest, NextResponse } from "next/server"
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key")
  const secret = process.env.AUTH_SECRET

  if (!secret || !key || key !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const email = (process.env.ADMIN_EMAIL || "arjun996625@gmail.com").toLowerCase()
  const token = await createSessionToken(email, "admin")

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ""
  const res = NextResponse.redirect(`${appUrl}/dashboard`)
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(appUrl.startsWith("https")))
  return res
}
