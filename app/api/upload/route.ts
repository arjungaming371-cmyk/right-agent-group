import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"

// STEP 1: Upload + PARSE ONLY — does NOT call anyone automatically.
// Creates leads + queues them as "pending". Use /api/upload/confirm to trigger calls.
export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "upload", ["admin", "branch_manager"])

  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // Uploaded leads + the file record belong to the session's active branch.
  const branchId = sessionBranchId(session)
  const formData = await req.formData()
  const file = formData.get("file") as File | null
  const type = formData.get("type") as string ?? "contacts"

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

  const text = await file.text()
  const filename = file.name

  if (type === "contacts" && (filename.endsWith(".csv") || filename.endsWith(".txt"))) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) return NextResponse.json({ error: "CSV has no data rows" }, { status: 400 })

    const headers = lines[0].toLowerCase().split(",").map(h => h.trim().replace(/"/g, ""))
    const rows = lines.slice(1)
    const rowCount = rows.length

    const { data: uploadRecord } = await db.from("uploaded_files").insert({
      filename, type, row_count: rowCount, processed: 0, status: "pending_review", branch_id: branchId, uploaded_by: session.email
    }).select().single()

    const parsedContacts: any[] = []
    let created = 0

    for (const row of rows) {
      const cols = row.split(",").map(c => c.trim().replace(/"/g, ""))
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = cols[i] ?? "" })

      const name    = obj.name || obj["full name"] || obj["customer name"] || "Unknown"
      const phone   = normalizePhone(obj.phone || obj["phone number"] || obj.mobile || "")
      const lang    = obj.language || obj.lang || "telugu"
      const product = obj.product_interest || obj.product || "Home Loan"
      const notes   = obj.notes || obj.note || ""

      if (!phone) continue

      try {
        // Dedupe on last-10 digits — re-uploading a CSV (or a contact that
        // already called in) must not create a second lead row.
        const existing = await query(`SELECT id FROM leads WHERE ${PHONE_MATCH_SQL} LIMIT 1`, [phoneLast10(phone)])
        let lead = existing.rows[0] || null
        if (!lead) {
          const created = await db.from("leads").insert({
            name, phone, language: lang, product_interest: product,
            notes, source: "CSV Upload", status: "new", branch_id: branchId
          }).select().single()
          lead = created.data
        }

        // Queue as PENDING — NOT called yet, waits for explicit confirmation
        await db.from("outbound_queue").insert({
          name, phone, language: lang, product_interest: product, notes,
          status: "pending", lead_id: lead?.id ?? null, branch_id: branchId
        })

        parsedContacts.push({ name, phone, language: lang, product_interest: product, leadId: lead?.id })
        created++
      } catch (e) {
        console.error(`Failed to process CSV row for ${phone}:`, e)
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
      message: `${created} leads created and queued. Review and click "Start Calling Campaign" to begin AI calls.`,
    })
  }

  if (type === "script") {
    await db.from("uploaded_files").insert({ filename, type: "script", row_count: 0, processed: 0, status: "done", branch_id: branchId, uploaded_by: session.email })
    return NextResponse.json({ ok: true, rowCount: 0 })
  }

  return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
}
