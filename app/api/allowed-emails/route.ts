import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

// Middleware already blocks unauthenticated calls, but we verify again here —
// never trust a single layer for an access-control endpoint.
async function requireSession(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return null
  return session
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const r = await query(`SELECT email, added_by, created_at FROM allowed_emails ORDER BY created_at DESC`)
  return NextResponse.json({ emails: r.rows, you: session.email })
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }
  const email = String(body?.email || "").trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid email address" }, { status: 400 })
  }

  await query(
    `INSERT INTO allowed_emails (email, added_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
    [email, session.email]
  )
  return NextResponse.json({ ok: true, email })
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const email = String(new URL(req.url).searchParams.get("email") || "").trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid email" }, { status: 400 })

  // Safety: a user cannot remove their own access (prevents locking everyone out one by one),
  // and the ADMIN_EMAIL bootstrap account can never be removed.
  if (email === session.email) return NextResponse.json({ error: "you cannot remove your own access" }, { status: 400 })
  if (email === (process.env.ADMIN_EMAIL || "").toLowerCase()) {
    return NextResponse.json({ error: "the admin email cannot be removed" }, { status: 400 })
  }

  await query(`DELETE FROM allowed_emails WHERE lower(email) = $1`, [email])
  return NextResponse.json({ ok: true })
}
