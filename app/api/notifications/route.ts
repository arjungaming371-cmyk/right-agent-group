import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/auth"
import { isValidNotificationId, pruneNotifications } from "@/lib/notifications"

export const dynamic = "force-dynamic"

// Read-only for every logged-in role — notifications never mutate business
// data, they're a heads-up. Middleware already blocks unauthenticated calls;
// re-checked here per this app's pattern for every route.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // RETENTION: nothing ever deleted old rows (the table grew unbounded).
  // Prune behind a ~5% random gate so an open dashboard self-heals about
  // once every few minutes instead of paying a DELETE on every 20s poll.
  // Fire-and-forget — a failed prune must never break the read.
  if (Math.random() < 0.05) {
    pruneNotifications().catch(() => {})
  }

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
  // FIX (2026-09-26): a malformed id used to reach `WHERE id = $1` and
  // Postgres rejected the non-UUID as a 500. Validate first, 400 on junk.
  const id = body?.id
  if (!isValidNotificationId(id)) {
    return NextResponse.json({ error: "valid notification id required" }, { status: 400 })
  }
  await query(`UPDATE notifications SET read = true WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
