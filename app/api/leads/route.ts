import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db, query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"

// leads.lead_code only exists once migrations/2026-07-31_lead_code.sql has
// been applied. Naming a missing column in the WHERE clause makes Postgres
// reject the whole statement, so deploying this code before running the
// migration would turn every lead search into a 500 — searching is the one
// thing staff do constantly, so it has to keep working either way.
//
// Probe once and cache only the positive result: if the column is missing we
// re-check on the next search, so search-by-code starts working the moment
// the migration is applied, with no redeploy or restart.
let _hasLeadCode = false
async function hasLeadCodeColumn(): Promise<boolean> {
  if (_hasLeadCode) return true
  try {
    const r = await query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'leads' AND column_name = 'lead_code' LIMIT 1`
    )
    _hasLeadCode = r.rows.length > 0
  } catch {
    _hasLeadCode = false
  }
  return _hasLeadCode
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const search = searchParams.get("search")
  const age = searchParams.get("age") // "new" | "old"
  const amount = searchParams.get("amount") // "high" | "low"
  const loanType = searchParams.get("loanType")
  const interested = searchParams.get("interested") // "interested" | "not_interested" | "unknown"

  // Multi-branch scoping: branch-bound sessions only ever see their own
  // branch's leads (NULL branch = HQ data stays admin-only).
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  // FIX (2026-09-20): the count branch used to run BEFORE the auth check and
  // without any branch filter — middleware was its only protection, and
  // branch users got the whole-company count. Auth + scope come first now.
  if (searchParams.get("count")) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count FROM leads WHERE ($1::uuid IS NULL OR branch_id = $1)`,
      [branchId]
    )
    return NextResponse.json({ count: rows[0]?.count ?? 0 })
  }

  const where: string[] = []
  const params: any[] = []
  let i = 1

  // FIX (2026-09-20): the list query had NO LIMIT and this route is polled
  // every 15s by the dashboard (and re-fetched by the voice-logs view) — on a
  // large table every poll shipped the entire table with two LATERAL joins
  // per row. Cap the page; the UI's search/filter still narrows server-side.
  const rawLimit = parseInt(searchParams.get("limit") || "", 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200

  if (branchId) {
    where.push(`leads.branch_id = $${i}`)
    params.push(branchId)
    i++
  }

  if (search) {
    // Phone/name/lead_code stay ILIKE (partial-digit and partial-name matches
    // need substring, not tokenized, matching). Full-text search additionally
    // covers address, product interest, and notes — so "term insurance" or
    // a street/area name now finds leads that plain ILIKE on name/phone
    // never could.
    //
    // lead_code is matched as a substring so all of "RAG-0042", "0042", and
    // "42" find the same lead — staff read these out over the phone and will
    // not type the prefix or the zero padding.
    const codeClause = (await hasLeadCodeColumn()) ? ` OR lead_code ILIKE $${i}` : ""
    where.push(
      `(name ILIKE $${i} OR phone ILIKE $${i}${codeClause} OR search_vector @@ websearch_to_tsquery('english', $${i + 1}) OR word_similarity($${i + 1}, COALESCE(name, '')) > 0.28 OR word_similarity($${i + 1}, COALESCE(address, '')) > 0.28 OR word_similarity($${i + 1}, COALESCE(product_interest, '')) > 0.28)`
    )
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
         GREATEST(leads.created_at, COALESCE(leads.last_called_at, leads.created_at), COALESCE(wa.last_wa_at, leads.created_at)) DESC
       LIMIT $${i}`,
      [...params, limit]
    )
    return NextResponse.json(res.rows)
  } catch (e: any) {
    return apiError(e)
  }
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  if (!body.phone) return NextResponse.json({ error: "phone required" }, { status: 400 })
  // Store every phone the same way (+91XXXXXXXXXX) so calls/WhatsApp/manual
  // entries for the same person always land on the same lead.
  body.phone = normalizePhone(body.phone)
  // FIX (2026-09-20): an unparseable phone must never reach PHONE_MATCH_SQL —
  // with an empty last-10 the old LIKE-'%' predicate matched EVERY lead and
  // the dedupe-update would overwrite an arbitrary one.
  if (!phoneLast10(body.phone)) return NextResponse.json({ error: "valid phone required" }, { status: 400 })

  // FIX (2026-09-20) mass assignment: the raw body used to be spread into the
  // insert/update, letting a crafted payload write ANY leads column (score,
  // lead_code, created_at, pinned, ig_user_id, search_vector…). Allowlist:
  // only these fields are writable through this route.
  const WRITABLE = new Set([
    "name", "phone", "whatsapp_number", "email", "language", "product_interest",
    "loan_amount", "notes", "address", "source", "status", "instagram_handle",
  ])
  const payload: Record<string, unknown> = { branch_id: sessionBranchId(session) }
  for (const [k, v] of Object.entries(body)) {
    if (WRITABLE.has(k)) payload[k] = v
  }

  // Dedupe: one lead per phone number, matched on the last 10 digits so
  // format differences never create a duplicate row.
  try {
    const scope = sessionBranchId(session)
    const existing = await query(
      `SELECT id FROM leads WHERE ${PHONE_MATCH_SQL} AND ($2::uuid IS NULL OR branch_id = $2) LIMIT 1`,
      [phoneLast10(String(payload.phone)), scope]
    )
    if (existing.rows.length > 0) {
      const id = existing.rows[0].id
      // On dedupe-update, do NOT move the lead between branches — the lead
      // belongs to the branch that first captured it. A branch user updating
      // an HQ-owned lead must not silently pull it into their branch.
      // FIX (2026-09-20): the match used to span ALL branches and the update
      // had NO branch predicate — a branch agent could mass-assign any body
      // keys onto ANOTHER branch's lead. Scoped match + branch predicate +
      // WRITABLE allowlist above.
      const { branch_id: _keepOriginalBranch, ...editable } = payload
      let q: any = db.from("leads").update({ ...editable, updated_at: new Date().toISOString() }).eq("id", id)
      if (scope) q = q.eq("branch_id", scope)
      const { data, error } = await q.select().single()
      if (error) return apiError(error)
      logAudit("lead updated (via dedupe)", session.email, { leadId: id, phone: payload.phone })
      return NextResponse.json(data)
    }

    const { data, error } = await db.from("leads").insert(payload).select().single()
    if (error) return apiError(error)
    logAudit("lead created", session.email, { leadId: data?.id, name: payload.name, phone: payload.phone })
    return NextResponse.json(data)
  } catch (e: any) {
    return apiError(e)
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, ...updates } = await req.json()
  delete updates.branch_id // branch moves are an admin action via /api/branches, not a lead edit
  // Branch-scoped users may only update leads inside their branch.
  const branchId = sessionBranchId(session)
  let leadQuery = db.from("leads").update({ ...updates, updated_at: new Date().toISOString() })
  if (branchId) leadQuery = leadQuery.eq("branch_id", branchId)
  const { data, error } = await leadQuery.eq("id", id).select().single()
  if (error) return apiError(error)
  if (!data) return NextResponse.json({ error: "lead not found in your branch" }, { status: 404 })
  logAudit("lead updated", session.email, { leadId: id, fields: Object.keys(updates) })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  const branchId = sessionBranchId(session)
  let delQuery = db.from("leads").delete()
  if (branchId) delQuery = delQuery.eq("branch_id", branchId)
  const { error } = await delQuery.eq("id", id)
  if (error) return apiError(error)
  logAudit("lead deleted", session.email, { leadId: id })
  return NextResponse.json({ ok: true })
}
