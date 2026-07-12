import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireRole } from "@/lib/auth"

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
    where.push(`(name ILIKE $${i} OR phone ILIKE $${i})`)
    params.push(`%${search}%`)
    i++
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
    const res = await query(
      `SELECT leads.*, fl.form_token, fl.form_used_at, fl.form_sent_at
       FROM leads
       LEFT JOIN LATERAL (
         SELECT token AS form_token, used_at AS form_used_at, created_at AS form_sent_at
         FROM form_links
         WHERE form_links.lead_id = leads.id
         ORDER BY created_at DESC LIMIT 1
       ) fl ON true
       ${whereClause} ORDER BY score DESC, leads.created_at DESC`,
      params
    )
    return NextResponse.json(res.rows)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireRole(req, ["admin", "agent"]))) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  if (!body.phone) return NextResponse.json({ error: "phone required" }, { status: 400 })

  // Dedupe: one lead per phone number. Repeated calls/imports update the
  // existing lead instead of creating a duplicate row.
  try {
    const existing = await query(`SELECT id FROM leads WHERE phone = $1`, [body.phone])
    if (existing.rows.length > 0) {
      const id = existing.rows[0].id
      const { data, error } = await db.from("leads").update({ ...body, updated_at: new Date().toISOString() }).eq("id", id).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json(data)
    }

    const { data, error } = await db.from("leads").insert(body).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await requireRole(req, ["admin", "agent"]))) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, ...updates } = await req.json()
  const { data, error } = await db.from("leads").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  if (!(await requireRole(req, ["admin", "agent"]))) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  const { error } = await db.from("leads").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
