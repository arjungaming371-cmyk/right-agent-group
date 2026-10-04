"use client"
import React from "react"

/**
 * ChatMarkdown (2026-10-04): the Operations Commander writes markdown, but
 * the chat bubble used to print it as raw text — visible **, #, - symbols and
 * wall-of-text answers. This renderer converts the reply into styled React
 * elements. It is deliberately dependency-free and NEVER injects raw HTML
 * (no dangerouslySetInnerHTML) — model output is untrusted input, so every
 * token becomes a React node.
 *
 * Supported: # headings, **bold**, *italic*, `inline code`, ``` fences,
 * -/* /• bullet lists, 1. ordered lists, > quotes, --- rules, [links](url),
 * and the server's "✅ Figures verified…" badge line (styled as a chip).
 */

const reInline = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  reInline.lastIndex = 0
  while ((m = reInline.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    const key = `${keyPrefix}-${k++}`
    if (t.startsWith("**")) {
      out.push(<strong key={key} style={{ fontWeight: 650 }}>{t.slice(2, -2)}</strong>)
    } else if (t.startsWith("`")) {
      out.push(
        <code key={key} style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.9em",
          background: "rgba(139,124,255,0.14)", padding: "1px 5px", borderRadius: 5,
        }}>{t.slice(1, -1)}</code>
      )
    } else if (t.startsWith("[")) {
      const mm = t.match(/\[([^\]\n]+)\]\(([^)\s]+)\)/)
      if (mm) {
        out.push(
          <a key={key} href={mm[2]} target="_blank" rel="noreferrer"
            style={{ color: "#8b9dff", textDecoration: "underline", wordBreak: "break-all" }}>
            {mm[1]}
          </a>
        )
      } else out.push(t)
    } else {
      out.push(<em key={key}>{t.slice(1, -1)}</em>)
    }
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const isFence = (s: string) => /^\s*```/.test(s)
const isHeading = (s: string) => /^(#{1,4})\s+(.*)$/.exec(s)
const isRule = (s: string) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(s)
const isBullet = (s: string) => /^\s*[-*•]\s+/.test(s)
const isNumbered = (s: string) => /^\s*\d+[.)]\s+/.test(s)
const isQuote = (s: string) => /^>\s?/.test(s)
const isBlockStarter = (s: string) => isFence(s) || isHeading(s) || isRule(s) || isBullet(s) || isNumbered(s) || isQuote(s)

const headingStyle = (lvl: number): React.CSSProperties => ({
  fontWeight: 700,
  fontSize: lvl === 1 ? 14.5 : lvl === 2 ? 13.5 : 12.5,
  letterSpacing: lvl >= 3 ? "0.04em" : undefined,
  color: "var(--text-primary)",
  marginTop: 2,
})

const paraStyle: React.CSSProperties = { lineHeight: 1.55 }
const listStyle: React.CSSProperties = { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }
const liStyle: React.CSSProperties = { lineHeight: 1.5 }
const preStyle: React.CSSProperties = {
  margin: 0, padding: "9px 11px", borderRadius: 10, overflowX: "auto",
  background: "rgba(0,0,0,0.35)", border: "1px solid var(--border)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, lineHeight: 1.5,
}
const quoteStyle: React.CSSProperties = {
  borderLeft: "3px solid rgba(139,124,255,0.5)", paddingLeft: 10,
  color: "var(--text-secondary)", lineHeight: 1.5,
}

export default function ChatMarkdown({ content }: { content: string }) {
  const lines = (content || "").split("\n")
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (isFence(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !isFence(lines[i])) buf.push(lines[i++])
      i++ // closing fence (or end of input)
      blocks.push(<pre key={key++} style={preStyle}><code>{buf.join("\n")}</code></pre>)
      continue
    }

    const h = isHeading(line)
    if (h) {
      blocks.push(<div key={key++} style={headingStyle(h[1].length)}>{renderInline(h[2], `h${key}`)}</div>)
      i++
      continue
    }

    if (isRule(line)) {
      blocks.push(<div key={key++} style={{ borderTop: "1px solid var(--border)", margin: "3px 0" }} />)
      i++
      continue
    }

    if (isBullet(line)) {
      const items: string[] = []
      while (i < lines.length && isBullet(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""))
      blocks.push(
        <ul key={key++} style={listStyle}>
          {items.map((it, n) => <li key={n} style={liStyle}>{renderInline(it, `b${key}-${n}`)}</li>)}
        </ul>
      )
      continue
    }

    if (isNumbered(line)) {
      const items: string[] = []
      while (i < lines.length && isNumbered(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""))
      blocks.push(
        <ol key={key++} style={listStyle}>
          {items.map((it, n) => <li key={n} style={liStyle}>{renderInline(it, `o${key}-${n}`)}</li>)}
        </ol>
      )
      continue
    }

    if (isQuote(line)) {
      const buf: string[] = []
      while (i < lines.length && isQuote(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""))
      blocks.push(<blockquote key={key++} style={quoteStyle}>{renderInline(buf.join(" "), `q${key}`)}</blockquote>)
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    // Paragraph: join soft-wrapped lines, stop at any block starter / blank.
    const buf: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !isBlockStarter(lines[i])) buf.push(lines[i++])
    const text = buf.join(" ")
    if (text.startsWith("✅")) {
      // Server verification badge — render as a compact chip, not a paragraph.
      blocks.push(
        <span key={key++} style={{
          display: "inline-flex", alignItems: "center", alignSelf: "flex-start", gap: 5,
          fontSize: 10.5, fontWeight: 650, padding: "2px 8px", borderRadius: 6,
          color: "#34d399", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)",
        }}>{text.replace(/^✅\s*/, "")}</span>
      )
    } else {
      blocks.push(<div key={key++} style={paraStyle}>{renderInline(text, `p${key}`)}</div>)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, whiteSpace: "normal" }}>
      {blocks}
    </div>
  )
}
