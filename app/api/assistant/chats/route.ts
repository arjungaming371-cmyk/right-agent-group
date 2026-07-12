import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Chat threads for the internal Ops Assistant — scoped per staff member
// (session.email), so nobody sees a colleague's chat history.

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const res = await query(
    `SELECT id, title, created_at, updated_at FROM assistant_chats WHERE user_email = $1 ORDER BY updated_at DESC LIMIT 50`,
    [session.email]
  )
  return NextResponse.json({ chats: res.rows })
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 80) : "New chat"

  const res = await query(
    `INSERT INTO assistant_chats (user_email, title) VALUES ($1, $2) RETURNING id, title, created_at, updated_at`,
    [session.email, title]
  )
  return NextResponse.json({ chat: res.rows[0] })
}
