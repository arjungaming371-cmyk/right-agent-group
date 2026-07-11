import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { sendApplicationLink } from "@/lib/whatsapp"
import { randomUUID } from "crypto"

export async function POST(req: NextRequest) {
  const { leadId, phone, loanType } = await req.json()
  if (!leadId || !phone) {
    return NextResponse.json({ error: "leadId and phone required" }, { status: 400 })
  }

  try {
    // Get lead details
    const { data: lead } = await db.from("leads").select("*").eq("id", leadId).single()
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 })

    // Create secure form token
    const token = randomUUID()
    await query(`INSERT INTO form_links (token, lead_id) VALUES ($1, $2)`, [token, leadId])

    // Send WhatsApp message with form link
    const result = await sendApplicationLink(phone, lead.name || "there", token)

    if (!result.ok) {
      // Still save the token even if WA send fails — admin can share manually
      console.warn("WhatsApp send failed:", result.error)
    }

    // Update lead to show form was sent
    await db.from("leads").update({
      form_completed: false,
      updated_at: new Date().toISOString(),
    }).eq("id", leadId)

    await db.from("comm_logs").insert({
      lead_id: leadId,
      type: "whatsapp",
      summary: result.ok
        ? `Loan application form link sent via WhatsApp to ${phone}`
        : `Form link generated (WhatsApp not configured — share manually): /form/${token}`,
      outcome: result.ok ? "sent" : "pending",
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    return NextResponse.json({
      ok: true,
      token,
      formUrl: `${appUrl}/form/${token}`,
      whatsappSent: result.ok,
      warning: result.ok ? null : result.error,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
