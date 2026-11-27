import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { normalizePhone, phoneLast10 } from "@/lib/phone"
import { rateLimit, clientIp } from "@/lib/rate-limit"
import { makeCall } from "@/lib/exotel"
import { sendWhatsAppText } from "@/lib/whatsapp"

export const dynamic = "force-dynamic"

/**
 * Public Fast-Lead / Ad Capture Endpoint
 * Receives leads directly from Meta/Instagram/Google Ads or the /apply page.
 * Creates/updates the lead, triggers Priya's automated speed-to-lead outbound voice call,
 * and sends an instant WhatsApp welcome message.
 */
export async function POST(req: NextRequest) {
  // Rate-limiting: max 15 submissions per minute per IP to prevent spam abuse
  if (!rateLimit(`fast-lead:${clientIp(req)}`, 15, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request data." }, { status: 400 })
  }

  // Honeypot check for spam bots
  if (body?.website && typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true })
  }

  const name = String(body?.name || "").trim().slice(0, 100)
  const rawPhone = String(body?.phone || "").trim()
  const loanType = String(body?.loanType || "Home Loan").trim().slice(0, 80)
  const rawAmount = String(body?.loanAmount || "").replace(/[^\d.]/g, "")
  const loanAmount = rawAmount ? parseFloat(rawAmount) : null
  const language = ["telugu", "english", "hindi"].includes(String(body?.language || "").toLowerCase())
    ? String(body?.language).toLowerCase()
    : "telugu"

  if (!name) {
    return NextResponse.json({ error: "Please enter your full name." }, { status: 400 })
  }

  const normalizedPhone = normalizePhone(rawPhone)
  if (!/^\+91[6-9]\d{9}$/.test(normalizedPhone)) {
    return NextResponse.json(
      { error: "Please enter a valid 10-digit Indian mobile number." },
      { status: 400 }
    )
  }

  const phoneKey = phoneLast10(normalizedPhone)

  try {
    // 1. Create or Update Lead in CRM
    const noteEntry = `[${new Date().toISOString()}] Ad submission from Instagram/Meta Ad. Loan Type: ${loanType}, Amount: ${loanAmount ? "₹" + loanAmount.toLocaleString("en-IN") : "Unspecified"}, Preferred Language: ${language}.`

    const leadRes = await query(
      `INSERT INTO leads (name, phone, whatsapp_number, product_interest, loan_amount, source, status, language, notes, is_social_prospect)
       VALUES ($1, $2, $2, $3, $4, 'Instagram/Meta Ad', 'new', $5, $6, false)
       ON CONFLICT (phone_key) WHERE phone_key <> ''
       DO UPDATE SET
         name = COALESCE(EXCLUDED.name, leads.name),
         product_interest = COALESCE(EXCLUDED.product_interest, leads.product_interest),
         loan_amount = COALESCE(EXCLUDED.loan_amount, leads.loan_amount),
         language = EXCLUDED.language,
         source = 'Instagram/Meta Ad',
         notes = leads.notes || E'\n' || EXCLUDED.notes,
         is_social_prospect = false,
         updated_at = now()
       RETURNING id, name, phone, language`,
      [name, normalizedPhone, loanType, loanAmount, language, noteEntry]
    )

    const lead = leadRes.rows[0]
    const leadId = lead?.id

    // 1b. Log into loan_applications so it appears in the Customer Loan Applications console
    try {
      await query(
        `INSERT INTO loan_applications (lead_id, customer_name, full_name, phone, whatsapp_number, loan_type, loan_amount, status, submitted_at)
         VALUES ($1, $2, $2, $3, $3, $4, $5, 'pending', now())`,
        [leadId, name, normalizedPhone, loanType, loanAmount]
      )
      await query(
        `INSERT INTO comm_logs (lead_id, type, summary, outcome)
         VALUES ($1, 'alert', $2, 'application_submitted')`,
        [
          leadId,
          `📋 APPLICATION SUBMITTED — Lead submitted ${loanType || "Loan"} application for ${loanAmount ? "₹" + Number(loanAmount).toLocaleString("en-IN") : "unspecified amount"}. Follow up for KYC & document collection.`
        ]
      ).catch(() => {})
    } catch (e: any) {
      console.warn("Could not insert into loan_applications:", e?.message)
    }

    // 2. Trigger Instant Speed-to-Lead Outbound Voice Call via Priya
    let callSid: string | null = null
    let callError: string | null = null

    try {
      const instructions = `Lead ${name} submitted an instant callback request on Instagram/Meta Ad for ${loanType} of ${loanAmount ? "₹" + loanAmount.toLocaleString("en-IN") : "suitable amount"}. Greet them warmly in ${language}, confirm their requirement, explain that Right Agent Group compares 20+ top banks with zero advance fees, and qualify their document readiness.`

      const callResult = await makeCall(normalizedPhone, leadId, language, instructions)
      callSid = callResult?.sid || null

      if (callSid) {
        await query(
          `INSERT INTO voice_calls (lead_id, twilio_call_sid, direction, status, language, phone, instructions)
           VALUES ($1, $2, 'outbound', 'initiated', $3, $4, $5)`,
          [leadId, callSid, language, normalizedPhone, instructions]
        )

        await query(
          `INSERT INTO comm_logs (lead_id, type, summary, outcome)
           VALUES ($1, 'call', 'Instant Speed-to-Lead AI Call dispatched to Priya for Instagram Ad lead', 'pending')`,
          [leadId]
        )
      }
    } catch (e: any) {
      callError = e?.message || "Call initiation skipped"
      console.warn("Fast lead auto-call warning (non-fatal):", callError)
    }

    // 3. Send Instant WhatsApp Welcome & Rate Card (non-blocking)
    const waText = `Namaste ${name}! 🙏\n\nThank you for submitting your loan enquiry via our Instagram Ad with *Right Agent Group*.\n\n📞 Our Senior AI Loan Advisor *Priya* is reaching out to discuss your *${loanType}* options.\n\nWe work with 20+ top banks and NBFCs across Hyderabad with *0 advance fees* to get you the lowest interest rates.\n\n💬 If you have any questions or prefer chatting on WhatsApp, simply reply directly to this message!\n\nHead Office: Gandimaisamma, Hyderabad\nHelpline: +91 8333997227 | WhatsApp: +91 8333993223`

    sendWhatsAppText(normalizedPhone, waText).catch((e) => {
      console.warn("Fast lead WhatsApp welcome error (non-fatal):", e?.message || e)
    })

    return NextResponse.json({
      ok: true,
      leadId,
      callSid,
      phone: normalizedPhone,
      message: "Lead received and AI callback scheduled.",
    })
  } catch (e: any) {
    console.error("Fast lead API error:", e)
    return NextResponse.json(
      { error: "Could not process enquiry. Please try again or WhatsApp us directly." },
      { status: 500 }
    )
  }
}
