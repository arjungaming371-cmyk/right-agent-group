import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { seedBrieMasterData } from "@/lib/brie/seed-cohort1"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const type = searchParams.get("type")
    const search = searchParams.get("search")
    const autoSeed = searchParams.get("seed") === "1"

    // Check count; if empty or seed requested, auto-seed
    const countRes = await query(`SELECT COUNT(*) FROM institutions`)
    if (parseInt(countRes.rows[0]?.count || "0", 10) === 0 || autoSeed) {
      await seedBrieMasterData()
    }

    let sql = `
      SELECT i.*,
             COUNT(DISTINCT ip.id) as product_count,
             COUNT(DISTINCT kc.id) as claim_count
      FROM institutions i
      LEFT JOIN institution_products ip ON ip.institution_id = i.id
      LEFT JOIN knowledge_claims kc ON kc.institution_id = i.id
      WHERE 1=1
    `
    const params: any[] = []

    if (type) {
      params.push(type)
      sql += ` AND i.institution_type = $${params.length}`
    }

    if (search) {
      params.push(`%${search}%`)
      sql += ` AND (i.display_name ILIKE $${params.length} OR i.legal_name ILIKE $${params.length})`
    }

    sql += ` GROUP BY i.id ORDER BY i.research_priority ASC, i.completion_score DESC, i.display_name ASC`

    const res = await query(sql, params)

    return NextResponse.json({
      institutions: res.rows,
      total: res.rowCount,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
