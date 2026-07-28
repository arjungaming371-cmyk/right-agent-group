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
    const existing = await query(`SELECT id FROM leads WHERE ${PHONE_MATCH_SQL}`, [phoneLast10(phone)])
    if (existing.rows.length > 0) {
      const id = existing.rows[0].id
      const { data, error } = await db
        .from("leads")
        .update({ ...record, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single()
      if (error) return apiError(error)
      logAudit("website application received (existing lead)", "public", { leadId: id, phone })
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
