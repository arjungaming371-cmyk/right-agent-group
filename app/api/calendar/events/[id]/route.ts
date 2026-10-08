import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { withParams } from "@/lib/api-route"
import { updateCalendarEvent } from "@/lib/calendar-agent"

export const dynamic = "force-dynamic"

// PATCH /api/calendar/events/[id]
export const PATCH = withParams("calendar/events/[id]", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const session = await requireRole(req, ["admin", "agent", "branch_manager", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const { id } = await params
  if (!id) return NextResponse.json({ error: "event id required" }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const { action, status, eventAt, location, notes, reminderEnabled } = body

  let targetStatus = status
  if (action === "confirm") targetStatus = "confirmed"
  else if (action === "reject" || action === "cancel") targetStatus = "cancelled"
  else if (action === "complete") targetStatus = "completed"
  else if (action === "reschedule") targetStatus = "rescheduled"

  const result = await updateCalendarEvent(
    id,
    {
      status: targetStatus,
      eventAt,
      location,
      notes,
      reminderEnabled,
    },
    session.email,
    branchId
  )

  if (!result.success) {
    if (result.error === "forbidden_branch") {
      return NextResponse.json({ error: "forbidden: cannot modify events belonging to another branch" }, { status: 403 })
    }
    return NextResponse.json({ error: "event not found or update failed" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, event: result.event })
})
