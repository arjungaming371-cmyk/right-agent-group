import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { parseCsvToEntries } from "@/lib/kb-ingest"

// POST — bulk-import knowledge base entries from a CSV file.
// Expected columns (case-insensitive, flexible naming): title/question/q,
// content/answer/a, category (optional).
export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const formData = await req.formData().catch(() => null)
  const file = formData?.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
  if (!file.name.toLowerCase().endsWith(".csv") && !file.name.toLowerCase().endsWith(".txt")) {
    return NextResponse.json({ error: "Only .csv or .txt files are supported" }, { status: 400 })
  }

  const text = await file.text()
  const entries = parseCsvToEntries(text)
  if (entries.length === 0) {
    return NextResponse.json({ error: "No valid rows found — need title/question and content/answer columns" }, { status: 400 })
  }

  let created = 0
  for (const entry of entries) {
    const { error } = await db.from("knowledge_base").insert({
      title: entry.title,
      content: entry.content,
      category: entry.category || null,
      source_type: "csv",
      source_filename: file.name,
      created_by: session.email,
    })
    if (!error) created++
  }

  logAudit("knowledge base CSV imported", session.email, { filename: file.name, rows: entries.length, created })
  return NextResponse.json({ ok: true, created, total: entries.length })
}
