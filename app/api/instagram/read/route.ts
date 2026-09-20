import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "instagram", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { ig_user_id } = await req.json()
  if (!ig_user_id) return NextResponse.json({ error: "ig_user_id required" }, { status: 400 })

  try {
    await query(
      `UPDATE instagram_messages SET status = 'read' WHERE ig_user_id = $1 AND direction = 'inbound'`,
      [ig_user_id]
    )
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return apiError(e)
  }
}
