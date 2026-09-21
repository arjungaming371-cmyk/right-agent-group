import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { createSessionToken, getLiveSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth"
import { getBranch } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// POST /api/auth/branch  { branchId: string | null }
//
// Switches the PARENT ACCOUNT's active branch. Sessions are stateless signed
// cookies, so "switching" means re-issuing the session with a new branchId —
// null puts the admin back on the whole-company view.
//
// Only admin/developer may call this. Branch-scoped roles are PINNED to the
// branch on their allowed_emails row (their sessions never change here), so
// a branch manager cannot escalate into another branch by forging a request.

export async function POST(req: NextRequest) {
  // FIX (2026-09-20): live revalidation. This re-mints session cookies, so it
  // must check the DB (removed/demoted users must not be able to refresh an
  // admin-role cookie for up to 7 days) — was getSessionFromRequest.
  const session = await getLiveSession(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (session.role !== "admin" && session.role !== "developer") {
    return NextResponse.json({ error: "forbidden — only the parent account can switch branches" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const requested = body?.branchId
  if (requested !== null && requested !== undefined && requested !== "") {
    const branch = await getBranch(String(requested))
    if (!branch) return NextResponse.json({ error: "unknown branch" }, { status: 400 })
    // Switching INTO a suspended branch stays allowed — the parent account
    // manages the branch and its write paths are already blocked by the
    // quota gate (checkQuota), not by the session.
  }

  const branchId = requested ? String(requested) : null
  const token = await createSessionToken(session.email, session.role, { orgId: session.orgId ?? null, branchId })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ""
  const res = NextResponse.json({ ok: true, branchId })
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(appUrl.startsWith("https")))
  logAudit("branch scope switched", session.email, { branchId: branchId || "(all branches)" })
  return res
}
