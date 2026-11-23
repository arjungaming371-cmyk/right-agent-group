import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getLiveSession } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// GET: List all available application links in the library
export async function GET(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const product = req.nextUrl.searchParams.get("product")
  const all = req.nextUrl.searchParams.get("all") === "true"
  const branchId = sessionBranchId(session)

  try {
    let sql = all ? `SELECT * FROM link_library WHERE 1=1` : `SELECT * FROM link_library WHERE active = true`
    const params: any[] = []

    if (branchId) {
      params.push(branchId)
      sql += ` AND (branch_id IS NULL OR branch_id = $${params.length})`
    }

    if (product) {
      params.push(product)
      sql += ` AND lower(product) = lower($${params.length})`
    }

    sql += ` ORDER BY created_at DESC, product ASC`

    const res = await query(sql, params)
    return NextResponse.json(res.rows)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST: Add new application link to library
export async function POST(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session || (session.role !== "admin" && session.role !== "developer" && session.role !== "branch_manager")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { bank, product, url, active } = await req.json()
    if (!product || !url) {
      return NextResponse.json({ error: "Loan Type (product) and Application Link (url) are required" }, { status: 400 })
    }

    const branchId = sessionBranchId(session)
    const effectiveBank = (bank || "Right Agent Group").trim()
    const isActive = active !== undefined ? Boolean(active) : true

    const res = await query(
      `INSERT INTO link_library (bank, product, url, active, branch_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [effectiveBank, product.trim(), url.trim(), isActive, branchId]
    )

    return NextResponse.json(res.rows[0])
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH: Update existing application link (changeable)
export async function PATCH(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session || (session.role !== "admin" && session.role !== "developer" && session.role !== "branch_manager")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id, bank, product, url, active } = await req.json()
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const updates: string[] = []
    const params: any[] = [id]

    if (bank !== undefined) {
      params.push(bank.trim())
      updates.push(`bank = $${params.length}`)
    }
    if (product !== undefined) {
      params.push(product.trim())
      updates.push(`product = $${params.length}`)
    }
    if (url !== undefined) {
      params.push(url.trim())
      updates.push(`url = $${params.length}`)
    }
    if (active !== undefined) {
      params.push(Boolean(active))
      updates.push(`active = $${params.length}`)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 })
    }

    const res = await query(
      `UPDATE link_library
       SET ${updates.join(", ")}
       WHERE id = $1
       RETURNING *`,
      params
    )

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 })
    }

    return NextResponse.json(res.rows[0])
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE: Remove application link (deletable)
export async function DELETE(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session || (session.role !== "admin" && session.role !== "developer" && session.role !== "branch_manager")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  try {
    await query(`DELETE FROM link_library WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
