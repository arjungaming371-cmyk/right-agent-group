import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const res = NextResponse.redirect(`${appUrl}/login`, { status: 303 })
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
