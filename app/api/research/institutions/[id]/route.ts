import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

interface Ctx {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params

    const instRes = await query(`SELECT * FROM institutions WHERE id = $1`, [id])
    if (!instRes.rows[0]) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 })
    }
    const inst = instRes.rows[0]

    const productsRes = await query(
      `SELECT ip.*, pf.name as family_name, pf.code as family_code, pf.segment
       FROM institution_products ip
       JOIN product_families pf ON ip.product_family_id = pf.id
       WHERE ip.institution_id = $1
       ORDER BY ip.official_product_name ASC`,
      [id]
    )

    const claimsRes = await query(
      `SELECT kc.*, ce.page_number, ce.section_heading, ce.exact_excerpt, ce.source_url as evidence_url
       FROM knowledge_claims kc
       LEFT JOIN claim_evidence ce ON ce.claim_id = kc.id
       WHERE kc.institution_id = $1
       ORDER BY kc.created_at DESC`,
      [id]
    )

    const pricingRes = await query(
      `SELECT pf.*, ip.official_product_name
       FROM pricing_facts pf
       JOIN institution_products ip ON pf.product_id = ip.id
       WHERE pf.institution_id = $1`,
      [id]
    )

    return NextResponse.json({
      institution: inst,
      products: productsRes.rows,
      claims: claimsRes.rows,
      pricing: pricingRes.rows,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
