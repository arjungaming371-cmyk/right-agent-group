import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { invalidateComplianceCache } from "@/lib/compliance"

export const dynamic = "force-dynamic"

const VALID_DAYS = new Set(["sun", "mon", "tue", "wed", "thu", "fri", "sat"])

// GET — current calling-window settings + DND list size. Admin-only, same
// gating as /api/security (this is part of the same Security view).
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const [settingsRes, dndCountRes] = await Promise.all([
    query(`SELECT key, value FROM compliance_settings`),
    query(`SELECT COUNT(*)::int AS n FROM dnd_suppression`),
  ])
  const settings: Record<string, string> = {}
  for (const row of settingsRes.rows) settings[row.key] = row.value

  return NextResponse.json({
    settings: {
      enabled: settings.calling_window_enabled !== "false",
      startHour: parseInt(settings.calling_window_start_hour ?? "8", 10),
      endHour: parseInt(settings.calling_window_end_hour ?? "19", 10),
      days: (settings.calling_window_days ?? "mon,tue,wed,thu,fri,sat").split(","),
    },
    dndCount: dndCountRes.rows[0]?.n ?? 0,
  })
}

// PATCH — update calling-window settings. Admin-only, audited.
export async function PATCH(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const updates: [string, string][] = []

  if (typeof body.enabled === "boolean") {
    updates.push(["calling_window_enabled", body.enabled ? "true" : "false"])
  }
  if (Number.isInteger(body.startHour) && body.startHour >= 0 && body.startHour <= 23) {
    updates.push(["calling_window_start_hour", String(body.startHour)])
  }
  if (Number.isInteger(body.endHour) && body.endHour >= 0 && body.endHour <= 23) {
    updates.push(["calling_window_end_hour", String(body.endHour)])
  }
  if (Array.isArray(body.days)) {
    const clean = body.days.filter((d: any) => VALID_DAYS.has(String(d).toLowerCase()))
    if (clean.length > 0) updates.push(["calling_window_days", clean.join(",")])
  }
  if (updates.length === 0) return NextResponse.json({ error: "no valid fields to update" }, { status: 400 })

  for (const [key, value] of updates) {
    await query(
      `INSERT INTO compliance_settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3`,
      [key, value, session.email]
    )
  }
  invalidateComplianceCache()
  logAudit("compliance calling-window updated", session.email, { updates: Object.fromEntries(updates) })
  return NextResponse.json({ ok: true })
}
