import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// GET — list recent DND/suppression entries.
export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "security", ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const res = await query(`SELECT phone, reason, source, added_by, created_at FROM dnd_suppression ORDER BY created_at DESC LIMIT 500`)
  return NextResponse.json({ entries: res.rows })
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "security", ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const reason: string | null = typeof body.reason === "string" ? body.reason.slice(0, 300) : null
  const rawPhones: string[] = Array.isArray(body.phones)
    ? body.phones
    : typeof body.phone === "string"
      ? [body.phone]
      : []

  const cleaned = rawPhones
    .map((p) => String(p).replace(/\D/g, ""))
    .filter((p) => p.length >= 10)
    .map((p) => p.slice(-10))
  const unique = Array.from(new Set(cleaned))
  if (unique.length === 0) return NextResponse.json({ error: "no valid phone numbers provided" }, { status: 400 })

  let added = 0
  for (const phone of unique) {
    const res = await query(
      `INSERT INTO dnd_suppression (phone, reason, source, added_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) DO NOTHING`,
      [phone, reason, unique.length > 1 ? "csv_upload" : "manual", session.email]
    )
    added += res.rowCount ?? 0
  }
  logAudit("dnd suppression numbers added", session.email, { count: added, total: unique.length })
  return NextResponse.json({ ok: true, added, total: unique.length })
}

// DELETE — remove a number from the suppression list (?phone=...).
export async function DELETE(req: NextRequest) {
  const session = await requireModuleOrRole(req, "security", ["admin"])

  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const phone = new URL(req.url).searchParams.get("phone")
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 })
  const digits = phone.replace(/\D/g, "").slice(-10)
  await query(`DELETE FROM dnd_suppression WHERE phone = $1`, [digits])
  logAudit("dnd suppression number removed", session.email, { phone: digits })
  return NextResponse.json({ ok: true })
}
