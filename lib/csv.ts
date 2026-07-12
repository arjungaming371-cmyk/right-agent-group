// Minimal CSV encoder — no dependency needed for straightforward tabular exports.

function escapeCell(value: any): string {
  if (value === null || value === undefined) return ""
  const s = value instanceof Date ? value.toISOString() : String(value)
  // Quote if it contains a comma, quote, or newline; double up any internal quotes.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, any>[], columns: string[]): string {
  const header = columns.map(escapeCell).join(",")
  const body = rows.map(row => columns.map(col => escapeCell(row[col])).join(","))
  return [header, ...body].join("\r\n")
}
