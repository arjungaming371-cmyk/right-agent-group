// Knowledge-base CSV parsing — pure functions, NO imports (same
// convention as lib/dialer-logic.ts / lib/kb-rules.ts) so test suites and
// the seed script can tsc-compile this exact file and exercise it directly.
//
// 2026-09-30 upgrade: the old parser was a naive `row.split(",")` — a
// comma anywhere inside an entry's content silently mis-aligned every
// column after it (title ok, content truncated at the first comma,
// category made of mid-sentence words, or the row dropped entirely). Now
// RFC4180-lite: double-quoted fields may contain commas/quotes ("" escape),
// flexible header names are unchanged.

export type ParsedKbEntry = { title: string; content: string; category?: string }

/** One CSV row → fields, honoring double-quoted sections. */
export function splitCsvRow(row: string): string[] {
  const fields: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          cur += '"' // escaped quote
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      fields.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields.map((f) => f.trim().replace(/^"|"$/g, ""))
}

/**
 * CSV text → KB entries. Flexible, case-insensitive headers: title/
 * question/q, content/answer/a, category/cat. Rows missing a title or
 * content are skipped (same contract as before).
 */
export function parseCsvToEntries(text: string): ParsedKbEntry[] {
  const rows = splitCsvRows(text)
  if (rows.length < 2) return []

  const headers = rows[0].map((h) => h.toLowerCase())
  const entries: ParsedKbEntry[] = []

  for (const row of rows.slice(1)) {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? ""
    })

    const title = obj.title || obj.question || obj.q || ""
    const content = obj.content || obj.answer || obj.a || ""
    const category = obj.category || obj.cat || undefined
    if (!title || !content) continue
    entries.push({ title: title.slice(0, 200), content: content.slice(0, 4000), category })
  }
  return entries
}

/** Split raw CSV text into rows honoring quoted newlines, then fields. */
export function splitCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ""
  let inQuotes = false

  const endRow = () => {
    row.push(cur)
    cur = ""
    // keep rows that have at least one non-empty field (drops blank lines)
    if (row.some((f) => f.trim() !== "")) rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === "\n") {
      endRow()
    } else if (ch === "\r") {
      // treat \r\n and bare \r as row terminators
      if (text[i + 1] === "\n") i++
      endRow()
    } else if (ch === ",") {
      row.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  if (cur !== "" || row.length > 0) endRow()
  return rows
}
