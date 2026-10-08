import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { withRoute } from "@/lib/api-route"
import { scanVoiceCalls } from "@/lib/calendar-agent"

export const dynamic = "force-dynamic"

// POST /api/calendar/scan
// Body: { dryRun?: boolean, limit?: number }
export const POST = withRoute("calendar/scan", async (req: NextRequest) => {
  const session = await requireRole(req, ["admin", "branch_manager", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const body = await req.json().catch(() => ({}))
  const dryRun = body?.dryRun === true
  const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 200)

  if (branchId && body.branchId && body.branchId !== branchId) {
    return NextResponse.json({ error: "forbidden: cannot scan calls belonging to another branch" }, { status: 403 })
  }
  const effectiveBranchId = branchId || body.branchId || null

  const result = await scanVoiceCalls({
    limit,
    dryRun,
    branchId: effectiveBranchId,
  })

  return NextResponse.json({
    ok: true,
    dryRun,
    ...result,
  })
})
