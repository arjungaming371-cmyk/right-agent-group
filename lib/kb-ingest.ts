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
//
// SSRF guard (2026-09 security pass): the URL comes from a logged-in user,
// and the server this runs on often holds credentials / metadata endpoints
// (169.254.169.254, localhost services, RFC1918 ranges). Block those before
// any request goes out, and cap how much of the response we read.
// ---------------------------------------------------------------------------
const BLOCKED_HOSTNAMES = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]",
  "metadata.google.internal", "instance-data", "169.254.169.254",
])

function isPrivateIp(host: string): boolean {
  // IPv4 literal ranges: loopback / RFC1918 / link-local / CGNAT / 0.0.0.0
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  // IPv6: loopback, link-local (fe80::/10), unique-local (fc00::/7)
  const h = host.toLowerCase()
  return h === "::1" || h.startsWith("fe8") || h.startsWith("fe9") ||
    h.startsWith("fea") || h.startsWith("feb") || h.startsWith("fc") || h.startsWith("fd")
}

export async function fetchAndExtractUrl(url: string): Promise<{ title: string; content: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("Invalid URL")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported")
  }
  const host = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || isPrivateIp(host)) {
    throw new Error("That URL is not allowed — internal/private network addresses are blocked")
  }

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RightAgentGroupBot/1.0)" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  })
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`)

  // Read the body with a hard byte cap — a hostile/huge page must not be
  // able to OOM the server by streaming gigabytes into res.text().
  const MAX_BYTES = 5 * 1024 * 1024
  const reader = res.body?.getReader()
  let html = ""
  if (reader) {
    const decoder = new TextDecoder("utf-8", { fatal: false })
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_BYTES) {
        try { await reader.cancel() } catch { /* stream already closed */ }
        break
      }
      html += decoder.decode(value, { stream: true })
    }
    html += decoder.decode()
  }

  const $ = cheerio.load(html)
  $("script, style, nav, footer, header, noscript, svg, iframe").remove()
  const title = $("title").first().text().trim() || url
  const bodyText = $("body").text().replace(/\s+/g, " ").trim()
  if (!bodyText) throw new Error("No readable text content found on that page")

  return { title: title.slice(0, 200), content: bodyText.slice(0, 8000) }
}
