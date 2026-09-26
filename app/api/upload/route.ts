import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { normalizePhone, phoneLast10, PHONE_MATCH_SQL } from "@/lib/phone"
import { apiError } from "@/lib/api-error"
import { splitCsvLine } from "@/lib/csv"
import { parseCsvToEntries, extractPdfText, chunkText } from "@/lib/kb-ingest"
import { logAudit } from "@/lib/audit"

// STEP 1: Upload + PARSE ONLY — creates leads for review, queues NOTHING.
// The dashboard opens the "Review Before Queueing" modal; only the CONFIRM
// (POST /api/outbound with { contacts }) adds rows to the outbound queue,
// and dialing happens only through /api/outbound/process (quota + compliance
// + atomic claim there).
//
// FIX (2026-09-26) — DOUBLE-QUEUE BUG: this route used to insert every
// contact into outbound_queue itself AND the review modal's Confirm then
// queued the SAME contacts again through /api/outbound batch mode. Every
// CSV upload produced two pending rows per person → the batch dialer called
// each customer twice. Queueing now lives in exactly one place (the Confirm),
// and Cancel is honest (nothing was queued behind the agent's back).
//
// Other hardening kept from earlier passes:
//   * 5 MB / 2000-row caps — the old route read the whole body and looped
//     per row with no ceiling (DoS on the DB pool).
//   * Branch-scoped dedupe — a branch-bound upload no longer silently
//     adopts (and re-queues) another branch's lead by phone match; it
//     creates a branch-local lead instead, mirroring POST /api/leads.
//   * India-only phone validation (+91 10 digits) so junk numbers never
//     become dedupe identities.
//   * RFC4180 CSV parsing (quoted commas, "" escapes, BOM) — "Rao, Kumar"
//     no longer shreds a row into name/phone/language.
//
// SCRIPT UPLOADS (2026-09-26) — THE BLACK HOLE FIX: type=script used to
// insert an uploaded_files row and DISCARD the content — the card promised
// "what AI should reference during calls" while Priya never saw a byte.
// Script content now lands in the knowledge_base (the exact store
// searchKnowledgeBase() feeds Priya from on every turn):
//   .csv → title/content/category columns (same contract as the KB importer)
//   .txt → chunked into KB entries
//   .pdf → text-extracted, chunked into KB entries
//   .docx/.doc → rejected with an honest message (no docx extractor in the
//   app — "save as PDF first" instead of a silently ignored upload).
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 2000
const SCRIPT_MAX_KB_ENTRIES = 500

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

  const filename = file.name

  // ── CONTACTS ────────────────────────────────────────────────────────────
  if (type === "contacts") {
    if (!filename.endsWith(".csv") && !filename.endsWith(".txt")) {
      // Excel (.xlsx/.xls) is a ZIP of XML — file.text() would return binary
      // garbage and there is no xlsx parser in the app. Say so instead of
      // the generic "Unsupported file type".
      if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
        return NextResponse.json({
          error: "Excel files are not supported — open the file and use File → Save As → CSV, then upload that",
        }, { status: 400 })
      }
      return NextResponse.json({ error: "Only .csv or .txt files are supported for contacts" }, { status: 400 })
    }

    const text = await file.text()
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) return NextResponse.json({ error: "CSV has no data rows" }, { status: 400 })

    const headers = splitCsvLine(lines[0]).map(h => h.toLowerCase())
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
      const cols = splitCsvLine(row)
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

        parsedContacts.push({ name, phone, language: lang, product_interest: product, leadId: lead?.id })
        created++
      } catch (e) {
        console.error(`Failed to process CSV row for ${phone.slice(0, 3)}****${phone.slice(-3)}:`, (e as Error).message)
      }
    }

    if (uploadRecord) {
      await db.from("uploaded_files").update({ processed: created, status: "pending_review" }).eq("id", uploadRecord.id)
    }

    if (created === 0) {
      return NextResponse.json({
        error: "No valid contacts found — the CSV needs name and phone columns (Indian +91 numbers, 10 digits)",
        rowCount, created: 0, uploadId: uploadRecord?.id,
      }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      rowCount,
      created,
      uploadId: uploadRecord?.id,
      contacts: parsedContacts,
      message: `${created} contacts parsed. Review and confirm to add them to the outbound queue — nothing is dialed yet.`,
    })
  }

  // ── SCRIPT / DOCUMENT → KNOWLEDGE BASE ──────────────────────────────────
  if (type === "script") {
    const lower = filename.toLowerCase()
    if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
      return NextResponse.json({
        error: "Word files are not supported — save the document as PDF (or plain text) and upload that",
      }, { status: 400 })
    }

    let entries: { title: string; content: string; category?: string }[] = []

    if (lower.endsWith(".pdf")) {
      const buf = Buffer.from(await file.arrayBuffer())
      let pdfText = ""
      try {
        pdfText = await extractPdfText(buf)
      } catch (e) {
        return NextResponse.json({ error: `Could not read the PDF: ${(e as Error).message.slice(0, 200)}` }, { status: 400 })
      }
      if (!pdfText.trim()) {
        return NextResponse.json({ error: "The PDF has no extractable text (scanned image PDFs are not readable) — paste the text into a .txt and upload that" }, { status: 400 })
      }
      entries = chunkText(pdfText).map((chunk, i) => ({
        title: `${filename} (part ${i + 1})`,
        content: chunk,
        category: "Call Script",
      }))
    } else if (lower.endsWith(".csv")) {
      const text = await file.text()
      entries = parseCsvToEntries(text)
      if (entries.length === 0) {
        return NextResponse.json({ error: "No valid rows found — script CSVs need title/question and content/answer columns" }, { status: 400 })
      }
      entries = entries.map(e => ({ ...e, category: e.category || "Call Script" }))
    } else if (lower.endsWith(".txt")) {
      const text = await file.text()
      if (!text.trim()) return NextResponse.json({ error: "The file is empty" }, { status: 400 })
      // A short script reads best as ONE entry titled by its filename; long
      // ones get "(part N)" suffixes so the KB stays navigable.
      const chunks = chunkText(text)
      entries = chunks.map((chunk, i) => ({
        title: chunks.length > 1 ? `${filename} (part ${i + 1})` : filename,
        content: chunk,
        category: "Call Script",
      }))
    } else {
      return NextResponse.json({ error: "Only .txt, .csv or .pdf files are supported for scripts" }, { status: 400 })
    }

    if (entries.length === 0) {
      return NextResponse.json({ error: "Nothing readable found in the file" }, { status: 400 })
    }
    entries = entries.slice(0, SCRIPT_MAX_KB_ENTRIES)

    // Insert in chunks — same pattern as the KB bulk importer.
    let created = 0
    const CHUNK = 200
    for (let i = 0; i < entries.length; i += CHUNK) {
      const rows = entries.slice(i, i + CHUNK).map(e => ({
        title: e.title.slice(0, 200),
        content: e.content,
        category: e.category || "Call Script",
        source_type: lower.endsWith(".pdf") ? "pdf" : "csv",
        source_filename: filename,
        created_by: session.email,
      }))
      const { error } = await db.from("knowledge_base").insert(rows)
      if (!error) created += rows.length
    }

    await db.from("uploaded_files").insert({
      filename, type: "script", row_count: entries.length, processed: created,
      status: created > 0 ? "done" : "failed", branch_id: branchId, uploaded_by: session.email
    })

    logAudit("script uploaded to knowledge base", session.email, { filename, entries: entries.length, created })

    return NextResponse.json({
      ok: true,
      rowCount: entries.length,
      created,
      message: `Script stored in the Knowledge Base (${created} entries) — Priya references it automatically on calls.`,
    })
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
