import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

async function assertOwnership(chatId: string, email: string): Promise<boolean> {
  const res = await query(`SELECT 1 FROM assistant_chats WHERE id = $1 AND user_email = $2`, [chatId, email])
  return (res.rowCount ?? 0) > 0
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  if (!(await assertOwnership(id, session.email))) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const res = await query(`SELECT role, content, created_at FROM assistant_messages WHERE chat_id = $1 ORDER BY created_at ASC`, [id])
  return NextResponse.json({ messages: res.rows })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  if (!(await assertOwnership(id, session.email))) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  // ON DELETE CASCADE on assistant_messages.chat_id handles the messages.
  await query(`DELETE FROM assistant_chats WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
