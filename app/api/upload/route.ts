import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

// STEP 1: Upload + PARSE ONLY — does NOT call anyone automatically.
// Creates leads + queues them as "pending". Use /api/upload/confirm to trigger calls.
export async function POST(req: NextRequest) {
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
      filename, type, row_count: rowCount, processed: 0, status: "pending_review"
    }).select().single()

    const parsedContacts: any[] = []
    let created = 0

    for (const row of rows) {
      const cols = row.split(",").map(c => c.trim().replace(/"/g, ""))
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = cols[i] ?? "" })

      const name    = obj.name || obj["full name"] || obj["customer name"] || "Unknown"
      const phone   = obj.phone || obj["phone number"] || obj.mobile || ""
      const lang    = obj.language || obj.lang || "english"
      const product = obj.product_interest || obj.product || "Home Loan"
      const notes   = obj.notes || obj.note || ""

      if (!phone) continue

      try {
        const { data: lead } = await db.from("leads").insert({
          name, phone, language: lang, product_interest: product,
          notes, source: "CSV Upload", status: "new"
        }).select().single()

        // Queue as PENDING — NOT called yet, waits for explicit confirmation
        await db.from("outbound_queue").insert({
          name, phone, language: lang, product_interest: product, notes,
          status: "pending", lead_id: lead?.id ?? null
        })

        parsedContacts.push({ name, phone, language: lang, product_interest: product, leadId: lead?.id })
        created++
      } catch {}
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
    await db.from("uploaded_files").insert({ filename, type: "script", row_count: 0, processed: 0, status: "done" })
    return NextResponse.json({ ok: true, rowCount: 0 })
  }

  return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
}
