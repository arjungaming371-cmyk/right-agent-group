import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { sendApplicationLink, branchWhatsAppCtx } from "@/lib/whatsapp"
import crypto from "crypto"

export const dynamic = "force-dynamic"

function genShortToken(): string {
  return crypto.randomBytes(12).toString("hex") // 24 hex characters
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "Forbidden: insufficient permissions to send links" }, { status: 403 })

  try {
    const { leadId, bank, product, phone: customPhone } = await req.json()
    if (!leadId) {
      return NextResponse.json({ error: "leadId required" }, { status: 400 })
    }
    const requestedBank = (bank || "Right Agent Group").trim()

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "")
    if (!appUrl) {
      return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is not configured on server" }, { status: 500 })
    }

    // Fetch lead with branch isolation check
    const userBranch = sessionBranchId(session)
    const leadRes = userBranch
      ? await query(`SELECT * FROM leads WHERE id = $1 AND (branch_id = $2 OR branch_id IS NULL) LIMIT 1`, [leadId, userBranch])
      : await query(`SELECT * FROM leads WHERE id = $1 LIMIT 1`, [leadId])

    if (!leadRes.rows || leadRes.rows.length === 0) {
      return NextResponse.json({ error: "Lead not found or access denied" }, { status: 404 })
    }
    const lead = leadRes.rows[0]
    const phone = customPhone || lead.whatsapp_number || lead.phone

    if (!phone) {
      return NextResponse.json({ error: "No phone number available for this lead" }, { status: 400 })
    }

    const prod = product || lead.product_interest || "Home Loan"
    const token = genShortToken()
    const branchId = userBranch || lead.branch_id || null

    // Look up library entry for this loan product
    const libRes = await query(
      `SELECT id, bank, url FROM link_library WHERE lower(product) = lower($1) AND active = true ORDER BY created_at DESC LIMIT 1`,
      [prod]
    )
    const libraryId = libRes.rows?.[0]?.id || null
    const effectiveBank = libRes.rows?.[0]?.bank || requestedBank || "Right Agent Group"

    // Record in link_sends
    const insertRes = await query(
      `INSERT INTO link_sends (token, lead_id, library_id, bank, product, channel, sent_by, status, branch_id)
       VALUES ($1, $2, $3, $4, $5, 'whatsapp', $6, 'sent', $7)
       RETURNING *`,
      [token, leadId, libraryId, bank, prod, session.email || "staff", branchId]
    )

    const linkSend = insertRes.rows[0]
    const redirectUrl = `${appUrl}/l/${token}`

    // Send via WhatsApp using the approved template (with automatic fallback to text in-window)
    const waBranch = await branchWhatsAppCtx(branchId)
    const waRes = await sendApplicationLink(phone, lead.name || "there", token, waBranch)

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
