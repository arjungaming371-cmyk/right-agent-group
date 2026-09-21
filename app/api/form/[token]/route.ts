import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import pool, { db, query } from "@/lib/db"
import { rateLimit, clientIp } from "@/lib/rate-limit"
import { sendApplicationConfirmation, isMailConfigured } from "@/lib/mail"
import { createNotification } from "@/lib/notifications"

// PUBLIC endpoint (no login) — protected by rate limiting + one-time tokens.

// form_links.token is a UUID column — reject malformed tokens up front,
// otherwise Postgres throws a cast error and the customer sees a 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!UUID_RE.test(token)) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 })
  if (!rateLimit(`form-get:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const linkRes = await query(`SELECT * FROM form_links WHERE token = $1`, [token])
  const link = linkRes.rows[0]
  if (!link) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 })

  // FIX (2026-09-20): expired links no longer resolve (TTL added 2026-09-20;
  // pre-migration DBs have no expires_at column → treated as never-expiring).
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 410 })
  }

  const { data: lead } = await db.from("leads").select("*").eq("id", link.lead_id).single()
  // FIX (2026-09-20): a CONSUMED link used to keep serving the lead's
  // name/phone/address forever — anyone who later obtained the link (shared
  // device, forwarded WhatsApp chat) could read the PII at any time in the
  // future. After consumption only the validity flags are returned.
  if (link.used_at) {
    return NextResponse.json({ valid: false, used: true, lead: null })
  }
  return NextResponse.json({
    valid: true,
    used: false,
    lead: lead ? { name: lead.name, phone: lead.phone, address: lead.address, product_interest: lead.product_interest } : null,
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!UUID_RE.test(token)) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 })

  // Rate limit by IP and by token (blocks both spray and single-link abuse)
  if (!rateLimit(`form-post:${clientIp(req)}`, 10, 60_000) || !rateLimit(`form-post-token:${token}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const linkRes = await query(`SELECT * FROM form_links WHERE token = $1`, [token])
  const link = linkRes.rows[0]
  if (!link) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 })

  // ONE-TIME LINK: a used token can never be submitted again.
  if (link.used_at) {
    return NextResponse.json({ error: "This application link has already been used." }, { status: 410 })
  }

  // FIX (2026-09-20): expired links can no longer be submitted.
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: "This application link has expired." }, { status: 410 })
  }

  const body = await req.json()
  const {
    customer_name,
    city,
    loan_type,
    loan_amount,
    loan_tenure,
    email,
    address,
    whatsapp_number,
    employment_type,
    monthly_income,
    pan_number,
    ...rest
  } = body

  if (!customer_name) return NextResponse.json({ error: "customer_name required" }, { status: 400 })

  // FIX (2026-09-20): server-side caps. The old endpoint persisted an
  // UNVALIDATED, UNBOUNDED body — a 10 MB `customer_name` or a huge `rest`
  // blob was stored verbatim (storage-DoS once combined with any rate-limit
  // bypass), and PAN was accepted in any format.
  const capStr = (v: any, n: number) => (typeof v === "string" ? v.slice(0, n) : v ?? null)
  const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
  const pan = pan_number ? String(pan_number).trim().toUpperCase() : ""
  if (pan && !PAN_RE.test(pan)) {
    return NextResponse.json({ error: "PAN must look like ABCDE1234F (5 letters, 4 digits, 1 letter)." }, { status: 400 })
  }
  const SAFE_REST_KEYS = new Set([
    "occupation", "company_name", "cibil_score", "existing_emi", "down_payment",
    "property_value", "pincode", "state", "dob", "gender", "marital_status",
  ])
  const restData: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rest || {})) {
    if (SAFE_REST_KEYS.has(k) && (typeof v === "string" || typeof v === "number")) {
      restData[k] = typeof v === "string" ? v.slice(0, 300) : v
    }
  }
  const formData = JSON.stringify(restData).slice(0, 16_000)

  try {
    // ATOMIC claim + insert + backfill in ONE transaction (merged 2026-09-20):
    // only ONE request can flip used_at from NULL, and a crash between the
    // claim and the application insert now rolls the claim back (the one-time
    // link is no longer burned with nothing submitted). A second concurrent
    // submit gets rowCount 0 and is rejected.
    const client = await pool.connect()
    let app: any
    try {
      await client.query("BEGIN")
      const claim = await client.query(
        `UPDATE form_links SET used_at = now() WHERE token = $1 AND used_at IS NULL RETURNING token`,
        [token]
      )
      if (claim.rowCount === 0) {
        await client.query("ROLLBACK").catch(() => {})
        return NextResponse.json({ error: "This application link has already been used." }, { status: 410 })
      }

      const insertRes = await client.query(
        `INSERT INTO loan_applications
           (lead_id, customer_name, city, loan_type, loan_amount, loan_tenure, email,
            address, whatsapp_number, employment_type, monthly_income, pan_number,
            form_data, submitted_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),$14)
         RETURNING *`,
        [
          link.lead_id,
          capStr(customer_name, 200),
          capStr(city, 120),
          capStr(loan_type, 80) || "Home",
          loan_amount ? Number(loan_amount) : null,
          loan_tenure ? Number(loan_tenure) : null,
          capStr(email, 200),
          capStr(address, 500),
          capStr(whatsapp_number, 20),
          capStr(employment_type, 80),
          monthly_income ? Number(monthly_income) : null,
          pan || null,
          formData,
          "pending",
        ]
      )
      app = insertRes.rows[0]

      if (link.lead_id) {
        // Backfill what the application told us onto the lead itself, so the
        // Leads table (VALUE, ADDRESS, LOAN TYPE columns) reflects the
        // submitted application instead of showing "—" forever.
        const backfill: Record<string, any> = {
          form_completed: true,
          status: "qualified",
          updated_at: new Date().toISOString(),
        }
        if (loan_amount && Number(loan_amount) > 0) backfill.loan_amount = Number(loan_amount)
        if (address) backfill.address = address
        else if (city) backfill.address = city
        if (whatsapp_number) backfill.whatsapp_number = whatsapp_number
        if (loan_type) backfill.product_interest = /loan|insurance|card/i.test(loan_type) ? loan_type : `${loan_type} Loan`
        await client.query(
          `UPDATE leads SET form_completed = $2, status = $3, updated_at = $4,
             loan_amount = COALESCE($5, loan_amount),
             address = COALESCE($6, address),
             whatsapp_number = COALESCE($7, whatsapp_number),
             product_interest = COALESCE($8, product_interest)
           WHERE id = $1`,
          [
            link.lead_id,
            backfill.form_completed,
            backfill.status,
            backfill.updated_at,
            backfill.loan_amount ?? null,
            backfill.address ?? null,
            backfill.whatsapp_number ?? null,
            backfill.product_interest ?? null,
          ]
        )
      }
      await client.query("COMMIT")
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {})
      throw e
    } finally {
      client.release()
    }

    createNotification({
      type: "loan_application",
      title: "New loan application",
      body: `${customer_name} — ${loan_type || "Home Loan"}${loan_amount ? `, ₹${Number(loan_amount).toLocaleString("en-IN")}` : ""}`,
      linkView: "loans",
    })

    // Email confirmation — fire-and-forget, never blocks the response.
    if (email && isMailConfigured()) {
      sendApplicationConfirmation({
        to: email,
        name: customer_name,
        loanType: loan_type || "Home",
        applicationId: app?.id || token,
      })
        .then((r) => {
          if (r.ok && link.lead_id) {
            return query(
              `INSERT INTO comm_logs (lead_id, type, summary, outcome) VALUES ($1, 'email', $2, 'sent')`,
              [link.lead_id, `Application confirmation emailed to ${email}`]
            )
          }
        })
        .catch((e) => console.error("confirmation email error:", e.message))
    }

    return NextResponse.json(app)
  } catch (e: any) {
    return apiError(e)
  }
}
