import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ email: null, role: null }, { status: 401 })

  let allowedModules: string[] | null = null
  let roleTitle: string = session.role
  try {
    const res = await query(`SELECT role, allowed_modules FROM allowed_emails WHERE lower(email) = $1 LIMIT 1`, [session.email.toLowerCase()])
    if (res.rows.length > 0) {
      if (res.rows[0].role) roleTitle = res.rows[0].role
      if (Array.isArray(res.rows[0].allowed_modules)) {
        allowedModules = res.rows[0].allowed_modules
      }
    }
  } catch {}

  return NextResponse.json({
    email: session.email,
    role: session.role,
    roleTitle,
    orgId: session.orgId ?? null,
    branchId: session.branchId ?? null,
    allowedModules,
    // The shell uses this to decide whether to show the branch switcher.
    canSwitchBranch: session.role === "admin" || session.role === "developer",
  })
}
