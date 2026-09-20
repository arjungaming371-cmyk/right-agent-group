import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db, query } from "@/lib/db"
import { sendApplicationLink, branchWhatsAppCtx } from "@/lib/whatsapp"
import { requireRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { randomUUID } from "crypto"

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { leadId, phone, loanType } = await req.json()
  if (!leadId || !phone) {
    return NextResponse.json({ error: "leadId and phone required" }, { status: 400 })
  }

  try {
    // Get lead details — 2026-09 fix (cross-branch IDOR): branch-bound staff
    // can only generate/send form links for leads INSIDE their branch.
    const branchId = sessionBranchId(session)
    let leadQuery = db.from("leads").select("*").eq("id", leadId)
    if (branchId) leadQuery = leadQuery.eq("branch_id", branchId)
    const { data: lead } = await leadQuery.maybeSingle()
    if (!lead) return NextResponse.json({ error: "Lead not found in your branch" }, { status: 404 })

    // 2026-09 fix (arbitrary-number send): the WhatsApp target used to come
    // from the REQUEST body, so a compromised session could point a form
    // link (one-time application URL) at ANY phone number. The lead's own
    // number is the only legitimate destination.
    const target = lead.whatsapp_number || lead.phone
    if (!target) return NextResponse.json({ error: "lead has no phone number" }, { status: 400 })

    // Create secure form token
    const token = randomUUID()
    await query(`INSERT INTO form_links (token, lead_id) VALUES ($1, $2)`, [token, leadId])

    // Send WhatsApp message with form link — from the LEAD's branch WABA
    // number when it has one, so the message lands on the number the
    // customer associates with that branch.
    const waBranch = await branchWhatsAppCtx(lead.branch_id)
    const result = await sendApplicationLink(target, lead.name || "there", token, waBranch)

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
        ? `Loan application form link sent via WhatsApp to ${target}`
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
    return apiError(e)
  }
}
