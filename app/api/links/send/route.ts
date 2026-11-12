import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getLiveSession } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { sendWhatsAppText, branchWhatsAppCtx } from "@/lib/whatsapp"
import crypto from "crypto"

export const dynamic = "force-dynamic"

function genShortToken(): string {
  return crypto.randomBytes(4).toString("hex") // 8 chars e.g. "a7f3k29b"
}

export async function POST(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { leadId, bank, product, phone: customPhone } = await req.json()
    if (!leadId || !bank) {
      return NextResponse.json({ error: "leadId and bank required" }, { status: 400 })
    }

    // Fetch lead
    const leadRes = await query(`SELECT * FROM leads WHERE id = $1 LIMIT 1`, [leadId])
    if (!leadRes.rows || leadRes.rows.length === 0) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    }
    const lead = leadRes.rows[0]
    const phone = customPhone || lead.whatsapp_number || lead.phone

    if (!phone) {
      return NextResponse.json({ error: "No phone number available for this lead" }, { status: 400 })
    }

    const prod = product || lead.product_interest || "Home Loan"
    const token = genShortToken()
    const branchId = sessionBranchId(session) || lead.branch_id || null

    // Record in link_sends
    const insertRes = await query(
      `INSERT INTO link_sends (token, lead_id, bank, product, channel, sent_by, status, branch_id)
       VALUES ($1, $2, $3, $4, 'whatsapp', $5, 'sent', $6)
       RETURNING *`,
      [token, leadId, bank, prod, session.email || "staff", branchId]
    )

    const linkSend = insertRes.rows[0]
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://13.201.0.111.sslip.io").replace(/\/$/, "")
    const redirectUrl = `${appUrl}/l/${token}`

    // Send via WhatsApp
    const waBranch = await branchWhatsAppCtx(branchId)
    const brand = waBranch?.brandName || "Right Agent Group"

    const message = `Hello ${lead.name || "there"},\n\nHere is your official *${bank}* ${prod} application link from ${brand}:\n\n👉 ${redirectUrl}\n\nIt takes ~10 minutes to submit. Once you submit, our loan officer will follow up to assist with your sanction and disbursement.`

    const waRes = await sendWhatsAppText(phone, message, waBranch)

    // Update lead status
    await query(
      `UPDATE leads
       SET status = 'link_sent', updated_at = now()
       WHERE id = $1`,
      [leadId]
    )

    // Log in comm_logs
    await query(
      `INSERT INTO comm_logs (lead_id, type, summary, outcome)
       VALUES ($1, 'whatsapp', $2, $3)`,
      [
        leadId,
        `Sent ${bank} ${prod} application link (${redirectUrl}) via WhatsApp`,
        waRes.ok ? "sent" : "failed",
      ]
    ).catch(() => {})

    return NextResponse.json({
      ok: true,
      token,
      url: redirectUrl,
      whatsappSent: waRes.ok,
      linkSend,
      error: waRes.error,
    })
  } catch (e: any) {
    console.error("send bank link error:", e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
