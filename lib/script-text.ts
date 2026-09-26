// Pure (zero-import) merge/render helpers for the DB-editable script
// surfaces — voice openers/closings, WhatsApp fallback copy, Instagram
// prompts. Kept import-free on purpose: the regression test compiles THIS
// file alone with the repo's own tsc and exercises the exact production
// logic (scripts/test-script-lines.js), and every consumer (lib/script-lines,
// lib/default-scripts) can import it without pulling in the DB layer.
//
// Merge contract for every saved surface: the ai_scripts row holds JSON.
// A field is ONLY overridden when it parses to a non-empty string — a
// partial save (or a hand-edited row with one scenario blanked) can never
// wipe the rest of Priya's lines, and a corrupt row falls back to defaults
// field by field instead of killing the surface.

export type Lang3 = "english" | "hindi" | "telugu"
export const LANGS: Lang3[] = ["english", "hindi", "telugu"]

export type VoiceOpeners = {
  cold: Record<Lang3, string>
  cold_named: Record<Lang3, string>
  returning: Record<Lang3, string>
  returning_named: Record<Lang3, string>
  inbound: Record<Lang3, string>
  inbound_named: Record<Lang3, string>
}

export type VoiceClosings = {
  qualified: Record<Lang3, string>
  sign_off: Record<Lang3, string>
}

export type WhatsappFallbacks = {
  form_link: string
  call_followup: string
  missed_call: string
}

export type InstagramPrompts = {
  dm: { system_prompt: string; reply_rules: string }
  comment: { system_prompt: string; reply_rules: string; first_dm: string }
}

function pickString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v : fallback
}

function pickLangRecord(v: unknown, fallback: Record<Lang3, string>): Record<Lang3, string> {
  const out = { ...fallback }
  if (v && typeof v === "object") {
    for (const lang of LANGS) {
      out[lang] = pickString((v as Record<string, unknown>)[lang], fallback[lang])
    }
  }
  return out
}

const OPENER_SCENARIOS = ["cold", "cold_named", "returning", "returning_named", "inbound", "inbound_named"] as const

export function mergeVoiceOpeners(raw: unknown, fallback: VoiceOpeners): VoiceOpeners {
  const out = { ...fallback }
  if (raw && typeof raw === "object") {
    for (const scenario of OPENER_SCENARIOS) {
      out[scenario] = pickLangRecord((raw as Record<string, unknown>)[scenario], fallback[scenario])
    }
  }
  return out
}

export function mergeVoiceClosings(raw: unknown, fallback: VoiceClosings): VoiceClosings {
  return {
    qualified: pickLangRecord(
      raw && typeof raw === "object" ? (raw as Record<string, unknown>).qualified : undefined,
      fallback.qualified
    ),
    sign_off: pickLangRecord(
      raw && typeof raw === "object" ? (raw as Record<string, unknown>).sign_off : undefined,
      fallback.sign_off
    ),
  }
}

const WA_KEYS = ["form_link", "call_followup", "missed_call"] as const

export function mergeWhatsappFallbacks(raw: unknown, fallback: WhatsappFallbacks): WhatsappFallbacks {
  const out = { ...fallback }
  if (raw && typeof raw === "object") {
    for (const key of WA_KEYS) {
      out[key] = pickString((raw as Record<string, unknown>)[key], fallback[key])
    }
  }
  return out
}

export function mergeInstagramPrompts(
  raw: { dm?: unknown; comment?: unknown },
  fallback: InstagramPrompts
): InstagramPrompts {
  const dm = raw?.dm && typeof raw.dm === "object" ? (raw.dm as Record<string, unknown>) : {}
  const comment = raw?.comment && typeof raw.comment === "object" ? (raw.comment as Record<string, unknown>) : {}
  return {
    dm: {
      system_prompt: pickString(dm.system_prompt, fallback.dm.system_prompt),
      reply_rules: pickString(dm.reply_rules, fallback.dm.reply_rules),
    },
    comment: {
      system_prompt: pickString(comment.system_prompt, fallback.comment.system_prompt),
      reply_rules: pickString(comment.reply_rules, fallback.comment.reply_rules),
      first_dm: pickString(comment.first_dm, fallback.comment.first_dm),
    },
  }
}

/** Replace {token} placeholders. Unknown tokens are left untouched so a
 *  typo in a saved template is visible in the sent message instead of
 *  silently deleting content. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return String(template || "").replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole
  )
}
