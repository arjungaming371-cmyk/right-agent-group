import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")
    const institutionId = searchParams.get("institutionId")

    let sql = `
      SELECT kc.*,
             i.display_name as institution_name,
             ip.official_product_name as product_name,
             ce.exact_excerpt, ce.page_number, ce.source_url
      FROM knowledge_claims kc
      JOIN institutions i ON kc.institution_id = i.id
      LEFT JOIN institution_products ip ON kc.product_id = ip.id
      LEFT JOIN claim_evidence ce ON ce.claim_id = kc.id
      WHERE 1=1
    `
    const params: any[] = []

    if (status) {
      params.push(status)
      sql += ` AND kc.verification_status = $${params.length}`
    }

    if (institutionId) {
      params.push(institutionId)
      sql += ` AND kc.institution_id = $${params.length}`
    }

    sql += ` ORDER BY kc.created_at DESC LIMIT 50`

    const res = await query(sql, params)
    return NextResponse.json({ claims: res.rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const { claimId, action, notes } = body // action: 'approve' | 'reject'

    if (!claimId || !action) {
      return NextResponse.json({ error: "claimId and action are required" }, { status: 400 })
    }

    const newStatus = action === "approve" ? "published" : "rejected"

    const res = await query(
      `UPDATE knowledge_claims
       SET verification_status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [newStatus, claimId]
    )

    if (res.rowCount === 0) {
      return NextResponse.json({ error: "claim not found" }, { status: 404 })
    }

    await logAudit(session.email, `brie_claim_${action}`, {
      claimId,
      status: newStatus,
      notes: notes || null,
      user: session.email,
    })

    if (res.rowCount === 0) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 })
    }

    // Log review task resolution
    await query(
      `INSERT INTO review_tasks (claim_id, task_type, priority, status, review_notes, reviewed_at)
       VALUES ($1, 'manual_verification', 'normal', $2, $3, NOW())`,
      [claimId, newStatus === "published" ? "approved" : "rejected", notes || "Processed via BRIE Console"]
    )

    return NextResponse.json({ ok: true, claim: res.rows[0] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
