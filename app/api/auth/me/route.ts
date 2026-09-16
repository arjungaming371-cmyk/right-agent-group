import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ email: null, role: null }, { status: 401 })
  return NextResponse.json({
    email: session.email,
    role: session.role,
    orgId: session.orgId ?? null,
    branchId: session.branchId ?? null,
    // The shell uses this to decide whether to show the branch switcher.
    canSwitchBranch: session.role === "admin" || session.role === "developer",
  })
}
