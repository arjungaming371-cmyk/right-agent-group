import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"
import { isValidUUID } from "@/lib/lead-brain"

// Toggle (or explicitly set) a lead's pinned state — used by both the Leads
// view and the WhatsApp Chat view (same leads.pinned column powers both,
// since a WhatsApp conversation IS a lead under the hood).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isValidUUID(id)) return NextResponse.json({ error: "invalid lead id" }, { status: 400 })

  const branchId = sessionBranchId(session)
  const body = await req.json().catch(() => ({}) as any)
  const explicit = typeof body?.pinned === "boolean" ? body.pinned : null

  const sql = branchId
    ? `UPDATE leads
       SET pinned = CASE WHEN $3::boolean IS NOT NULL THEN $3::boolean ELSE NOT pinned END,
           pinned_at = CASE WHEN (CASE WHEN $3::boolean IS NOT NULL THEN $3::boolean ELSE NOT pinned END) THEN now() ELSE NULL END
       WHERE id = $1 AND branch_id = $2
       RETURNING id, pinned, pinned_at`
    : `UPDATE leads
       SET pinned = CASE WHEN $2::boolean IS NOT NULL THEN $2::boolean ELSE NOT pinned END,
           pinned_at = CASE WHEN (CASE WHEN $2::boolean IS NOT NULL THEN $2::boolean ELSE NOT pinned END) THEN now() ELSE NULL END
       WHERE id = $1
       RETURNING id, pinned, pinned_at`

  const updated = await query(sql, branchId ? [id, branchId, explicit] : [id, explicit])
  if (updated.rows.length === 0) return NextResponse.json({ error: "lead not found" }, { status: 404 })

  const nextPinned = updated.rows[0].pinned
  logAudit(nextPinned ? "lead pinned" : "lead unpinned", session.email, { leadId: id })

  return NextResponse.json(updated.rows[0])
}
