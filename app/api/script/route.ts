import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { DEFAULT_SCRIPTS } from "@/lib/default-scripts"

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

export async function GET() {
  try {
    await ensureTable()
    // Seed defaults if table is empty
    for (const [lang, content] of Object.entries(DEFAULTS)) {
      await query(
        `INSERT INTO ai_scripts (language, content) VALUES ($1, $2)
         ON CONFLICT (language) DO NOTHING`,
        [lang, content]
      )
    }
    const result = await query(
      `SELECT language, content, updated_at, updated_by FROM ai_scripts ORDER BY language`
    )
    return NextResponse.json({ scripts: result.rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable()
    const { language, content } = await req.json()
    if (!language || !content?.trim()) {
      return NextResponse.json({ error: "language and content required" }, { status: 400 })
    }
    if (!["english", "hindi", "telugu"].includes(language)) {
      return NextResponse.json({ error: "invalid language" }, { status: 400 })
    }
    if (content.length > 20000) {
      return NextResponse.json({ error: "script too long (max 20,000 characters)" }, { status: 400 })
    }
    await query(
      `INSERT INTO ai_scripts (language, content, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (language) DO UPDATE
       SET content = $2, updated_at = now()`,
      [language, content.trim()]
    )
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const language = new URL(req.url).searchParams.get("language")
    if (!language || !["english", "hindi", "telugu"].includes(language)) {
      return NextResponse.json({ error: "invalid language" }, { status: 400 })
    }
    // Reset to default instead of hard delete
    await query(
      `INSERT INTO ai_scripts (language, content, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (language) DO UPDATE
       SET content = $2, updated_at = now()`,
      [language, DEFAULTS[language]]
    )
    return NextResponse.json({ ok: true, message: "Reset to default script" })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
