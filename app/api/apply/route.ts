import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db, query } from "@/lib/db"
import { logAudit } from "@/lib/audit"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"
import { rateLimit, clientIp } from "@/lib/rate-limit"

// Public — no auth. This is the promo site's "Apply" form (app/apply), so
// unlike /api/leads it's reachable by anyone on the internet. Applications
// land in the same `leads` table (source: "website_application") so they
// show up in the existing dashboard pipeline without any new schema.
export async function POST(req: NextRequest) {
  if (!rateLimit(`apply:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

  // Honeypot: a hidden field real users never fill in. Bots that
  // autofill every field trip it; humans never see it exists.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true })
  }

  const name = String(body.name || "").trim()
  const phoneRaw = String(body.phone || "").trim()
  if (!name || !phoneRaw) {
    return NextResponse.json({ error: "name and phone are required" }, { status: 400 })
  }
  const phone = normalizePhone(phoneRaw)
  if (!phone) return NextResponse.json({ error: "invalid phone" }, { status: 400 })
  // FIX (2026-09-20): normalizePhone returns junk like "+12345" for random
  // digit runs — that junk became a lead's dedupe identity. This app is
  // India-only (+91); require the full 12-digit form.
  if (!/^\+91\d{10}$/.test(phone)) {
    return NextResponse.json({ error: "Enter a valid 10-digit Indian mobile number" }, { status: 400 })
  }

  const email = body.email ? String(body.email).trim() : null
  const company = body.company ? String(body.company).trim() : null
  const planInterest = body.plan ? String(body.plan).trim() : null
  const message = body.message ? String(body.message).trim() : null

  const notesParts = [
    company ? `Company: ${company}` : null,
    planInterest ? `Interested plan: ${planInterest}` : null,
    message ? `Message: ${message}` : null,
  ].filter(Boolean)

  const record = {
    name,
    phone,
    email,
    product_interest: "Website Application",
    notes: notesParts.join(" | ") || null,
    source: "website_application",
    status: "new",
  }

  try {
    const existing = await query(
      `SELECT id, name, email, notes, status, source FROM leads WHERE ${PHONE_MATCH_SQL} LIMIT 1`,
      [phoneLast10(phone)]
    )
    if (existing.rows.length > 0) {
      const lead = existing.rows[0]
      // FIX (2026-09-20): the public form used to WHOLESALE-OVERWRITE an
      // existing lead on the same phone — anyone who knew a customer's number
      // could wipe the agent's accumulated notes, overwrite name/email, and
      // reset a qualified lead back to "new" (kicking it out of the funnel).
      // The public path now only APPENDS a note and fills empty fields.
      const appendedNotes = [lead.notes, record.notes].filter(Boolean).join("\n---\n")
      const { data, error } = await db
        .from("leads")
        .update({
          name: lead.name || record.name, // fill only when empty
          email: lead.email || record.email,
          product_interest: record.product_interest,
          notes: appendedNotes.slice(0, 4000),
          updated_at: new Date().toISOString(),
          // status/source/assigned fields are NEVER touched by the public path
        })
        .eq("id", lead.id)
        .select()
        .single()
      if (error) return apiError(error)
      logAudit("website application received (existing lead, notes appended)", "public", { leadId: lead.id, phone })
      return NextResponse.json({ ok: true, id: data?.id })
    }

    const { data, error } = await db.from("leads").insert(record).select().single()
    if (error) return apiError(error)
    logAudit("website application received", "public", { leadId: data?.id, name, phone })
    return NextResponse.json({ ok: true, id: data?.id })
  } catch (e: any) {
    return apiError(e)
  }
}
