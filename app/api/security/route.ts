import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

// FIXED: table is audit_logs (plural) with columns action/performed_by/metadata
// — the old code queried a non-existent audit_log table, so the audit trail
// never recorded or displayed anything.

export async function GET() {
  const { data: settings } = await db.from("security_settings").select("key, enabled")
  const { data: logs } = await db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(20)
  return NextResponse.json({ settings: settings ?? [], logs: logs ?? [] })
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  const { key, enabled } = await req.json()
  if (key === "_action") return NextResponse.json({ ok: true })
  if (typeof key !== "string" || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "key (string) and enabled (boolean) required" }, { status: 400 })
  }
  await db.from("security_settings").update({ enabled, updated_at: new Date().toISOString() }).eq("key", key)
  await db
    .from("audit_logs")
    .insert({
      action: `${key} ${enabled ? "enabled" : "disabled"}`,
      performed_by: session?.email || "dashboard",
      metadata: { source: "dashboard" },
    })
    .catch(() => {})
  return NextResponse.json({ ok: true })
}
