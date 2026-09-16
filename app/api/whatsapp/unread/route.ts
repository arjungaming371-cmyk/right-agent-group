import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)
  let q = db.from("whatsapp_messages").select("*", { count: "exact", head: true }).eq("direction", "inbound").eq("status", "received")
  if (branchId) q = q.eq("branch_id", branchId)
  const { count } = await q
  return NextResponse.json({ count: count ?? 0 })
}
