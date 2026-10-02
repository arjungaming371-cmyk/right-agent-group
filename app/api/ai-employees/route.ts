import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// AI Employees — Priya & co.
//
// GET  /api/ai-employees   → all employees (+ branch assignment summary)
// POST /api/ai-employees   → create one
//
// scope 'shared'    = serves EVERY branch (the shared bench)
// scope 'dedicated' = serves only branches listed in branch_ai_employees
//
// voice_speaker: Sarvam speaker name (e.g. "priya", "shubh") when
// voice_provider=sarvam, or a Cartesia voice ID when voice_provider=cartesia.

const VOICE_PROVIDERS = ["sarvam", "cartesia"]

export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "branch_manager", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    // BRANCH SCOPE: a branch_manager runs ONE branch — they may see the
    // shared bench plus employees dedicated to their branch, and only their
    // own branch's assignments. Org-wide structure stays admin/developer.
    const ownBranchId = sessionBranchId(session)
    const employees = ownBranchId
      ? (
          await query(
            `SELECT e.* FROM ai_employees e
             WHERE e.scope = 'shared'
                OR EXISTS (SELECT 1 FROM branch_ai_employees bae
                           WHERE bae.employee_id = e.id AND bae.branch_id = $1)
             ORDER BY e.created_at`,
            [ownBranchId]
          )
        ).rows
      : (await query(`SELECT * FROM ai_employees ORDER BY created_at`)).rows
    const assignments = ownBranchId
      ? (
          await query(`SELECT branch_id, employee_id, is_primary FROM branch_ai_employees WHERE branch_id = $1`, [
            ownBranchId,
          ])
        ).rows
      : (await query(`SELECT branch_id, employee_id, is_primary FROM branch_ai_employees`)).rows
    const branches = ownBranchId
      ? (await query(`SELECT id, name, code FROM branches WHERE id = $1 ORDER BY name`, [ownBranchId])).rows
      : (await query(`SELECT id, name, code FROM branches ORDER BY name`)).rows
    return NextResponse.json({ employees, assignments, branches })
  } catch (e: any) {
    return apiError(e)
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const body = await req.json()
    const name = String(body?.name || "").trim()
    if (!name || name.length > 60) return NextResponse.json({ error: "name required (max 60 chars)" }, { status: 400 })
    const voiceProvider = VOICE_PROVIDERS.includes(body?.voice_provider) ? body.voice_provider : "sarvam"
    const scope = body?.scope === "shared" ? "shared" : "dedicated"
    const languages = Array.isArray(body?.languages) && body.languages.length
      ? body.languages.filter((l: string) => ["english", "hindi", "telugu"].includes(l))
      : ["english", "hindi", "telugu"]

    const res = await query(
      `INSERT INTO ai_employees (name, description, voice_provider, voice_speaker, languages, scope)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        name,
        body?.description ? String(body.description).slice(0, 300) : null,
        voiceProvider,
        body?.voice_speaker ? String(body.voice_speaker).slice(0, 100) : null,
        languages,
        scope,
      ]
    )
    const created = res.rows[0]
    logAudit("ai employee created", session.email, { id: created?.id, name, scope })
    return NextResponse.json(created, { status: 201 })
  } catch (e: any) {
    return apiError(e)
  }
}
