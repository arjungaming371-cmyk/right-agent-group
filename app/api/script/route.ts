import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"
import { DEFAULT_SCRIPTS } from "@/lib/default-scripts"
import { requireModuleOrRole } from "@/lib/auth"
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
export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "script", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    await ensureTable()
    // Seed the base script if missing. Uses the pure base (no language
    // rule baked in) — lib/llm.ts appends the right one per request, so
    // seeding with DEFAULTS.english here would permanently bake an
    // English-only instruction into every language's calls.
    await query(
      `INSERT INTO ai_scripts (language, content) VALUES ('base', $1)
       ON CONFLICT (language) DO NOTHING`,
      [DEFAULTS.base]
    )
    const result = await query(
      `SELECT language, content, updated_at, updated_by FROM ai_scripts WHERE language = 'base'`
    )
    return NextResponse.json({ scripts: result.rows })
  } catch (e: any) {
    return apiError(e)
  }
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "script", ["admin"])
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
    return apiError(e)
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireModuleOrRole(req, "script", ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const language = new URL(req.url).searchParams.get("language")
    if (!language || !["base", "english", "hindi", "telugu"].includes(language)) {
      return NextResponse.json({ error: "invalid language" }, { status: 400 })
    }
    // Reset to default instead of hard delete — 'base' resets to the pure
    // base default (no language rule baked in, see GET above).
    await query(
      `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (language) DO UPDATE
       SET content = $2, updated_at = now(), updated_by = $3`,
      [language, DEFAULTS[language] || DEFAULTS.base, session.email]
    )
    logAudit("Priya script reset to default", session.email, { language })
    return NextResponse.json({ ok: true, message: "Reset to default script" })
  } catch (e: any) {
    return apiError(e)
  }
}

