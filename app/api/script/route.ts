import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"
import { DEFAULT_SCRIPTS, SCRIPT_JSON_DEFAULTS } from "@/lib/default-scripts"
import { requireModuleOrRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { invalidateScriptLines } from "@/lib/script-lines"

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

const DEFAULTS: Record<string, string> = { ...DEFAULT_SCRIPTS, ...SCRIPT_JSON_DEFAULTS }

// Every editable surface: the universal base script (+ its legacy
// per-language fallbacks) plus the 2026-09-26 omnichannel keys. The JSON
// keys hold structured line sets (voice openers/closings, WhatsApp fallback
// copy, Instagram prompts) edited through the Script Manager's tabs.
const PLAIN_KEYS = ["base", "english", "hindi", "telugu"]
const JSON_KEYS = ["voice_openers", "voice_closings", "whatsapp_fallbacks", "instagram_dm", "instagram_comment"]
const ALLOWED_KEYS = [...PLAIN_KEYS, ...JSON_KEYS]

function validateContent(key: string, content: string): string | null {
  if (JSON_KEYS.includes(key)) {
    try {
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return `${key} must be a JSON object`
      }
      return null
    } catch {
      return `${key} is not valid JSON`
    }
  }
  return null
}

// ONE SCRIPT MODE: Priya runs on a single 'base' script for every
// language — the per-language voice (Hinglish/Tenglish) is appended in
// code (lib/llm.ts LANGUAGE_STYLES). The channel keys extend this with the
// fixed spoken/typed lines per surface. GET returns every saved row PLUS
// the JSON defaults (as strings) so the editor can prefill tabs that have
// no saved row yet without shipping a second copy of the defaults to the
// client bundle.
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
      `SELECT language, content, updated_at, updated_by FROM ai_scripts`
    )
    return NextResponse.json({ scripts: result.rows, defaults: SCRIPT_JSON_DEFAULTS })
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
    if (!ALLOWED_KEYS.includes(language)) {
      return NextResponse.json({ error: "invalid language" }, { status: 400 })
    }
    // JSON surfaces carry a lot more text than a single prompt (the voice
    // openers alone are 18 lines across 6 scenarios × 3 languages), so they
    // get a proportionally larger ceiling.
    const maxLen = JSON_KEYS.includes(language) ? 60000 : 20000
    if (content.length > maxLen) {
      return NextResponse.json({ error: `script too long (max ${maxLen.toLocaleString()} characters)` }, { status: 400 })
    }
    const jsonError = validateContent(language, content)
    if (jsonError) {
      return NextResponse.json({ error: jsonError }, { status: 400 })
    }
    await query(
      `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (language) DO UPDATE
       SET content = $2, updated_at = now(), updated_by = $3`,
      [language, content.trim(), session.email]
    )
    // Live on the next call — no need to wait out the 5-minute TTL.
    invalidateScriptLines()
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
    if (!language || !ALLOWED_KEYS.includes(language)) {
      return NextResponse.json({ error: "invalid language" }, { status: 400 })
    }
    // Reset to default instead of hard delete — 'base' resets to the pure
    // base default (no language rule baked in, see GET above); JSON keys
    // reset to their full default line set.
    await query(
      `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (language) DO UPDATE
       SET content = $2, updated_at = now(), updated_by = $3`,
      [language, DEFAULTS[language] || DEFAULTS.base, session.email]
    )
    invalidateScriptLines()
    logAudit("Priya script reset to default", session.email, { language })
    return NextResponse.json({ ok: true, message: "Reset to default script" })
  } catch (e: any) {
    return apiError(e)
  }
}
