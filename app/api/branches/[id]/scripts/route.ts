import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { getBranch, resolveBranchScript, invalidateBranchCache } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// Per-branch script customization.
//
// GET  /api/branches/[id]/scripts                → branch overrides + resolved values
// PUT  /api/branches/[id]/scripts                → upsert one override
//      body: { language, content, employeeId? }  (content "" deletes the override)
// DELETE ?language=&employeeId=                  → remove an override
//
// The same AI Employee can therefore run DIFFERENT scripts per branch:
// resolution order at call time is
//   branch+employee override → branch-wide override → org-level ai_scripts.
//
// branch_manager may edit THEIR branch only; admin/developer any branch.

const LANGUAGES = ["english", "hindi", "telugu"]

type Ctx = { params: Promise<{ id: string }> }

async function guard(req: NextRequest, ctx: Ctx, manage = false) {
  const session = await requireRole(req, ["admin", "branch_manager", "developer"])
  if (!session) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const { id } = await ctx.params
  if (session.branchId && session.branchId !== id) {
    return { error: NextResponse.json({ error: "forbidden — not your branch" }, { status: 403 }) }
  }
  const branch = await getBranch(id)
  if (!branch) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) }
  if (manage && session.role === "branch_manager" && session.branchId !== id) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  }
  return { session, branch }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await guard(req, ctx)
  if (g.error) return g.error
  const { branch } = g
  try {
    const { id } = await ctx.params
    const overrides = (await query(
      `SELECT bs.id, bs.language, bs.content, bs.employee_id, bs.updated_at, bs.updated_by, e.name AS employee_name
         FROM branch_scripts bs LEFT JOIN ai_employees e ON e.id = bs.employee_id
        WHERE bs.branch_id = $1 ORDER BY bs.language, e.name NULLS FIRST`,
      [id]
    )).rows
    // Resolved previews show what Priya will ACTUALLY say in each language —
    // override when present, org default when not.
    const resolved: Record<string, string | null> = {}
    for (const lang of LANGUAGES) {
      resolved[lang] = await resolveBranchScript(id, null, lang)
    }
    return NextResponse.json({ branch: { id: branch!.id, name: branch!.name, code: branch!.code }, overrides, resolved })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const g = await guard(req, ctx, true)
  if (g.error) return g.error
  const { session, branch } = g
  try {
    const { id } = await ctx.params
    const body = await req.json()
    const language = String(body?.language || "")
    if (!LANGUAGES.includes(language)) return NextResponse.json({ error: `language must be one of ${LANGUAGES.join(", ")}` }, { status: 400 })
    const content = typeof body?.content === "string" ? body.content.trim() : ""
    if (content.length > 20000) return NextResponse.json({ error: "script too long (max 20,000 chars)" }, { status: 400 })
    const employeeId = body?.employeeId ? String(body.employeeId) : null
    if (employeeId) {
      const known = await query(`SELECT 1 FROM ai_employees WHERE id = $1`, [employeeId])
      if (!known.rowCount) return NextResponse.json({ error: "unknown employeeId" }, { status: 400 })
    }

    if (!content) {
      // Empty content = delete the override → org default applies again.
      await query(
        `DELETE FROM branch_scripts WHERE branch_id = $1 AND language = $2 AND employee_id IS NOT DISTINCT FROM $3`,
        [id, language, employeeId]
      )
      logAudit("branch script override removed", session!.email, { branch: branch!.code, language, employeeId })
      return NextResponse.json({ ok: true, deleted: true })
    }

    await query(
      `INSERT INTO branch_scripts (branch_id, employee_id, language, content, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (branch_id, COALESCE(employee_id, '00000000-0000-0000-0000-000000000000'::uuid), language)
       DO UPDATE SET content = EXCLUDED.content, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [id, employeeId, language, content, session!.email]
    )
    logAudit("branch script override saved", session!.email, { branch: branch!.code, language, employeeId, chars: content.length })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
