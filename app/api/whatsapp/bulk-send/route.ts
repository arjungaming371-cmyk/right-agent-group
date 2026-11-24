import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  branchWhatsAppCtx,
  dndGate,
  createOneTimeFormToken,
} from "@/lib/whatsapp"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"
import { withRoute, readJson } from "@/lib/api-route"

export const dynamic = "force-dynamic"

export const POST = withRoute("whatsapp", async (req: NextRequest) => {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await readJson(req)) as Record<string, any> | null
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

  const leadIds: string[] = Array.isArray(body.leadIds) ? body.leadIds.filter((id) => typeof id === "string" && id) : []
  if (leadIds.length === 0) {
    return NextResponse.json({ error: "No leads selected" }, { status: 400 })
  }

  const sendMode = String(body.sendMode || "text").trim() // "text" | "template"
  const templateName = String(body.templateName || "loan_application_form").trim()
  const templateLanguage = String(body.templateLanguage || "en").trim()
  const rawMessage = String(body.message || "").trim()

  if (sendMode === "text" && !rawMessage) {
    return NextResponse.json({ error: "Message text is required for free-form send" }, { status: 400 })
  }
  if (sendMode === "template" && !templateName) {
    return NextResponse.json({ error: "Template name is required" }, { status: 400 })
  }

  const includeLink = Boolean(body.includeLink)
  const product = String(body.product || "Home Loan").trim()
  const branchId = sessionBranchId(session)
  const waBranch = await branchWhatsAppCtx(branchId)

  // Fetch leads
  const leadRes = await query(
    branchId
      ? `SELECT id, name, phone, whatsapp_number, branch_id FROM leads WHERE id = ANY($1) AND branch_id = $2`
      : `SELECT id, name, phone, whatsapp_number, branch_id FROM leads WHERE id = ANY($1)`,
    branchId ? [leadIds, branchId] : [leadIds]
  )
  const leads = leadRes.rows as Array<{ id: string; name: string | null; phone: string | null; whatsapp_number: string | null; branch_id: string | null }>
  if (!leads || leads.length === 0) {
    return NextResponse.json({ error: "No valid leads found in your branch" }, { status: 404 })
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")
  let sentCount = 0
  let skippedDnd = 0
  let failedCount = 0
  const errors: string[] = []

  for (const lead of leads) {
    const rawTarget = lead.whatsapp_number || lead.phone || ""
    if (!rawTarget) {
      failedCount++
      continue
    }

    // Check DND suppression
    const gate = await dndGate(rawTarget)
    if (gate && !gate.ok) {
      skippedDnd++
      continue
    }

    let finalMessage = ""
    let token = ""

    if (includeLink) {
      try {
        token = await createOneTimeFormToken(lead.id, product)
      } catch {
        token = ""
      }
    }

    try {
      let result: { ok: boolean; id?: string; error?: string }

      if (sendMode === "template") {
        finalMessage = `[Meta Template: ${templateName}] Sent to ${lead.name || "Customer"}`
        result = await sendWhatsAppTemplate(
          rawTarget,
          templateName,
          {
            language: templateLanguage,
            bodyVariables: [lead.name || "there"],
            buttonUrlVariable: token || undefined,
          },
          waBranch
        )
      } else {
        finalMessage = rawMessage.replace(/\{name\}/gi, lead.name || "Customer")
        if (includeLink) {
          const link = appUrl && token ? `${appUrl}/l/${token}` : `${appUrl || ""}/apply`
          finalMessage += `\n\nApply or check details here:\n${link}`
        }
        result = await sendWhatsAppText(rawTarget, finalMessage, waBranch)
      }

      if (result.ok) {
        sentCount++
        // Log in whatsapp_messages
        await db.from("whatsapp_messages").insert({
          lead_id: lead.id,
          phone_number: rawTarget,
          direction: "outbound",
          content: finalMessage,
          status: "sent",
          branch_id: lead.branch_id || branchId,
          wa_message_id: result.id || null,
        }).catch(() => {})

        // Log in comm_logs
        await db.from("comm_logs").insert({
          lead_id: lead.id,
          type: "whatsapp",
          summary: `[Bulk WhatsApp] ${finalMessage.slice(0, 120)}`,
          outcome: "sent",
        }).catch(() => {})
      } else {
        failedCount++
        if (result.error && !errors.includes(result.error)) {
          errors.push(result.error)
        }
      }
    } catch (e: any) {
      failedCount++
      if (e.message && !errors.includes(e.message)) {
        errors.push(e.message)
      }
    }

    // Pacing: 80ms sleep to stay well within Meta rate limits
    await new Promise((resolve) => setTimeout(resolve, 80))
  }

  logAudit("bulk whatsapp campaign", session.email, {
    total: leads.length,
    sentCount,
    skippedDnd,
    failedCount,
  })

  return NextResponse.json({
    ok: true,
    total: leads.length,
    sentCount,
    skippedDnd,
    failedCount,
    errors: errors.slice(0, 5),
  })
})
