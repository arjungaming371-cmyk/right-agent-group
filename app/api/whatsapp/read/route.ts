import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

// Mark all inbound messages for a lead as read (clears unread badge)
export async function POST(req: NextRequest) {
  try {
    const { leadId } = await req.json()
    if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 })
    await query(
      `UPDATE whatsapp_messages SET status = 'read' WHERE lead_id = $1 AND direction = 'inbound' AND status = 'received'`,
      [leadId]
    )
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
