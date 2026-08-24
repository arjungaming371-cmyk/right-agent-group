import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { isMailConfigured } from "@/lib/mail"

export const dynamic = "force-dynamic"

// FIXED: table is audit_logs (plural) with columns action/performed_by/metadata
// — the old code queried a non-existent audit_log table, so the audit trail
// never recorded or displayed anything.

export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: settings } = await db.from("security_settings").select("key, enabled")
  const { data: logs } = await db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(20)

  // The full-access role's own actions are hidden from OTHER people viewing
  // this page — not from that account's own view of its own history. Without
  // the session.role check below, an account holding this role would find
  // its entire audit trail wiped from its own Security page too.
  let filteredLogs = logs ?? []
  if (session.role !== "developer") {
    const devRows = await query(`SELECT lower(email) AS email FROM allowed_emails WHERE role = 'developer'`)
    const devEmails = new Set(devRows.rows.map((r: any) => r.email))
    filteredLogs = filteredLogs.filter((l: any) => !devEmails.has(String(l.performed_by || "").toLowerCase()))
  }

  return NextResponse.json({ settings: settings ?? [], logs: filteredLogs })
}

export async function PATCH(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { key, enabled } = await req.json()
  if (typeof key !== "string" || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "key (string) and enabled (boolean) required" }, { status: 400 })
  }

  // Turning 2FA on without SMTP configured would lock the admin out at their
  // next login — the OTP email would have nowhere to send from. Block it
  // here rather than let it fail silently at sign-in time.
  if (key === "two_factor_auth" && enabled && !isMailConfigured()) {
    return NextResponse.json(
      { error: "Set SMTP_HOST / SMTP_USER / SMTP_PASS in .env before enabling Two-Factor Authentication — otherwise the login OTP email can't send." },
      { status: 400 }
    )
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
