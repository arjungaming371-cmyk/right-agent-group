import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// "Boost to front" (Outpero's hot-lead handling): bump selected PENDING rows
// to priority 100 so the atomic claim (ORDER BY priority DESC) dials them
// ahead of the bulk backlog — the same priority class the calendar agent and
// speed-to-lead use for must-call-now rows. "Clear boost" returns them to 0.
//
//   POST /api/outbound/queue/prioritize  { ids: string[], boost: boolean }
//   → { ok, boosted }
//
// Pending rows only: a row already dialing/called has nothing left to
// prioritize, and re-prioritizing terminal rows would silently rewrite
// history.

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map((x: unknown) => String(x)).filter(Boolean) : []
  if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 })
  if (!ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return NextResponse.json({ error: "invalid ids" }, { status: 400 })
  }
  const boost = body?.boost !== false // default = boost
  const priority = boost ? 100 : 0

  const params: unknown[] = [ids, priority]
  let branchWhere = ""
  if (branchId) {
    params.push(branchId)
    branchWhere = `AND branch_id = $${params.length}`
  }

  const res = await query(
    `UPDATE outbound_queue SET priority = $2
      WHERE id = ANY($1::uuid[]) AND status = 'pending' ${branchWhere}`,
    params
  )
  const boosted = res.rowCount || 0
  logAudit(boost ? "outbound queue rows boosted" : "outbound queue boost cleared", session.email, {
    requested: ids.length, boosted, priority,
  })
  return NextResponse.json({ ok: true, boosted })
}
