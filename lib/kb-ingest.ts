// Knowledge base ingestion — CSV bulk-import, PDF text extraction (chunked),
// and URL fetch+extract. Kept as pure functions (no DB writes here) so the
// API routes stay in charge of validation, auth, and insert logic.

import { PDFParse } from "pdf-parse"
import * as cheerio from "cheerio"

export type ParsedKbEntry = { title: string; content: string; category?: string }

// ---------------------------------------------------------------------------
// CSV — same flexible-header-matching spirit as app/api/upload/route.ts's
// lead CSV import, adapted for title/content/category columns.
// ---------------------------------------------------------------------------
export function parseCsvToEntries(text: string): ParsedKbEntry[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  // Minimal CSV split — good enough for simple exports; a quoted field
  // containing a literal comma would need a real CSV parser, out of scope
  // for a first cut of this feature.
  const splitRow = (row: string) => row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))

  const headers = splitRow(lines[0]).map((h) => h.toLowerCase())
  const rows = lines.slice(1)
  const entries: ParsedKbEntry[] = []

  for (const row of rows) {
    const cols = splitRow(row)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = cols[i] ?? "" })

    const title = obj.title || obj.question || obj.q || ""
    const content = obj.content || obj.answer || obj.a || ""
    const category = obj.category || obj.cat || undefined
    if (!title || !content) continue
    entries.push({ title: title.slice(0, 200), content: content.slice(0, 4000), category })
  }
  return entries
}

// ---------------------------------------------------------------------------
// PDF — pdf-parse v2's PDFParse class, buffer input, text extraction only
// (no images/tables — this is a text knowledge base, not a document store).
// ---------------------------------------------------------------------------
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return result.text || ""
  } finally {
    await parser.destroy()
  }
}

/**
 * Splits extracted text into entry-sized chunks on paragraph boundaries
 * where possible, falling back to a hard cut if a single paragraph is
 * itself too long. One knowledge_base row per chunk — a whole PDF isn't
 * one atomic fact, and the search ranks better against smaller chunks.
 */
export function chunkText(text: string, chunkSize = 1500): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ""

  for (const para of paragraphs) {
    if (para.length > chunkSize) {
      if (current) { chunks.push(current); current = "" }
      for (let i = 0; i < para.length; i += chunkSize) chunks.push(para.slice(i, i + chunkSize))
      continue
    }
    if ((current + " " + para).length > chunkSize) {
      if (current) chunks.push(current)
      current = para
    } else {
      current = current ? `${current} ${para}` : para
    }
  }
  if (current) chunks.push(current)
  return chunks.filter((c) => c.length > 20) // drop trivial fragments (page numbers, stray headers)
}

// ---------------------------------------------------------------------------
// URL — fetch + strip to readable text. Regex-based HTML stripping is
// fragile (nested tags, entities), so this uses cheerio for a real DOM
// parse instead — strips script/style/nav/footer, keeps the rest.
// ---------------------------------------------------------------------------
export async function fetchAndExtractUrl(url: string): Promise<{ title: string; content: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RightAgentGroupBot/1.0)" },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`)
  const html = await res.text()

  const $ = cheerio.load(html)
  $("script, style, nav, footer, header, noscript, svg, iframe").remove()
  const title = $("title").first().text().trim() || url
  const bodyText = $("body").text().replace(/\s+/g, " ").trim()
  if (!bodyText) throw new Error("No readable text content found on that page")

  return { title: title.slice(0, 200), content: bodyText.slice(0, 8000) }
}
