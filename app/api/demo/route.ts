import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db, query } from "@/lib/db"
import { logAudit } from "@/lib/audit"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"
import { rateLimit, clientIp } from "@/lib/rate-limit"

// Public — no auth. This is the marketing site's "Book a Demo" form
// (components/site/demo-form.tsx), reachable by anyone on the internet.
// Clones the hardened /api/apply pattern exactly: rate limit → honeypot →
// required fields → +91 validation → last-10 dedupe that only APPENDS notes
// (never touches an existing lead's status/source/assignment). Demo requests
// land in the same `leads` table so they appear in the existing dashboard
// pipeline without any new schema.
export async function POST(req: NextRequest) {
  if (!rateLimit(`demo:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

  // Honeypot: a hidden field real users never fill in. Bots that
  // autofill every field trip it; humans never see it exists.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true })
  }

  const name = String(body.name || "").trim().slice(0, 120)
  const phoneRaw = String(body.phone || "").trim()
  if (!name || !phoneRaw) {
    return NextResponse.json({ error: "name and phone are required" }, { status: 400 })
  }
  const phone = normalizePhone(phoneRaw)
  if (!phone) return NextResponse.json({ error: "invalid phone" }, { status: 400 })
  // Same rule as /api/apply: this app is India-only (+91); require the full
  // 12-digit normalized form.
  if (!/^\+91\d{10}$/.test(phone)) {
    return NextResponse.json({ error: "Enter a valid 10-digit Indian mobile number" }, { status: 400 })
  }

  const email = body.email ? String(body.email).trim().slice(0, 200) : null
  const company = body.company ? String(body.company).trim().slice(0, 200) : null
  const message = body.message ? String(body.message).trim().slice(0, 1000) : null
  // Free-text guard: only the three values the form offers are accepted.
  const rawTime = body.preferredTime ? String(body.preferredTime).trim() : null
  const preferredTime =
    rawTime && ["Morning", "Afternoon", "Evening"].includes(rawTime) ? rawTime : null

  const notesParts = [
    company ? `Company: ${company}` : null,
    preferredTime ? `Preferred demo time: ${preferredTime}` : null,
    message ? `Message: ${message}` : null,
  ].filter(Boolean)

  const record = {
    name,
    phone,
    email,
    product_interest: "Book a Demo",
    notes: notesParts.join(" | ") || null,
    source: "website_demo",
    status: "new",
  }

  try {
    const existing = await query(
      `SELECT id, name, email, notes, status, source FROM leads WHERE ${PHONE_MATCH_SQL} LIMIT 1`,
      [phoneLast10(phone)]
    )
    if (existing.rows.length > 0) {
      const lead = existing.rows[0]
      // Same rule as /api/apply: the public path only APPENDS a note and
      // fills empty fields — it must never wipe an agent's accumulated
      // notes or reset a qualified lead back to "new".
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
      // Privacy: only the last 4 digits of the phone go to the audit trail.
      logAudit("demo request received (existing lead, notes appended)", "public", {
        leadId: lead.id,
        phone_last4: phone.slice(-4),
      })
      return NextResponse.json({ ok: true, id: data?.id })
    }

    const { data, error } = await db.from("leads").insert(record).select().single()
    if (error) return apiError(error)
    logAudit("demo_request", name, { phone_last4: phone.slice(-4) })
    return NextResponse.json({ ok: true, id: data?.id })
  } catch (e: any) {
    return apiError(e)
  }
}
