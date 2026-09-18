import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db, query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "comms", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // Branch scope: comm logs joined against branch-owned leads only.
  const branchId = sessionBranchId(session)
  if (branchId) {
    const res = await query(
      `SELECT c.*, l.name AS lead_name
         FROM comm_logs c LEFT JOIN leads l ON l.id = c.lead_id
        WHERE l.branch_id = $1
        ORDER BY c.created_at DESC
        LIMIT 200`,
      [branchId]
    )
    // Shape matches the Supabase-style select("*, leads(name)") rows below.
    return NextResponse.json(res.rows.map((r: any) => ({ ...r, leads: r.lead_name ? { name: r.lead_name } : null })))
  }
  const { data, error } = await db
    .from("comm_logs")
    .select("*, leads(name)")
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) return apiError(error)
  return NextResponse.json(data ?? [])
}
