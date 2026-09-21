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

// ---------------------------------------------------------------------------
// SSRF GUARD (2026-09-20 rewrite). The old check compared the HOSTNAME STRING
// against a blocklist and then called fetch(redirect:"follow") — four bypasses:
//   1. DNS name → internal IP (evil.com A-record 169.254.169.254)
//   2. redirects followed with zero re-checks (302 → http://127.0.0.1:5432)
//   3. IPv4-mapped IPv6 literals ([::ffff:169.254.169.254])
//   4. hex/octal/decimal IP literals (http://0xa9fea9fe/, http://2852039166/)
// Now: every IP literal is normalized before checks, hostnames are RESOLVED
// and every resolved address validated, and redirects are followed manually
// with the full check re-run per hop.
// ---------------------------------------------------------------------------
import dns from "dns/promises"

/** Normalize an IPv4 literal that may be in hex (0x…), octal (0…), decimal, or dotted forms. */
function normalizeIpv4Literal(host: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host
  if (/^\d+$/.test(host) || /^0[xX][0-9a-fA-F]+$/.test(host)) {
    const n = host.toLowerCase().startsWith("0x") ? parseInt(host.slice(2), 16) : parseInt(host, 10)
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return null
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".")
  }
  // Partial dotted forms: "127.1" → 127.0.0.1, "0x7f.1" etc. Reject anything
  // with hex/octal components instead of guessing — simpler and safe.
  if (/^[0-9.]+$/.test(host) && host.includes(".")) return null // non-canonical dotted → reject (can't be a public domain)
  return null
}

function isPrivateIpv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return true // not a valid dotted quad → treat as private (fail closed)
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)]
  const last = parseInt(m[4], 10)
  if (a === 127 || a === 10 || a === 0 || a === 169 || a === 192) return true // loopback / RFC1918 / 0.x / link-local / 192.0-192.255 conservative
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 192 && b === 168) return true
  if (a >= 224) return true // multicast/reserved
  if (a === 192 && b === 0 && (last === 0 || last === 2)) return true
  return false
}

function isPrivateIpv6(h: string): boolean {
  const host = h.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "::" || host === "::1") return true
  // IPv4-mapped IPv6 ::ffff:0:0/96 — dials the embedded IPv4 address.
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isPrivateIpv4(mapped[1])
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16)
    return isPrivateIpv4(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`)
  }
  if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) return true // link-local
  if (host.startsWith("fc") || host.startsWith("fd")) return true // unique-local
  if (host.startsWith("ff")) return true // multicast
  return false
}

function isPrivateIp(host: string): boolean {
  const v4 = normalizeIpv4Literal(host)
  if (v4) return isPrivateIpv4(v4)
  if (host.includes(":")) return isPrivateIpv6(host)
  return false // hostnames are validated via DNS resolution below
}

async function assertPublicHost(host: string): Promise<void> {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (BLOCKED_HOSTNAMES.has(h) || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    throw new Error("That URL is not allowed — internal/private network addresses are blocked")
  }
  const v4 = normalizeIpv4Literal(h)
  if (v4) {
    if (isPrivateIpv4(v4)) throw new Error("That URL is not allowed — internal/private network addresses are blocked")
    return
  }
  if (h.includes(":")) {
    if (isPrivateIpv6(h)) throw new Error("That URL is not allowed — internal/private network addresses are blocked")
    return
  }
  // Real hostname: resolve it and validate EVERY address the OS could dial.
  // This kills DNS-rebinding / "my domain points at 10.0.0.5" bypasses.
  let addrs: { address: string; family: number }[]
  try {
    addrs = await dns.lookup(h, { all: true, verbatim: true })
  } catch {
    throw new Error("Could not resolve that hostname")
  }
  for (const a of addrs) {
    if (a.family === 4 ? isPrivateIpv4(a.address) : isPrivateIpv6(a.address)) {
      throw new Error("That URL is not allowed — it resolves to an internal/private address")
    }
  }
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
  await assertPublicHost(parsed.hostname)

  // Manual redirect loop — each hop re-runs the full scheme + host + resolved-IP
  // check (the old redirect:"follow" fetched attacker 302 targets blindly).
  const MAX_HOPS = 3
  let current: URL = parsed
  let res: Response | null = null
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const step = await fetch(current.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RightAgentGroupBot/1.0)" },
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    })
    if (step.status >= 300 && step.status < 400) {
      const loc = step.headers.get("location")
      try { await step.body?.cancel() } catch {}
      if (!loc) throw new Error(`Fetch failed: HTTP ${step.status} (redirect without Location)`)
      if (hop === MAX_HOPS) throw new Error("Too many redirects")
      const next = new URL(loc, current) // relative redirects resolved here
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new Error("Only http(s) URLs are supported")
      }
      await assertPublicHost(next.hostname) // re-validate EVERY hop
      current = next
      continue
    }
    res = step
    break
  }
  if (!res) throw new Error("Too many redirects")
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
