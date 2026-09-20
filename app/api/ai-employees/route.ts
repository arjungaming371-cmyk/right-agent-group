import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

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
    const employees = (await query(`SELECT * FROM ai_employees ORDER BY created_at`)).rows
    const assignments = (await query(`SELECT branch_id, employee_id, is_primary FROM branch_ai_employees`)).rows
    const branches = (await query(`SELECT id, name, code FROM branches ORDER BY name`)).rows
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
    return NextResponse.json(res.rows[0], { status: 201 })
  } catch (e: any) {
    return apiError(e)
  }
}
