import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { extractPdfText, chunkText } from "@/lib/kb-ingest"
import { validateKbEntries } from "@/lib/kb-rules"

const MAX_PDF_BYTES = 15 * 1024 * 1024 // 15MB — plenty for a policy/rate-card PDF, guards against someone uploading a huge scan

// POST — extract text from a PDF and insert one knowledge_base row per
// chunk (a whole document isn't one atomic fact — smaller chunks search better).
export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "knowledge", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const formData = await req.formData().catch(() => null)
  const file = formData?.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only .pdf files are supported" }, { status: 400 })
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "PDF too large (max 15MB)" }, { status: 400 })
  }

  let text: string
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    text = await extractPdfText(buffer)
  } catch (e: any) {
    return NextResponse.json({ error: `Could not read PDF: ${e.message}` }, { status: 400 })
  }
  if (!text.trim()) return NextResponse.json({ error: "No extractable text found in this PDF (might be a scanned image)" }, { status: 400 })

  const chunks = chunkText(text)
  if (chunks.length === 0) return NextResponse.json({ error: "PDF text was too short/fragmentary to import" }, { status: 400 })

  const baseName = file.name.replace(/\.pdf$/i, "")
  const entries = chunks.map((content, i) => ({
    title: chunks.length > 1 ? `${baseName} — part ${i + 1}/${chunks.length}` : baseName,
    content,
  }))

  // 2026-09-30: script-compliance gate. Third-party PDF content: guarantee /
  // OTP-solicitation blocks still apply (a marketing PDF promising
  // "guaranteed approval" must never ground Priya), but contact-coordinate
  // blocks downgrade to warnings — a partner bank's rate card legitimately
  // carries the bank's own helpline numbers.
  const { violations, warnings } = validateKbEntries(entries, { contactAsWarning: true })
  if (violations.length > 0) {
    return NextResponse.json(
      {
        error: "PDF rejected — content violates the call-script compliance rules",
        violationCount: violations.length,
        violations: violations.slice(0, 50),
      },
      { status: 422 }
    )
  }

  let created = 0
  for (let i = 0; i < entries.length; i++) {
    const { error } = await db.from("knowledge_base").insert({
      ...entries[i],
      source_type: "pdf",
      source_filename: file.name,
      created_by: session.email,
    })
    if (!error) created++
  }

  logAudit("knowledge base PDF imported", session.email, { filename: file.name, chunks: chunks.length, created })
  return NextResponse.json({ ok: true, created, chunks: chunks.length, warnings: warnings.slice(0, 20) })
}
