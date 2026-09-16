import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    // Ensure table exists
    await query(`
      CREATE TABLE IF NOT EXISTS developer_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'info',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    // Query developer_logs
    const { rows: devLogs } = await query(
      `SELECT id, action, created_at AS timestamp, status FROM developer_logs ORDER BY created_at DESC LIMIT 100`
    )

    // Also get last login from audit_logs
    let lastLogin: string | null = null
    try {
      const { rows: loginRows } = await query(
        `SELECT created_at FROM audit_logs WHERE performed_by = $1 AND action ILIKE '%login%' OR action ILIKE '%2FA%' ORDER BY created_at DESC LIMIT 1`,
        [session.email]
      )
      if (loginRows.length > 0) {
        lastLogin = loginRows[0].created_at
      }
    } catch {
      // audit_logs query error ignored
    }

    // If developer_logs is empty, populate with system activity from audit_logs as fallback
    let finalLogs = devLogs.map((r: any) => ({
      id: r.id,
      action: r.action,
      timestamp: r.timestamp,
      status: r.status || "info",
    }))

    if (finalLogs.length === 0) {
      try {
        const { rows: auditRows } = await query(
          `SELECT id, action, created_at AS timestamp FROM audit_logs ORDER BY created_at DESC LIMIT 50`
        )
        finalLogs = auditRows.map((r: any) => ({
          id: String(r.id),
          action: r.action,
          timestamp: r.timestamp,
          status: "info" as const,
        }))
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      logs: finalLogs,
      lastLogin: lastLogin || new Date().toISOString(),
    })
  } catch (err: any) {
    console.error("Developer logs error:", err)
    return NextResponse.json({ logs: [], lastLogin: null, error: err.message }, { status: 500 })
  }
}
