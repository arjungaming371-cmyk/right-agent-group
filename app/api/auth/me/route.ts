import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ email: null }, { status: 401 })
  return NextResponse.json({ email: session.email })
}
