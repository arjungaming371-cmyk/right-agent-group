import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "upload", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const branchId = sessionBranchId(session)
  let q = db.from("uploaded_files").select("*")
  if (branchId) q = q.eq("branch_id", branchId)

  const { data } = await q.order("created_at", { ascending: false }).limit(50)
  return NextResponse.json(data ?? [])
}
