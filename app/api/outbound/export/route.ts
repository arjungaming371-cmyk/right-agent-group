import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { toCsv } from "@/lib/csv"
import { withRoute } from "@/lib/api-route"

export const dynamic = "force-dynamic"

// Campaign results export (Feature 5 of the bulk plan): the full queue
// history with call metadata — channel, priority, retry count, scheduling,
// outcome timestamps. Same read-only posture as the leads export: exporting
// data you can already see isn't a new privilege. Branch-scoped sessions
// export ONLY their branch's queue.

const COLUMNS = [
  "name", "phone", "language", "channel", "priority", "status", "retry_count",
  "scheduled_at", "called_at", "cancelled_at", "cancelled_by", "call_sid",
  "product_interest", "created_at",
]

export const GET = withRoute("outbound/export", async (req: NextRequest) => {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager", "viewer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const res = branchId
    ? await query(`SELECT ${COLUMNS.join(", ")} FROM outbound_queue WHERE branch_id = $1 ORDER BY created_at DESC`, [branchId])
    : await query(`SELECT ${COLUMNS.join(", ")} FROM outbound_queue ORDER BY created_at DESC`)
  const csv = toCsv(res.rows, COLUMNS)
  const filename = `outbound-queue-${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
})
