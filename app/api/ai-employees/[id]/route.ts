import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import pool, { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

// PATCH  /api/ai-employees/[id]  → update fields + branch assignments
//        body: { name?, description?, voice_provider?, voice_speaker?, languages?,
//                scope?, is_active?, branchIds?: string[] }
//        branchIds REPLACES the assignment list (dedicated employees only;
//        shared employees ignore it).
// DELETE /api/ai-employees/[id]  → deactivate (soft) — history stays readable

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await requireRole(req, ["admin", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const { id } = await ctx.params
    const body = await req.json()
    const sets: string[] = []
    const params: any[] = []
    const push = (col: string, value: any) => {
      params.push(value)
      sets.push(`${col} = $${params.length}`)
    }
    if (typeof body?.name === "string" && body.name.trim()) push("name", body.name.trim().slice(0, 60))
    if ("description" in (body || {})) push("description", body.description ? String(body.description).slice(0, 300) : null)
    if (body?.voice_provider === "sarvam" || body?.voice_provider === "cartesia") push("voice_provider", body.voice_provider)
    if ("voice_speaker" in (body || {})) push("voice_speaker", body.voice_speaker ? String(body.voice_speaker).slice(0, 100) : null)
    if (Array.isArray(body?.languages) && body.languages.length) {
      push("languages", body.languages.filter((l: string) => ["english", "hindi", "telugu"].includes(l)))
    }
    if (body?.scope === "shared" || body?.scope === "dedicated") push("scope", body.scope)
    if (typeof body?.is_active === "boolean") push("is_active", body.is_active)

    if (sets.length) {
      params.push(id)
      await query(`UPDATE ai_employees SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`, params)
    }

    // Replace branch assignments when provided.
    // FIX (2026-09-20): the delete + per-row inserts ran WITHOUT a transaction
    // — a mid-loop failure (one bad UUID / FK error) committed the delete and
    // left the employee with ZERO or partial assignments (calls then fall back
    // to the default voice/script). One atomic statement + transaction.
    if (Array.isArray(body?.branchIds)) {
      const validBranchIds = body.branchIds.filter((b: any) => typeof b === "string" && b).slice(0, 100)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await client.query(`DELETE FROM branch_ai_employees WHERE employee_id = $1`, [id])
        if (validBranchIds.length > 0) {
          await client.query(
            `INSERT INTO branch_ai_employees (branch_id, employee_id)
             SELECT b, $2 FROM unnest($1::uuid[]) AS b
             ON CONFLICT DO NOTHING`,
            [validBranchIds, id]
          )
        }
        await client.query("COMMIT")
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {})
        throw e
      } finally {
        client.release()
      }
    }

    const employee = (await query(`SELECT * FROM ai_employees WHERE id = $1`, [id])).rows[0]
    if (!employee) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json(employee)
  } catch (e: any) {
    return apiError(e)
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await requireRole(req, ["admin", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const { id } = await ctx.params
    // Soft-delete: branch_scripts reference employees; deactivating keeps the
    // override rows meaningful and the audit trail intact.
    await query(`UPDATE ai_employees SET is_active = false, updated_at = now() WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return apiError(e)
  }
}
