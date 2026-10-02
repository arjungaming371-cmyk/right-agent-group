import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole, type Role } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// HUMAN ATTENTION QUEUE — the dashboard's "Needs Human" view.
//
// The calling/chat stacks already write escalation rows (lib/frustration.ts):
//   comm_logs.type='alert', outcome='needs_human', summary quoting what the
//   customer actually said ("manager tho matladu…", "talk to a human").
// This API surfaces that queue with lead context, branch-scoped, and lets a
// human resolve items once handled.
//
//   GET            → recent escalations (30 days, max 50) + lead info
//   POST {logId}   → mark one resolved (outcome → 'needs_human_resolved')
//
// Branch scope: comm_logs has no branch column — scope via the lead's branch.

const ROLE_LIST: Role[] = ["admin", "agent", "branch_manager"]

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ROLE_LIST)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  try {
    const res = await query(
      `SELECT c.id, c.lead_id, c.summary, c.created_at,
              l.name AS lead_name, l.phone AS lead_phone, l.whatsapp_number AS lead_whatsapp, l.status AS lead_status
         FROM comm_logs c
         LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.type = 'alert' AND c.outcome = 'needs_human'
          AND c.created_at > now() - interval '30 days'
          AND ($1::uuid IS NULL OR l.branch_id = $1::uuid)
        ORDER BY c.created_at DESC
        LIMIT 50`,
      [branchId]
    )
    return NextResponse.json({ items: res.rows })
  } catch (e: any) {
    console.error("escalations GET failed:", e?.message)
    return NextResponse.json({ error: "Could not load escalations. Please try again." }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ROLE_LIST)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const body = (await req.json().catch(() => ({}))) as { logId?: string; action?: string }
  const logId = String(body.logId || "").trim()
  if (!logId || !/^\d+$/.test(logId)) {
    return NextResponse.json({ error: "logId required" }, { status: 400 })
  }

  try {
    // Ownership: the alert must belong to a lead inside the caller's branch.
    const owner = await query(
      `SELECT l.branch_id FROM comm_logs c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.id = $1 AND c.type = 'alert' LIMIT 1`,
      [logId]
    )
    const row = owner.rows[0]
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 })
    if (branchId && row.branch_id && row.branch_id !== branchId) {
      return NextResponse.json({ error: "not found" }, { status: 404 })
    }

    const res = await query(
      `UPDATE comm_logs SET outcome = 'needs_human_resolved'
        WHERE id = $1 AND outcome = 'needs_human'`,
      [logId]
    )
    if ((res.rowCount ?? 0) === 0) return NextResponse.json({ error: "already resolved" }, { status: 409 })

    logAudit("escalation resolved", session.email, { logId })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("escalations POST failed:", e?.message)
    return NextResponse.json({ error: "Could not resolve the escalation. Please try again." }, { status: 500 })
  }
}
