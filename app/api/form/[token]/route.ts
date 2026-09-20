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

  const { data: lead } = await db.from("leads").select("*").eq("id", link.lead_id).single()
  return NextResponse.json({
    valid: true,
    used: !!link.used_at,
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

  try {
    // 2026-09 fix: the whole claim → application-insert → lead-backfill is
    // now ONE transaction. Previously the token claim was atomic, but a crash
    // between the claim and the application insert burned the one-time link
    // (used_at set, application lost) and the customer needed a re-send.
    // Inside the transaction, any failure rolls the claim back too.
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
          customer_name,
          city,
          loan_type || "Home",
          loan_amount ? Number(loan_amount) : null,
          loan_tenure ? Number(loan_tenure) : null,
          email,
          address,
          whatsapp_number,
          employment_type,
          monthly_income ? Number(monthly_income) : null,
          pan_number ? String(pan_number).toUpperCase() : null,
          JSON.stringify(rest),
          "pending",
        ]
      )
      app = insertRes.rows[0]

      if (link.lead_id) {
        // Backfill what the application told us onto the lead itself, so the
        // Leads table (VALUE, ADDRESS, LOAN TYPE columns) reflects the
        // submitted application instead of showing "—" forever.
        await client.query(
          `UPDATE leads SET
             form_completed = true,
             status = 'qualified',
             updated_at = now(),
             loan_amount = COALESCE($2, loan_amount),
             address = COALESCE(NULLIF($3, ''), NULLIF($4, ''), address),
             whatsapp_number = COALESCE($5, whatsapp_number),
             product_interest = COALESCE($6, product_interest)
           WHERE id = $1`,
          [
            link.lead_id,
            loan_amount && Number(loan_amount) > 0 ? Number(loan_amount) : null,
            address || "",
            city || "",
            whatsapp_number || null,
            loan_type ? (/loan|insurance|card/i.test(loan_type) ? loan_type : `${loan_type} Loan`) : null,
          ]
        )
      }

      await client.query("COMMIT")
    } catch (txnError) {
      await client.query("ROLLBACK").catch(() => {})
      throw txnError
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
