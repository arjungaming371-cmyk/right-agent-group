import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Read-only for every logged-in role — notifications never mutate business
// data, they're a heads-up. Middleware already blocks unauthenticated calls;
// re-checked here per this app's pattern for every route.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const [list, unread] = await Promise.all([
    query(`SELECT id, type, title, body, link_view, read, created_at FROM notifications ORDER BY created_at DESC LIMIT 30`),
    query(`SELECT COUNT(*)::int AS n FROM notifications WHERE read = false`),
  ])
  return NextResponse.json({ notifications: list.rows, unreadCount: unread.rows[0].n })
}

// Mark one notification (by id) or all notifications as read.
export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (body?.all === true) {
    await query(`UPDATE notifications SET read = true WHERE read = false`)
    return NextResponse.json({ ok: true })
  }
  const id = String(body?.id || "")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  await query(`UPDATE notifications SET read = true WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
