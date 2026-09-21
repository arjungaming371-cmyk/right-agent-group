import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"
import { apiError } from "@/lib/api-error"

// STEP 1: Upload + PARSE ONLY — does NOT call anyone automatically.
// Creates leads + queues them as "pending". Dialing happens only through
// /api/outbound/process (quota + compliance + atomic claim there).
//
// 2026-09-20 hardening (re-created after the audit pass):
//   * 5 MB / 2000-row caps — the old route read the whole body and looped
//     per row with no ceiling (DoS on the DB pool).
//   * Branch-scoped dedupe — a branch-bound upload no longer silently
//     adopts (and re-queues) another branch's lead by phone match; it
//     creates a branch-local lead instead, mirroring POST /api/leads.
//   * India-only phone validation (+91 10 digits) so junk numbers never
//     become dedupe identities.
// NOTE: the old /api/upload/confirm route (bulk-dial on confirm) is
// deliberately NOT restored — batch calling belongs to /api/outbound/process,
// which enforces quota, DND compliance, and atomic row claiming.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 2000

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "upload", ["admin", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // Uploaded leads + the file record belong to the session's active branch.
  const branchId = sessionBranchId(session)
  const formData = await req.formData()
  const file = formData.get("file") as File | null
  const type = formData.get("type") as string ?? "contacts"

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 })
  }

  const text = await file.text()
  const filename = file.name

  if (type === "contacts" && (filename.endsWith(".csv") || filename.endsWith(".txt"))) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) return NextResponse.json({ error: "CSV has no data rows" }, { status: 400 })

    const headers = lines[0].toLowerCase().split(",").map(h => h.trim().replace(/"/g, ""))
    const rowCount = lines.length - 1
    if (rowCount > MAX_ROWS) {
      return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS}) — split the file and upload again` }, { status: 413 })
    }
    const rows = lines.slice(1, MAX_ROWS + 1)

    const { data: uploadRecord } = await db.from("uploaded_files").insert({
      filename, type, row_count: rowCount, processed: 0, status: "pending_review", branch_id: branchId, uploaded_by: session.email
    }).select().single()

    const parsedContacts: any[] = []
    let created = 0

    for (const row of rows) {
      const cols = row.split(",").map(c => c.trim().replace(/"/g, ""))
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = cols[i] ?? "" })

      const name    = (obj.name || obj["full name"] || obj["customer name"] || "Unknown").slice(0, 200)
      const phone   = normalizePhone(obj.phone || obj["phone number"] || obj.mobile || "")
      const lang    = (obj.language || obj.lang || "telugu").slice(0, 40)
      const product = (obj.product_interest || obj.product || "Home Loan").slice(0, 120)
      const notes   = (obj.notes || obj.note || "").slice(0, 2000)

      // India-only app: require the full +91 10-digit form, same as the
      // public application route — junk like "+12345" must never become a
      // dedupe identity.
      if (!phone || !/^\+91\d{10}$/.test(phone)) continue

      try {
        // Branch-scoped dedupe on last-10 digits: re-uploading a CSV (or a
        // contact that already called in) must not create a second lead row
        // within the branch — and a branch-bound upload must not adopt a
        // lead owned by ANOTHER branch.
        const existing = await query(
          branchId
            ? `SELECT id FROM leads WHERE ${PHONE_MATCH_SQL} AND branch_id = $2 LIMIT 1`
            : `SELECT id FROM leads WHERE ${PHONE_MATCH_SQL} LIMIT 1`,
          branchId ? [phoneLast10(phone), branchId] : [phoneLast10(phone)]
        )
        let lead = existing.rows[0] || null
        if (!lead) {
          const newLead = await db.from("leads").insert({
            name, phone, language: lang, product_interest: product,
            notes, source: "CSV Upload", status: "new", branch_id: branchId
          }).select().single()
          lead = newLead.data
        }

        // Queue as PENDING — NOT called yet, waits for the batch dialer
        // (which enforces quota + DND compliance + atomic claiming).
        await db.from("outbound_queue").insert({
          name, phone, language: lang, product_interest: product, notes,
          status: "pending", lead_id: lead?.id ?? null, branch_id: branchId
        })

        parsedContacts.push({ name, phone, language: lang, product_interest: product, leadId: lead?.id })
        created++
      } catch (e) {
        console.error(`Failed to process CSV row for ${phone.slice(0, 3)}****${phone.slice(-3)}:`, (e as Error).message)
      }
    }

    if (uploadRecord) {
      await db.from("uploaded_files").update({ processed: created, status: "pending_review" }).eq("id", uploadRecord.id)
    }

    return NextResponse.json({
      ok: true,
      rowCount,
      created,
      uploadId: uploadRecord?.id,
      contacts: parsedContacts,
      message: `${created} leads created and queued. Review and use the batch controls below to start AI calls.`,
    })
  }

  if (type === "script") {
    await db.from("uploaded_files").insert({ filename, type: "script", row_count: 0, processed: 0, status: "done", branch_id: branchId, uploaded_by: session.email })
    return NextResponse.json({ ok: true, rowCount: 0 })
  }

  return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
}

// Read-only listing for the upload history card (same module, same roles).
export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "upload", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const branchId = sessionBranchId(session)
  let q = db.from("uploaded_files").select("*")
  if (branchId) q = q.eq("branch_id", branchId)

  const { data } = await q.order("created_at", { ascending: false }).limit(50)
  return NextResponse.json(data ?? [])
}
