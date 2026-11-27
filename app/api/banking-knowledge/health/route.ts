import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export async function GET() {
  try {
    const instCount = await query(`SELECT COUNT(*) FROM institutions`)
    const prodCount = await query(`SELECT COUNT(*) FROM institution_products`)
    const claimCount = await query(`SELECT COUNT(*) FROM knowledge_claims WHERE verification_status = 'published'`)
    const pendingReviews = await query(`SELECT COUNT(*) FROM review_tasks WHERE status = 'pending'`)
    const sourcesCount = await query(`SELECT COUNT(*) FROM source_registry`)

    return NextResponse.json({
      status: "healthy",
      engine: "Banking Research Intelligence Engine (BRIE)",
      version: "1.0.0",
      cohort1_status: "verified",
      coverage: {
        institutions: parseInt(instCount.rows[0]?.count || "0", 10),
        products: parseInt(prodCount.rows[0]?.count || "0", 10),
        published_claims: parseInt(claimCount.rows[0]?.count || "0", 10),
        pending_reviews: parseInt(pendingReviews.rows[0]?.count || "0", 10),
        sources: parseInt(sourcesCount.rows[0]?.count || "0", 10),
      },
      verified_lenders_cohort1: ["State Bank of India (SBI)", "HDFC Bank Limited", "Bajaj Finance Limited"],
      timestamp: new Date().toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json({ status: "degraded", error: e.message }, { status: 500 })
  }
}
