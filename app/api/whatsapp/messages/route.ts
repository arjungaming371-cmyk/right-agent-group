import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const leadId = searchParams.get("leadId")
  const limit  = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") || "100") || 100))
  if (!leadId) return NextResponse.json([])
  try {
    const result = await query(
      `SELECT id, direction, content, status, created_at
       FROM whatsapp_messages
       WHERE lead_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [leadId, limit]
    )
    return NextResponse.json(result.rows)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
