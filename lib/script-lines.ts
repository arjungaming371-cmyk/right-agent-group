// DB-editable script lines loader — the single read path for every fixed
// line Priya says outside the LLM conversation itself (voice openers,
// closings, WhatsApp fallback copy, Instagram prompts).
//
// Architecture (locked in the 2026-09 omnichannel audit):
//   ai_scripts row  →  5-min in-memory TTL cache  →  deep-merged over
//   lib/default-scripts.ts defaults  →  consumers.
//
//   * A DB outage NEVER changes Priya's behaviour — a failed load returns
//     the built-in defaults (same fail-soft contract as lib/llm.ts's script
//     cache), it just retries on the next getter call.
//   * A saved row is merged FIELD BY FIELD (lib/script-text.ts): a partial
//     or hand-mangled JSON row can only replace the fields it actually
//     provides, never blank out the rest.
//   * Single-flight: N concurrent calls during a cache miss share one query.
//
// The last-resort lines in server/priya-lines.js (spoken when even this app
// is unreachable) are deliberately NOT fed from here — the voicebot cannot
// depend on this process being alive; see that file's header.

import { query } from "./db"
import {
  DEFAULT_VOICE_OPENERS,
  DEFAULT_VOICE_CLOSINGS,
  DEFAULT_WHATSAPP_FALLBACKS,
  DEFAULT_INSTAGRAM_PROMPTS,
} from "./default-scripts"
import {
  mergeVoiceOpeners,
  mergeVoiceClosings,
  mergeWhatsappFallbacks,
  mergeInstagramPrompts,
  type VoiceOpeners,
  type VoiceClosings,
  type WhatsappFallbacks,
  type InstagramPrompts,
} from "./script-text"

const TTL_MS = 5 * 60 * 1000

const SCRIPT_KEYS = ["voice_openers", "voice_closings", "whatsapp_fallbacks", "instagram_dm", "instagram_comment"]

type Lines = {
  openers: VoiceOpeners
  closings: VoiceClosings
  whatsapp: WhatsappFallbacks
  instagram: InstagramPrompts
}

let cache: { lines: Lines; at: number } | null = null
let inflight: Promise<Lines> | null = null

function parseRow(content: unknown): Record<string, unknown> | null {
  if (typeof content !== "string") return null
  try {
    const parsed: unknown = JSON.parse(content)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null // malformed saved JSON → the row contributes nothing, defaults apply
  }
}

async function loadLines(): Promise<Lines> {
  const res = await query(`SELECT language, content FROM ai_scripts WHERE language = ANY($1)`, [SCRIPT_KEYS])
  const byKey: Record<string, Record<string, unknown> | null> = {}
  for (const row of res.rows as { language: string; content: unknown }[]) {
    byKey[row.language] = parseRow(row.content)
  }
  return {
    openers: mergeVoiceOpeners(byKey.voice_openers, DEFAULT_VOICE_OPENERS),
    closings: mergeVoiceClosings(byKey.voice_closings, DEFAULT_VOICE_CLOSINGS),
    whatsapp: mergeWhatsappFallbacks(byKey.whatsapp_fallbacks, DEFAULT_WHATSAPP_FALLBACKS),
    // instagram_dm + instagram_comment are two rows of ONE surface.
    instagram: mergeInstagramPrompts(
      { dm: byKey.instagram_dm, comment: byKey.instagram_comment },
      DEFAULT_INSTAGRAM_PROMPTS
    ),
  }
}

async function getLines(): Promise<Lines> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.lines
  if (!inflight) {
    inflight = loadLines()
      .then((lines) => {
        cache = { lines, at: Date.now() }
        return lines
      })
      .catch((e: unknown) => {
        // Fail soft: defaults now, retry the DB on the next getter call.
        console.error("script-lines load failed — using built-in defaults:", e instanceof Error ? e.message : e)
        return {
          openers: DEFAULT_VOICE_OPENERS,
          closings: DEFAULT_VOICE_CLOSINGS,
          whatsapp: DEFAULT_WHATSAPP_FALLBACKS,
          instagram: DEFAULT_INSTAGRAM_PROMPTS,
        }
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export async function getVoiceOpeners(): Promise<VoiceOpeners> {
  return (await getLines()).openers
}

export async function getVoiceClosings(): Promise<VoiceClosings> {
  return (await getLines()).closings
}

export async function getWhatsappFallbacks(): Promise<WhatsappFallbacks> {
  return (await getLines()).whatsapp
}

export async function getInstagramPrompts(): Promise<InstagramPrompts> {
  return (await getLines()).instagram
}

/** Called by /api/script after a save/reset so an edit is live on the next
 *  call instead of waiting out the TTL (mirrors invalidateComplianceCache). */
export function invalidateScriptLines(): void {
  cache = null
}
