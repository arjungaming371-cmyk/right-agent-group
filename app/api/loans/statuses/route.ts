import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { withRoute, readJson } from "@/lib/api-route"

export const dynamic = "force-dynamic"

export const GET = withRoute("loans", async (req: NextRequest) => {
  const session = await requireModuleOrRole(req, "loans", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const res = await query(
      `SELECT id, label, color, bg_color, icon, category, is_default, sort_order
       FROM custom_loan_statuses
       ORDER BY sort_order ASC, created_at ASC`
    )
    return NextResponse.json({ statuses: res.rows })
  } catch (err: any) {
    return apiError(err)
  }
})

export const POST = withRoute("loans", async (req: NextRequest) => {
  const session = await requireModuleOrRole(req, "loans", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await readJson(req)) as Record<string, any> | null
  if (!body || !body.label) {
    return NextResponse.json({ error: "Status label is required" }, { status: 400 })
  }

  const rawLabel = String(body.label).trim()
  if (!rawLabel) {
    return NextResponse.json({ error: "Status label cannot be empty" }, { status: 400 })
  }

  // Derive slug ID from label
  let id = String(body.id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
  if (!id) {
    id = rawLabel
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 32)
  }

  const icon = String(body.icon || "📌").trim() || "📌"
  const color = String(body.color || "#8B5CF6").trim()
  const bgColor = String(body.bg_color || `${color}25`).trim()
  const category = ["pending", "sanctioned", "rejected", "disbursed"].includes(body.category)
    ? body.category
    : "pending"

  try {
    const res = await query(
      `INSERT INTO custom_loan_statuses (id, label, color, bg_color, icon, category, is_default, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, false, 15)
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label,
         color = EXCLUDED.color,
         bg_color = EXCLUDED.bg_color,
         icon = EXCLUDED.icon,
         category = EXCLUDED.category
       RETURNING *`,
      [id, rawLabel, color, bgColor, icon, category]
    )

    return NextResponse.json({ status: res.rows[0], success: true })
  } catch (err: any) {
    return apiError(err)
  }
})

export const DELETE = withRoute("loans", async (req: NextRequest) => {
  const session = await requireModuleOrRole(req, "loans", ["admin", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id parameter required" }, { status: 400 })

  try {
    // Prevent deletion of default system statuses
    const check = await query(`SELECT is_default FROM custom_loan_statuses WHERE id = $1`, [id])
    if (check.rows.length === 0) {
      return NextResponse.json({ error: "Status not found" }, { status: 404 })
    }
    if (check.rows[0].is_default) {
      return NextResponse.json({ error: "Default system statuses cannot be deleted" }, { status: 400 })
    }

    await query(`DELETE FROM custom_loan_statuses WHERE id = $1`, [id])
    return NextResponse.json({ success: true, deleted: id })
  } catch (err: any) {
    return apiError(err)
  }
})
