// Prompt Tuner — reads a batch of recent conversations, asks Ollama whether
// the same friction shows up repeatedly, and stores any suggestions as
// "pending" rows for a human admin to approve or reject. Nothing here EVER
// writes to ai_scripts directly — applySuggestion() only runs from an
// explicit admin action (app/api/prompt-tuner/[id]/route.ts).
//
// Runs weekly off a cron tick (lib/scheduler.ts), same fire-and-forget shape
// as lib/lead-brain.ts's background jobs — never on any live-call path.

import { query } from "./db"
import { generatePromptSuggestions } from "./ollama"
import { DEFAULT_SCRIPTS } from "./default-scripts"

const BATCH_SIZE = 25 // recent calls to sample per run — enough to spot a real repeat, not so many the prompt gets huge

function clip(s: string, n: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n) + "…" : t
}

async function buildConversationBatch(): Promise<string> {
  const calls = await query(
    `SELECT transcript, outcome, sentiment, duration FROM voice_calls
     WHERE transcript IS NOT NULL AND transcript::text != '[]'
     ORDER BY created_at DESC LIMIT $1`,
    [BATCH_SIZE]
  )

  const blocks: string[] = []
  let n = 0
  for (const call of calls.rows) {
    let turns: any[] = []
    try {
      turns = typeof call.transcript === "string" ? JSON.parse(call.transcript) : call.transcript || []
    } catch {}
    if (!Array.isArray(turns) || turns.length === 0) continue
    n++
    const lines = turns.map((t: any) => `${t.role === "ai" ? "Priya" : "Customer"}: ${clip(t.text, 200)}`).join("\n")
    blocks.push(`--- CALL ${n} (outcome: ${call.outcome}, sentiment: ${call.sentiment}, ${call.duration}s) ---\n${lines}`)
  }
  return blocks.join("\n\n")
}

/**
 * One run: sample recent calls, ask Ollama for repeat-pattern suggestions,
 * insert each as a pending row. Dedupes against existing PENDING suggestions
 * by near-identical guideline text so a weekly cron doesn't pile up the same
 * suggestion over and over while nobody's reviewed it yet.
 */
export async function runPromptTuner(): Promise<{ generated: number }> {
  const batch = await buildConversationBatch()
  if (!batch.trim()) return { generated: 0 } // nothing with real transcripts yet

  const suggestions = await generatePromptSuggestions(batch)
  if (!suggestions) {
    console.error("[prompt-tuner] generation failed — Ollama did not return valid JSON")
    return { generated: 0 }
  }
  if (suggestions.length === 0) return { generated: 0 }

  const existing = await query(`SELECT short_guideline FROM prompt_suggestions WHERE status = 'pending'`)
  const existingSet = new Set(existing.rows.map((r: any) => r.short_guideline.toLowerCase().trim()))

  let inserted = 0
  for (const s of suggestions) {
    if (existingSet.has(s.short_guideline.toLowerCase().trim())) continue // near-duplicate of an unreviewed suggestion
    await query(
      `INSERT INTO prompt_suggestions (channel, short_guideline, situation, risk, source_summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [s.channel, s.short_guideline, s.situation, s.risk, s.source_summary]
    )
    inserted++
  }
  if (inserted > 0) console.log(`[prompt-tuner] generated ${inserted} new suggestion(s) from ${suggestions.length} proposed`)
  return { generated: inserted }
}

/**
 * Admin-approved suggestion → appended as one new line to each selected
 * language's ai_scripts.content. Called only from an authenticated admin
 * action, never automatically.
 */
export async function applySuggestionToScripts(guideline: string, languages: string[]): Promise<void> {
  for (const lang of languages) {
    if (!["english", "hindi", "telugu"].includes(lang)) continue
    // Upsert, not a blind UPDATE — a brand-new install may not have opened
    // the Script Manager yet (which is what normally seeds ai_scripts).
    await query(
      `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
       VALUES ($1, $2, now(), 'prompt-tuner (approved)')
       ON CONFLICT (language) DO UPDATE
       SET content = ai_scripts.content || $3, updated_at = now(), updated_by = 'prompt-tuner (approved)'`,
      [lang, `${(DEFAULT_SCRIPTS as any)[lang] || ""}\n- ${guideline}`, `\n- ${guideline}`]
    )
  }
}
