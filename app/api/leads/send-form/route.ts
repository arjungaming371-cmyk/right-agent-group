import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db, query } from "@/lib/db"
import { sendApplicationLink, branchWhatsAppCtx } from "@/lib/whatsapp"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { randomUUID } from "crypto"

export async function POST(req: NextRequest) {
  // FIX (2026-09-20): requireRole let users WITHOUT the leads module through,
  // and the lead was fetched with no branch predicate — a branch-A agent
  // could mint a valid one-time form token for any branch-B lead and read
  // its PII via GET /api/form/[token] (name/phone/address) or send it to
  // their own number. Enforce module + branch ownership.
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { leadId, phone, loanType } = await req.json()
  if (!leadId || !phone) {
    return NextResponse.json({ error: "leadId and phone required" }, { status: 400 })
  }

  try {
    // Get lead details
    const { data: lead } = await db.from("leads").select("*").eq("id", leadId).single()
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    const scope = sessionBranchId(session)
    if (scope && lead.branch_id !== scope) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 }) // don't confirm existence cross-branch
    }

    // Create secure form token (14-day TTL — FIX 2026-09-20: tokens used to
    // be valid FOREVER, serving lead PII to anyone who obtained the link).
    const token = randomUUID()
    await query(
      `INSERT INTO form_links (token, lead_id, expires_at) VALUES ($1, $2, now() + interval '14 days')`,
      [token, leadId]
    ).catch(async (e: any) => {
      if (e?.code !== "42703") throw e // pre-migration DB → fall back (no TTL)
      await query(`INSERT INTO form_links (token, lead_id) VALUES ($1, $2)`, [token, leadId])
    })

    // Send WhatsApp message with form link — from the LEAD's branch WABA
    // number when it has one, so the message lands on the number the
    // customer associates with that branch.
    const waBranch = await branchWhatsAppCtx(lead.branch_id)
    const result = await sendApplicationLink(phone, lead.name || "there", token, waBranch)

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
        // FIX (2026-09-20): never write the live one-time token into the
        // dashboard-visible comm log (a viewer could consume the link before
        // the customer does). Point staff to the resend button instead.
        : `Form link generated (WhatsApp not configured — resend from this lead's page).`,
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
