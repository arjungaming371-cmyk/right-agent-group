import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { DEFAULT_SCRIPTS } from "@/lib/default-scripts"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// Ensure the scripts table exists on first access
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_scripts (
      id         SERIAL PRIMARY KEY,
      language   TEXT NOT NULL UNIQUE,
      content    TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT DEFAULT 'admin'
    )
  `)
}

const DEFAULTS: Record<string, string> = DEFAULT_SCRIPTS

// ONE SCRIPT MODE: Priya now runs on a single 'base' script for every
// language — the per-language voice (Hinglish/Tenglish) is appended in
// code (lib/llm.ts LANGUAGE_STYLES). The editor edits only the base row.
export async function GET() {
  try {
    await ensureTable()
    // Seed the base script if missing (from the English default).
    await query(
      `INSERT INTO ai_scripts (language, content) VALUES ('base', $1)
       ON CONFLICT (language) DO NOTHING`,
      [DEFAULTS.english]
    )
    const result = await query(
      `SELECT language, content, updated_at, updated_by FROM ai_scripts WHERE language = 'base'`
    )
    return NextResponse.json({ scripts: result.rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    await ensureTable()
    const { language, content } = await req.json()
    if (!language || !content?.trim()) {
      return NextResponse.json({ error: "language and content required" }, { status: 400 })
    }
    if (!["base", "english", "hindi", "telugu"].includes(language)) {
      return NextResponse.json({ error: "invalid language" }, { status: 400 })
    }
    if (content.length > 20000) {
      return NextResponse.json({ error: "script too long (max 20,000 characters)" }, { status: 400 })
    }
    await query(
      `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (language) DO UPDATE
       SET content = $2, updated_at = now(), updated_by = $3`,
      [language, content.trim(), session.email]
    )
    logAudit("Priya script edited", session.email, { language })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const language = new URL(req.url).searchParams.get("language")
    if (!language || !["base", "english", "hindi", "telugu"].includes(language)) {
      return NextResponse.json({ error: "invalid language" }, { status: 400 })
    }
    // Reset to default instead of hard delete (base resets to the English default)
    await query(
      `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (language) DO UPDATE
       SET content = $2, updated_at = now(), updated_by = $3`,
      [language, DEFAULTS[language] || DEFAULTS.english, session.email]
    )
    logAudit("Priya script reset to default", session.email, { language })
    return NextResponse.json({ ok: true, message: "Reset to default script" })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
