import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { parseCsvToEntries } from "@/lib/kb-ingest"

// POST — bulk-import knowledge base entries from a CSV file.
// Expected columns (case-insensitive, flexible naming): title/question/q,
// content/answer/a, category (optional).
export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "knowledge", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const formData = await req.formData().catch(() => null)
  const file = formData?.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
  if (!file.name.toLowerCase().endsWith(".csv") && !file.name.toLowerCase().endsWith(".txt")) {
    return NextResponse.json({ error: "Only .csv or .txt files are supported" }, { status: 400 })
  }

  // FIX (2026-09-20): the upload had NO size cap (the PDF route caps at 15 MB;
  // this one trusted nginx's 25 MB) and issued ONE INSERT PER ROW — a large
  // CSV held the request for minutes and hammered the 25-connection pool
  // (easy DoS of the whole DB-backed app). Cap size + rows, batch inserts.
  const MAX_CSV_BYTES = 5 * 1024 * 1024
  if (file.size > MAX_CSV_BYTES) {
    return NextResponse.json({ error: "CSV too large (max 5 MB)" }, { status: 413 })
  }
  const text = await file.text()
  const entries = parseCsvToEntries(text).slice(0, 5000)
  if (entries.length === 0) {
    return NextResponse.json({ error: "No valid rows found — need title/question and content/answer columns" }, { status: 400 })
  }

  const rows = entries.map((entry) => ({
    title: entry.title,
    content: entry.content,
    category: entry.category || null,
    source_type: "csv",
    source_filename: file.name,
    created_by: session.email,
  }))
  let created = 0
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error, data } = await db.from("knowledge_base").insert(rows.slice(i, i + CHUNK))
    if (!error) created += Array.isArray(data) ? data.length : Math.min(CHUNK, rows.length - i)
  }

  logAudit("knowledge base CSV imported", session.email, { filename: file.name, rows: entries.length, created })
  return NextResponse.json({ ok: true, created, total: entries.length })
}
