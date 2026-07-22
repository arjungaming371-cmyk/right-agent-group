import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { isValidUUID } from "@/lib/lead-brain"

// Toggle (or explicitly set) a lead's pinned state — used by both the Leads
// view and the WhatsApp Chat view (same leads.pinned column powers both,
// since a WhatsApp conversation IS a lead under the hood).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(req, ["admin", "agent"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isValidUUID(id)) return NextResponse.json({ error: "invalid lead id" }, { status: 400 })

  const body = await req.json().catch(() => ({}) as any)
  const current = await query(`SELECT pinned FROM leads WHERE id = $1`, [id])
  if (current.rows.length === 0) return NextResponse.json({ error: "lead not found" }, { status: 404 })

  const nextPinned = typeof body?.pinned === "boolean" ? body.pinned : !current.rows[0].pinned

  const updated = await query(
    `UPDATE leads SET pinned = $1, pinned_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2
     RETURNING id, pinned, pinned_at`,
    [nextPinned, id]
  )

  logAudit(nextPinned ? "lead pinned" : "lead unpinned", session.email, { leadId: id })

  return NextResponse.json(updated.rows[0])
}
