import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "instagram", [
    "admin",
    "agent",
    "viewer",
    "branch_manager",
    "developer",
  ])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const branchId = searchParams.get("branch_id") || sessionBranchId(session)

  const sql = branchId
    ? `SELECT * FROM instagram_templates WHERE branch_id IS NULL OR branch_id = $1 ORDER BY (branch_id IS NOT NULL) DESC, created_at ASC`
    : `SELECT * FROM instagram_templates WHERE branch_id IS NULL ORDER BY created_at ASC`

  const params = branchId ? [branchId] : []
  const res = await query(sql, params)
  return NextResponse.json({ ok: true, templates: res.rows })
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "instagram", [
    "admin",
    "agent",
    "branch_manager",
    "developer",
  ])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { id, label, text, category } = body

  if (!label || typeof label !== "string" || !label.trim()) {
    return NextResponse.json({ error: "Label / Title is required" }, { status: 400 })
  }
  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Template message text is required" }, { status: 400 })
  }

  const cleanLabel = label.trim()
  const cleanText = text.trim()
  const cleanCategory = (category && typeof category === "string" ? category.trim() : "General") || "General"

  if (id) {
    const updateRes = await query(
      `UPDATE instagram_templates 
       SET label = $1, text = $2, category = $3, updated_at = NOW() 
       WHERE id = $4 
       RETURNING *`,
      [cleanLabel, cleanText, cleanCategory, id]
    )
    if (updateRes.rowCount === 0) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }
    return NextResponse.json({ ok: true, template: updateRes.rows[0] })
  }

  const branchId = body.branch_id || sessionBranchId(session)
  const insertRes = await query(
    `INSERT INTO instagram_templates (label, text, category, branch_id, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [cleanLabel, cleanText, cleanCategory, branchId || null, session.email || "system"]
  )

  return NextResponse.json({ ok: true, template: insertRes.rows[0] })
}

export async function DELETE(req: NextRequest) {
  const session = await requireModuleOrRole(req, "instagram", [
    "admin",
    "agent",
    "branch_manager",
    "developer",
  ])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 })

  await query(`DELETE FROM instagram_templates WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
