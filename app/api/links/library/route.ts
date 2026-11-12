import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { getLiveSession } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// GET: List all available bank links in the library
export async function GET(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const product = req.nextUrl.searchParams.get("product")
  const branchId = sessionBranchId(session)

  try {
    let sql = `SELECT * FROM link_library WHERE active = true`
    const params: any[] = []

    if (branchId) {
      params.push(branchId)
      sql += ` AND (branch_id IS NULL OR branch_id = $${params.length})`
    }

    if (product) {
      params.push(product)
      sql += ` AND lower(product) = lower($${params.length})`
    }

    sql += ` ORDER BY bank ASC, product ASC`

    const res = await query(sql, params)
    return NextResponse.json(res.rows)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST: Add new bank link to library
export async function POST(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session || (session.role !== "admin" && session.role !== "developer" && session.role !== "branch_manager")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { bank, product, url } = await req.json()
    if (!bank || !product || !url) {
      return NextResponse.json({ error: "bank, product, and url are required" }, { status: 400 })
    }

    const branchId = sessionBranchId(session)
    const res = await query(
      `INSERT INTO link_library (bank, product, url, branch_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [bank.trim(), product.trim(), url.trim(), branchId]
    )

    return NextResponse.json(res.rows[0])
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE: Remove or deactivate link
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
