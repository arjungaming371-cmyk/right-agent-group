import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { fetchAndExtractUrl } from "@/lib/kb-ingest"

// POST — fetch a URL, extract readable text, and upsert ONE knowledge_base
// entry keyed by source_url. Calling this again on the same URL (the
// dashboard's "Refresh" button) updates the existing entry in place
// instead of creating a duplicate.
export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const url = typeof body.url === "string" ? body.url.trim() : ""
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "a valid http(s) URL is required" }, { status: 400 })
  }

  let extracted: { title: string; content: string }
  try {
    extracted = await fetchAndExtractUrl(url)
  } catch (e: any) {
    return NextResponse.json({ error: `Could not fetch that page: ${e.message}` }, { status: 400 })
  }

  const existing = await query(`SELECT id FROM knowledge_base WHERE source_url = $1 LIMIT 1`, [url])
  let row
  if (existing.rows.length > 0) {
    const res = await query(
      `UPDATE knowledge_base SET title = $2, content = $3, last_fetched_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, extracted.title, extracted.content]
    )
    row = res.rows[0]
  } else {
    const res = await query(
      `INSERT INTO knowledge_base (title, content, source_type, source_url, last_fetched_at, created_by)
       VALUES ($1, $2, 'url', $3, now(), $4) RETURNING *`,
      [extracted.title, extracted.content, url, session.email]
    )
    row = res.rows[0]
  }

  logAudit(existing.rows.length > 0 ? "knowledge base URL refreshed" : "knowledge base URL added", session.email, { url })
  return NextResponse.json({ ok: true, entry: row, refreshed: existing.rows.length > 0 })
}
