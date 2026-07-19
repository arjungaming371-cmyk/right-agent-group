import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Developer logs are ONLY visible to the developer themselves, never to admins
export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    // Fetch developer activity logs
    const logsRes = await query(
      `SELECT id, action, created_at as timestamp, status
       FROM developer_logs
       WHERE email = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [session.email]
    )

    // Fetch last login
    const lastLoginRes = await query(
      `SELECT created_at FROM developer_logs
       WHERE email = $1 AND action LIKE 'Login%'
       ORDER BY created_at DESC
       LIMIT 1`,
      [session.email]
    )

    return NextResponse.json({
      logs: logsRes.rows || [],
      lastLogin: lastLoginRes.rows[0]?.created_at || null,
    })
  } catch (e) {
    console.error("Error fetching developer logs:", e)
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 })
  }
}
