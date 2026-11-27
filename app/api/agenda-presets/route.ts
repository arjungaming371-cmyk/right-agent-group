import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const branchId = searchParams.get("branch_id") || sessionBranchId(session)

  const sql = branchId
    ? `SELECT * FROM agenda_presets WHERE branch_id IS NULL OR branch_id = $1 ORDER BY (branch_id IS NOT NULL) DESC, created_at ASC`
    : `SELECT * FROM agenda_presets WHERE branch_id IS NULL ORDER BY created_at ASC`

  const params = branchId ? [branchId] : []
  const res = await query(sql, params)
  return NextResponse.json({ presets: res.rows })
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { label, text, product, language } = body
  if (!label || typeof label !== "string" || !label.trim()) {
    return NextResponse.json({ error: "Label is required" }, { status: 400 })
  }

  const branchId = body.branch_id || sessionBranchId(session)

  const res = await query(
    `INSERT INTO agenda_presets (label, text, product, language, branch_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [label.trim(), (text || "").trim(), product || null, language || null, branchId || null, session.email]
  )

  return NextResponse.json({ ok: true, preset: res.rows[0] })
}

export async function PATCH(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { id, label, text, product, language } = body
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 })
  if (!label || typeof label !== "string" || !label.trim()) {
    return NextResponse.json({ error: "Label is required" }, { status: 400 })
  }

  const res = await query(
    `UPDATE agenda_presets
        SET label = $2,
            text = $3,
            product = COALESCE($4, product),
            language = COALESCE($5, language),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, label.trim(), (text || "").trim(), product || null, language || null]
  )
  if ((res.rowCount ?? 0) === 0) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true, preset: res.rows[0] })
}

export async function DELETE(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 })

  await query(`DELETE FROM agenda_presets WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
