import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { query } from "@/lib/db"
import { DEFAULT_SCRIPTS } from "@/lib/default-scripts"
import {
  CHANNEL_SCRIPT_KEYS,
  DEFAULT_INSTAGRAM_COMMENT,
  DEFAULT_INSTAGRAM_DM,
  DEFAULT_VOICE_CLOSINGS,
  DEFAULT_VOICE_OPENERS,
  DEFAULT_WHATSAPP_FALLBACKS,
  invalidateChannelScriptsCache,
} from "@/lib/channel-scripts"
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

// Editable keys: the main conversation script ('base' + legacy languages)
// PLUS the per-channel scripts (openers/closings/fallbacks/Instagram) that
// live in lib/channel-scripts.ts.
const LEGACY_KEYS = ["base", "english", "hindi", "telugu"]
const EDITABLE_KEYS = [...LEGACY_KEYS, ...CHANNEL_SCRIPT_KEYS]
// Channel keys stored as JSON objects (validated on save; per-field fallback
// to code defaults happens at load time in lib/channel-scripts.ts).
const JSON_KEYS: string[] = [
  "voice_openers",
  "voice_closings",
  "whatsapp_fallbacks",
  "instagram_comment",
]

// Defaults served to the dashboard so every editor starts pre-filled even
// when no row exists yet (missing row = defaults are live).
const CHANNEL_DEFAULTS: Record<string, unknown> = {
  instagram_dm: DEFAULT_INSTAGRAM_DM,
  instagram_comment: DEFAULT_INSTAGRAM_COMMENT,
  voice_openers: DEFAULT_VOICE_OPENERS,
  voice_closings: DEFAULT_VOICE_CLOSINGS,
  whatsapp_fallbacks: DEFAULT_WHATSAPP_FALLBACKS,
}

// ONE SCRIPT MODE: Priya runs on a single 'base' script for every language —
// the per-language voice (Hinglish/Tenglish) is appended in code
// (lib/llm.ts LANGUAGE_STYLES). Channel scripts are separate editable rows.
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
      `SELECT language, content, updated_at, updated_by FROM ai_scripts
       WHERE language = ANY($1)`,
      [["base", ...CHANNEL_SCRIPT_KEYS]]
    )
    return NextResponse.json({
      scripts: result.rows,
      defaults: CHANNEL_DEFAULTS,
    })
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
    if (!EDITABLE_KEYS.includes(language)) {
      return NextResponse.json({ error: "invalid language" }, { status: 400 })
    }
    if (content.length > 40000) {
      return NextResponse.json({ error: "script too long (max 40,000 characters)" }, { status: 400 })
    }
    // Channel JSON keys must parse as an object — a broken save would
    // otherwise be rejected at load time per-field anyway, but failing fast
    // here gives the editor an immediate, actionable error instead.
    if (JSON_KEYS.includes(language)) {
      try {
        const parsed = JSON.parse(content)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return NextResponse.json({ error: "content must be a JSON object" }, { status: 400 })
        }
      } catch {
        return NextResponse.json({ error: "content must be valid JSON" }, { status: 400 })
      }
    }
    await query(
      `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (language) DO UPDATE
       SET content = $2, updated_at = now(), updated_by = $3`,
      [language, content.trim(), session.email]
    )
    // Channel scripts are cached in memory (5-min TTL) — bump immediately so
    // the next call/message picks the new text up without waiting.
    if (!LEGACY_KEYS.includes(language)) invalidateChannelScriptsCache()
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
    if (!language || !EDITABLE_KEYS.includes(language)) {
      return NextResponse.json({ error: "invalid language" }, { status: 400 })
    }
    if (LEGACY_KEYS.includes(language)) {
      // Reset to default instead of hard delete — 'base' resets to the pure
      // base default (no language rule baked in, see GET above).
      await query(
        `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
         VALUES ($1, $2, now(), $3)
         ON CONFLICT (language) DO UPDATE
         SET content = $2, updated_at = now(), updated_by = $3`,
        [language, DEFAULTS[language] || DEFAULTS.base, session.email]
      )
    } else {
      // Channel scripts: defaults live in code, so reset = remove the row —
      // the loader falls back per-field to the code defaults immediately.
      await query(`DELETE FROM ai_scripts WHERE language = $1`, [language])
      invalidateChannelScriptsCache()
    }
    logAudit("Priya script reset to default", session.email, { language })
    return NextResponse.json({ ok: true, message: "Reset to default script" })
  } catch (e: any) {
    return apiError(e)
  }
}
