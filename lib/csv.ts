// Minimal CSV encoder — no dependency needed for straightforward tabular exports.
//
// 2026-09 hardening:
// 1. FORMULA INJECTION: customer-controlled values (name, address, notes...)
//    flow into exports your team opens in Excel/Google Sheets. A cell starting
//    with = + - @ (or tab/CR) executes as a formula — e.g. a lead named
//    "=HYPERLINK(...)" or "=cmd|..." becomes live code in the operator's
//    spreadsheet. Guard: prefix a single quote (the standard Excel-safe
//    neutralizer) on dangerous leading characters.
// 2. UTF-8 BOM: without it, Excel decodes the file as cp1252 and every
//    Hindi/Telugu name in the data garbles. toCsv now emits \uFEFF first;
//    BOM-aware readers strip it automatically.

function escapeCell(value: any): string {
  if (value === null || value === undefined) return ""
  const s = value instanceof Date ? value.toISOString() : String(value)
  // Quote if it contains a comma, quote, or newline; double up any internal quotes.
  const quoted = /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  // Formula-injection guard: neutralize spreadsheet-formula triggers.
  return /^[=+\-@\t\r]/.test(quoted) ? `'${quoted}` : quoted
}

export function toCsv(rows: Record<string, any>[], columns: string[]): string {
  const header = columns.map(escapeCell).join(",")
  const body = rows.map(row => columns.map(col => escapeCell(row[col])).join(","))
  return "\uFEFF" + [header, ...body].join("\r\n")
}

// ---------------------------------------------------------------------------
// PARSING side — RFC4180-aware single-line splitter.
//
// The lead CSV upload used to do a naive `row.split(",")`, which silently
// corrupted every contact whose field contains a comma: `name` "Rao, Kumar"
// spilled into `phone`, "Hyderabad, Telangana" into `language`, and the row
// was then either rejected as junk or (worse) queued with a mangled number.
// Excel / Google Sheets quote such cells with doubled internal quotes —
// this splitter honors exactly that quoting. Handles a stray UTF-8 BOM in
// the header cell ("\uFEFFname" used to never match the `name` column).
// ---------------------------------------------------------------------------
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } // escaped quote ""
        else inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      out.push(cur.trim())
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  // Strip the BOM from the first cell (only meaningful for line 1, but
  // harmless elsewhere — no real contact field starts with \uFEFF).
  if (out.length > 0) out[0] = out[0].replace(/^\uFEFF/, "")
  return out
}
