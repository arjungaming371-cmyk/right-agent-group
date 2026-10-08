import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { withRoute, queryString } from "@/lib/api-route"
import { persistCalendarEvent, DiscoveredEvent } from "@/lib/calendar-agent"

export const dynamic = "force-dynamic"

// GET /api/calendar/events?from=...&to=...&status=...&type=...
export const GET = withRoute("calendar/events", async (req: NextRequest) => {
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const from = queryString(req, "from", 35)
  const to = queryString(req, "to", 35)
  const statusFilter = queryString(req, "status", 25)
  const typeFilter = queryString(req, "type", 25)

  let sql = `
    SELECT e.*, l.name as lead_name, l.phone as lead_phone, l.product_interest,
           q.status as queue_status, q.call_sid as queue_call_sid
    FROM calendar_events e
    LEFT JOIN leads l ON e.lead_id = l.id
    LEFT JOIN outbound_queue q ON e.outbound_queue_id = q.id
    WHERE ($1::uuid IS NULL OR e.branch_id = $1)
  `
  const params: any[] = [branchId]
  let pIdx = 2

  if (from) {
    sql += ` AND e.event_at >= $${pIdx}`
    params.push(from)
    pIdx++
  }
  if (to) {
    sql += ` AND e.event_at <= $${pIdx}`
    params.push(to)
    pIdx++
  }
  if (statusFilter && statusFilter !== "all") {
    sql += ` AND e.status = $${pIdx}`
    params.push(statusFilter)
    pIdx++
  }
  if (typeFilter && typeFilter !== "all") {
    sql += ` AND e.event_type = $${pIdx}`
    params.push(typeFilter)
    pIdx++
  }

  sql += ` ORDER BY e.event_at ASC LIMIT 500`

  const res = await query(sql, params)
  return NextResponse.json({ events: res.rows })
})

// POST /api/calendar/events (Manual creation from UI)
export const POST = withRoute("calendar/events/create", async (req: NextRequest) => {
  const session = await requireRole(req, ["admin", "agent", "branch_manager", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  const body = await req.json().catch(() => ({}))
  if (!body.title || !body.eventAt || !body.eventType) {
    return NextResponse.json({ error: "title, eventAt, and eventType are required" }, { status: 400 })
  }

  if (branchId && body.branchId && body.branchId !== branchId) {
    return NextResponse.json({ error: "forbidden: cannot schedule events for another branch" }, { status: 403 })
  }
  const effectiveBranchId = branchId || body.branchId || null

  const discovered: DiscoveredEvent = {
    title: String(body.title).slice(0, 150),
    eventType: body.eventType,
    eventAt: new Date(body.eventAt).toISOString(),
    endAt: body.endAt ? new Date(body.endAt).toISOString() : new Date(new Date(body.eventAt).getTime() + 30 * 60000).toISOString(),
    location: body.location || null,
    channel: body.channel || "phone",
    confidence: "high",
    confidenceScore: 1.0,
    status: "confirmed",
    rawQuote: body.rawQuote || "Manually scheduled by agent",
    notes: body.notes || null,
    sourceType: "manual",
    sourceId: `manual-${Date.now()}`,
    sourceAt: new Date().toISOString(),
    leadId: body.leadId || null,
    leadName: body.leadName || null,
    leadPhone: body.leadPhone || null,
    branchId: effectiveBranchId,
  }

  const res = await persistCalendarEvent(discovered, { dryRun: false, autoSyncQueue: true })
  return NextResponse.json({ ok: true, result: res })
})
