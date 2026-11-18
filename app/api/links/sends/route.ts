import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getLiveSession } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// GET: list all link sends joined with lead details
export async function GET(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const branchId = sessionBranchId(session)
  const status = req.nextUrl.searchParams.get("status")
  const search = req.nextUrl.searchParams.get("search")

  try {
    let sql = `
      SELECT
        s.*,
        l.name AS lead_name,
        l.phone AS lead_phone,
        l.loan_amount AS lead_loan_amount,
        l.address AS lead_city,
        lib.url AS target_bank_url
      FROM link_sends s
      LEFT JOIN leads l ON s.lead_id = l.id
      LEFT JOIN link_library lib ON (lower(lib.bank) = lower(s.bank) AND lower(lib.product) = lower(s.product))
      WHERE 1=1
    `
    const params: any[] = []

    if (branchId) {
      params.push(branchId)
      sql += ` AND (s.branch_id IS NULL OR s.branch_id = $${params.length})`
    }

    if (status && status !== "all") {
      params.push(status)
      sql += ` AND s.status = $${params.length}`
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`)
      sql += ` AND (lower(s.bank) LIKE $${params.length} OR lower(s.product) LIKE $${params.length} OR lower(coalesce(l.name, '')) LIKE $${params.length} OR coalesce(l.phone, '') LIKE $${params.length})`
    }

    sql += ` ORDER BY s.sent_at DESC LIMIT 200`

    const res = await query(sql, params)

    // Compute stats
    const statsRes = await query(`
      SELECT
        count(*)::int AS total,
        count(CASE WHEN status = 'sent' THEN 1 END)::int AS sent,
        count(CASE WHEN clicked_at IS NOT NULL OR status IN ('opened', 'applied', 'sanctioned', 'disbursed') THEN 1 END)::int AS opened,
        count(CASE WHEN status IN ('applied', 'sanctioned', 'disbursed') THEN 1 END)::int AS applied,
        count(CASE WHEN status IN ('sanctioned', 'disbursed') THEN 1 END)::int AS sanctioned,
        count(CASE WHEN status = 'disbursed' THEN 1 END)::int AS disbursed,
        coalesce(sum(CASE WHEN status = 'disbursed' THEN coalesce(loan_amount, 0) END), 0)::numeric AS disbursed_volume
      FROM link_sends
      ${branchId ? "WHERE (branch_id IS NULL OR branch_id = $1)" : ""}
    `, branchId ? [branchId] : [])

    return NextResponse.json({
      links: res.rows,
      stats: statsRes.rows[0] || {},
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH: update status (e.g. mark as applied, sanctioned, disbursed, or lost)
export async function PATCH(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id, status, loan_amount, notes } = await req.json()
    if (!id || !status) {
      return NextResponse.json({ error: "id and status required" }, { status: 400 })
    }

    const updates: string[] = ["status = $2"]
    const params: any[] = [id, status]

    if (status === "applied") {
      updates.push("applied_at = COALESCE(applied_at, now())")
    } else if (status === "sanctioned") {
      updates.push("sanctioned_at = COALESCE(sanctioned_at, now())")
    } else if (status === "disbursed") {
      updates.push("disbursed_at = COALESCE(disbursed_at, now())")
    }

    if (loan_amount !== undefined) {
      params.push(loan_amount ? parseFloat(loan_amount) : null)
      updates.push(`loan_amount = $${params.length}`)
    }

    if (notes !== undefined) {
      params.push(notes)
      updates.push(`notes = $${params.length}`)
    }

    const sql = `UPDATE link_sends SET ${updates.join(", ")} WHERE id = $1 RETURNING *`
    const res = await query(sql, params)

    return NextResponse.json(res.rows[0])
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
