import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  if (searchParams.get("count")) {
    const { count } = await db.from("leads").select("*", { count: "exact", head: true })
    return NextResponse.json({ count: count ?? 0 })
  }

  const search = searchParams.get("search")
  const age = searchParams.get("age") // "new" | "old"
  const amount = searchParams.get("amount") // "high" | "low"
  const loanType = searchParams.get("loanType")
  const interested = searchParams.get("interested") // "interested" | "not_interested" | "unknown"

  const where: string[] = []
  const params: any[] = []
  let i = 1

  if (search) {
    // Phone/name stay ILIKE (partial-digit and partial-name matches need
    // substring, not tokenized, matching). Full-text search additionally
    // covers address, product interest, and notes — so "term insurance" or
    // a street/area name now finds leads that plain ILIKE on name/phone
    // never could.
    where.push(`(name ILIKE $${i} OR phone ILIKE $${i} OR search_vector @@ websearch_to_tsquery('english', $${i + 1}))`)
    params.push(`%${search}%`, search)
    i += 2
  }
  if (loanType && loanType !== "all") {
    where.push(`product_interest = $${i}`)
    params.push(loanType)
    i++
  }
  if (interested && interested !== "all") {
    where.push(`interested = $${i}`)
    params.push(interested)
    i++
  }
  if (age === "new") where.push(`created_at > now() - interval '7 days'`)
  if (age === "old") where.push(`created_at <= now() - interval '7 days'`)
  if (amount === "high") where.push(`loan_amount >= 1000000`)
  if (amount === "low") where.push(`loan_amount < 1000000 AND loan_amount IS NOT NULL`)

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  try {
    // Latest form link per lead rides along so the dashboard can show
    // exactly what was WhatsApped after a call — and whether it was used.
    //
    // SORT: pinned leads always first (most recently pinned first), then by
    // last real activity — a call, a WhatsApp message, or creation, whichever
    // is newest — NOT score. Score-first sorting buried brand-new leads
    // (score starts at 0) and returning callers/WhatsApp senders behind old
    // high-score leads that hadn't been touched in weeks.
    const res = await query(
      `SELECT leads.*, fl.form_token, fl.form_used_at, fl.form_sent_at
       FROM leads
       LEFT JOIN LATERAL (
         SELECT token AS form_token, used_at AS form_used_at, created_at AS form_sent_at
         FROM form_links
         WHERE form_links.lead_id = leads.id
         ORDER BY created_at DESC LIMIT 1
       ) fl ON true
       LEFT JOIN LATERAL (
         SELECT MAX(created_at) AS last_wa_at
         FROM whatsapp_messages
         WHERE whatsapp_messages.lead_id = leads.id
       ) wa ON true
       ${whereClause}
       ORDER BY
         leads.pinned DESC,
         leads.pinned_at DESC NULLS LAST,
         GREATEST(leads.created_at, COALESCE(leads.last_called_at, leads.created_at), COALESCE(wa.last_wa_at, leads.created_at)) DESC`,
      params
    )
    return NextResponse.json(res.rows)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  if (!body.phone) return NextResponse.json({ error: "phone required" }, { status: 400 })
  // Store every phone the same way (+91XXXXXXXXXX) so calls/WhatsApp/manual
  // entries for the same person always land on the same lead.
  body.phone = normalizePhone(body.phone)

  // Dedupe: one lead per phone number, matched on the last 10 digits so
  // format differences never create a duplicate row.
  try {
    const existing = await query(`SELECT id FROM leads WHERE ${PHONE_MATCH_SQL}`, [phoneLast10(body.phone)])
    if (existing.rows.length > 0) {
      const id = existing.rows[0].id
      const { data, error } = await db.from("leads").update({ ...body, updated_at: new Date().toISOString() }).eq("id", id).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      logAudit("lead updated (via dedupe)", session.email, { leadId: id, phone: body.phone })
      return NextResponse.json(data)
    }

    const { data, error } = await db.from("leads").insert(body).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    logAudit("lead created", session.email, { leadId: data?.id, name: body.name, phone: body.phone })
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, ...updates } = await req.json()
  const { data, error } = await db.from("leads").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  logAudit("lead updated", session.email, { leadId: id, fields: Object.keys(updates) })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  const { error } = await db.from("leads").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  logAudit("lead deleted", session.email, { leadId: id })
  return NextResponse.json({ ok: true })
}
