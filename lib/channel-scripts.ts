// Channel-specific scripts — the single editable source for every fixed
// line Priya says or sends OUTSIDE the main conversation script:
//
//   instagram_dm        system prompt for Instagram DM replies (plain text)
//   instagram_comment   public comment reply + private DM opener (JSON)
//   voice_openers       spoken greetings: cold / returning / inbound /
//                       whatsapp callback, each with a "{name}" personalized
//                       variant, in english / hindi / telugu (JSON)
//   voice_closings      spoken closings: qualified (link-send) / goodbye /
//                       retry / rate-limit, per language (JSON)
//   whatsapp_fallbacks  free-form fallback texts used when a Meta template
//                       is not approved yet: formLink / callFollowup /
//                       missedCall, with {name} {brand} {link} (JSON)
//
// Rows live in the existing ai_scripts table (the `language` column doubles
// as the script key — 'base' is the main conversation script, these keys are
// channel scripts). A MISSING row means "use the code defaults below", so
// Reset-to-Default simply deletes the row and a partial row (e.g. only
// telugu openers filled in) merges per-entry over the defaults.
//
// CACHE: stale-while-revalidate, 5-minute TTL. Sync getters always return the
// last known snapshot (defaults until the first successful read) so a call
// path never awaits a DB fetch mid-conversation; refreshes are kicked lazily
// and deduplicated. A failed refresh backs off until the next TTL window
// instead of hammering a dead database on every getter call.
//
// The server-side LAST-RESORT spoken lines (clarify / hold / can't-reach-app)
// are deliberately NOT here — they must still work when the app AND the
// database are unreachable, which is exactly the scenario they cover. They
// live once, shared by both transports, in server/fallback-speech.js.

import { query } from "./db"

export type ScriptLanguage = "english" | "hindi" | "telugu"
export const SCRIPT_LANGUAGES: ScriptLanguage[] = ["english", "hindi", "telugu"]

export const CHANNEL_SCRIPT_KEYS = [
  "instagram_dm",
  "instagram_comment",
  "voice_openers",
  "voice_closings",
  "whatsapp_fallbacks",
] as const
export type ChannelScriptKey = (typeof CHANNEL_SCRIPT_KEYS)[number]

// ---------- Defaults (byte-identical to the previous hardcoded behavior) ----------

export const DEFAULT_INSTAGRAM_DM = `You are Priya, senior home & business loan advisor at Right Agent Group.
You are communicating with a client via Instagram Direct Message (DM).
Be warm, professional, helpful, and concise.

Client Details:
{brief}

Knowledge Base Facts:
{kbContext}

Loan Guidance:
{rateInfo}
{emiInfo}
{dtInfo}

Instructions:
- Keep your answer under 100 words (Instagram DM friendly).
- Answer the customer's question directly.
- NEVER re-ask for a detail the customer already gave earlier in the thread.
- Qualification goal: once the user shows real loan interest, naturally ask for their phone or WhatsApp number so you can send them the exact rate breakdown — e.g. "Sure! Could you share your WhatsApp number so I can send you the exact interest rate breakdown and loan options?"
- If Client Details already shows a phone number, never ask for it — offer to send the rate breakdown on WhatsApp instead.
- Ask a helpful follow-up question to qualify their loan needs.`

export const DEFAULT_INSTAGRAM_COMMENT: InstagramCommentScripts = {
  publicReply: `You are Priya, senior loan advisor at Right Agent Group responding to a public Instagram post comment from @{username}.
Be friendly, helpful, concise, and professional.

Knowledge Base:
{kbContext}

Provide a short public reply (under 40 words) acknowledging their comment and offering help.`,
  privateDm: `Hi @{username}! Thanks for commenting on our post. I'm Priya from Right Agent Group. How can I assist you with your home or business loan enquiry today?`,
}

export type VoiceOpenerFamily =
  | "cold"
  | "returning"
  | "inbound"
  | "whatsappCallback"

export type VoiceOpeners = Record<
  `${VoiceOpenerFamily}` | `${VoiceOpenerFamily}WithName`,
  Record<ScriptLanguage, string>
>

export const DEFAULT_VOICE_OPENERS: VoiceOpeners = {
  cold: {
    english:
      "Hello, good morning! This is Priya calling from Right Agent Group, Hyderabad — we help people get loans from over 20 banks without the running around. Do you have a minute? I'd love to know if you have any loan or financial need right now.",
    hindi:
      "Namaste, good morning! Main Priya bol rahi hoon Right Agent Group, Hyderabad se — hum bees se zyada banks se loan dilwane mein madad karte hain, bina bank bank ghoome. Ek minute hai aapke paas? Batayein, aapko koi loan ya financial zaroorat hai kya abhi?",
    telugu:
      "Namaskaram! Nenu Priya, Right Agent Group, Hyderabad nunchi call chestunnanu, memu twenty plus banks tho meeku best loan help chestam. Okka minute time unda sir, meekemaina loan requirement unda?",
  },
  coldWithName: {
    english: `Hello {name}! This is Priya calling from Right Agent Group, Hyderabad — we help people get loans from over 20 banks without the running around. Do you have a minute? I'd love to know if you have any loan need right now.`,
    hindi: `Namaste {name} ji! Main Priya bol rahi hoon, Right Agent Group, Hyderabad se — hum bees se zyada banks se loan dilwane mein madad karte hain. Ek minute hai aapke paas? Batayein, aapko koi loan zaroorat hai kya abhi?`,
    telugu: `Namaskaram {name} garu! Nenu Priya, Right Agent Group, Hyderabad nunchi call chestunnanu, memu twenty plus banks tho meeku best loan help chestam. Okka minute time unda sir, edaina loan requirement unda?`,
  },
  returning: {
    english:
      "Hello again! This is Priya from Right Agent Group, following up on your loan interest — do you have a minute?",
    hindi:
      "Namaste! Main Priya, Right Agent Group se, phir se call kar rahi hoon aapke loan interest ke baare mein follow-up ke liye — ek minute hai kya?",
    telugu:
      "Namaskaram! Nenu Priya, Right Agent Group nunchi mee loan gurinchi follow-up chestunnanu, okka minute time unda sir?",
  },
  returningWithName: {
    english: `Hello {name}! Priya here again from Right Agent Group. Just following up on our last conversation about your loan — do you have a moment?`,
    hindi: `Namaste {name} ji! Main Priya, Right Agent Group se, phir se call kar rahi hoon. Aapke loan ke baare mein follow-up karna tha — ek minute hai kya?`,
    telugu: `Namaskaram {name} garu! Nenu Priya, Right Agent Group nunchi malli call chestunnanu, mee loan gurinchi follow-up cheddamani, okka minute time unda sir?`,
  },
  inbound: {
    english:
      "Hello! Thank you for calling Right Agent Group, Hyderabad. This is Priya. How can I help you today?",
    hindi:
      "Namaste! Right Agent Group, Hyderabad ko call karne ke liye dhanyawad. Main Priya bol rahi hoon. Batayein, main aapki kya madad kar sakti hoon?",
    telugu:
      "Namaskaram! Right Agent Group, Hyderabad ki call chesinanduku thanks sir. Nenu Priya. Cheppandi, meeku ela help cheyagalanu?",
  },
  inboundWithName: {
    english: `Hello {name}! Thank you for calling Right Agent Group, Hyderabad. This is Priya. How can I help you today?`,
    hindi: `Namaste {name} ji! Right Agent Group, Hyderabad ko call karne ke liye dhanyawad. Main Priya bol rahi hoon. Batayein, main aapki kya madad kar sakti hoon?`,
    telugu: `Namaskaram {name} garu! Right Agent Group, Hyderabad ki call chesinanduku thanks. Nenu Priya. Cheppandi, meeku ela help cheyagalanu?`,
  },
  whatsappCallback: {
    english:
      "Hello! This is Priya from Right Agent Group, Hyderabad — you had reached out to us on WhatsApp earlier, so I'm calling you back. Do you have a minute? I'd love to know what you were looking for.",
    hindi:
      "Namaste! Main Priya bol rahi hoon Right Agent Group, Hyderabad se — aapne pehle humein WhatsApp pe reach out kiya tha, toh main aapko call back kar rahi hoon. Ek minute hai? Batayein, aapko kya chahiye tha?",
    telugu:
      "Namaskaram! Nenu Priya, Right Agent Group, Hyderabad nunchi — meeru intakumundu maa WhatsApp lo contact ayyaru kabatti call back chestunnanu. One minute time unda sir?",
  },
  whatsappCallbackWithName: {
    english: `Hello {name}! Priya here from Right Agent Group — you had reached out to us on WhatsApp earlier, so I'm calling you back. Do you have a minute?`,
    hindi: `Namaste {name} ji! Main Priya, Right Agent Group se — aapne pehle humein WhatsApp pe contact kiya tha, toh main call back kar rahi hoon. Ek minute hai kya?`,
    telugu: `Namaskaram {name} garu! Nenu Priya, Right Agent Group nunchi — meeru intakumundu maa WhatsApp lo contact ayyaru kabatti call back chestunnanu. Konchem time unda sir?`,
  },
}

export type VoiceClosings = Record<
  "qualified" | "goodbye" | "retry" | "rateLimit",
  Record<ScriptLanguage, string>
>

export const DEFAULT_VOICE_CLOSINGS: VoiceClosings = {
  qualified: {
    english: "Thank you! I'm sending a simple loan application on your WhatsApp right now — just fill it in, and our loan officer will personally consult you after that. Have a great day!",
    hindi: "Dhanyawad! Main abhi aapke WhatsApp pe ek simple loan application bhej rahi hoon — bas usko fill kar dijiyega, uske baad hamare loan officer aapse personally baat karke consult karenge. Aapka din shubh ho!",
    telugu: "Thank you sir! Nenu mee WhatsApp ki simple loan application link pampistunnanu, fill cheyandi. Maa loan officer meeku call chesi discuss chestaru. Have a great day sir, bye!",
  },
  goodbye: {
    english: "Thank you for your time! Have a great day. Goodbye!",
    hindi: "Aapke samay ke liye dhanyawad! Aapka din shubh ho. Namaste!",
    telugu: "Thank you so much sir! Have a great day, bye!",
  },
  retry: {
    english: "Sorry, I had a small technical moment. Could you please share your name so I can send your loan application link?",
    hindi: "Maaf kijiye, chhoti technical problem hui. Kripya apna naam batayein taaki main aapka loan application link bhej sakoon.",
    telugu: "Sorry sir, chinna technical issue vachindi. Dayachesi mee peru cheptara, loan application link pampistanu.",
  },
  rateLimit: {
    english: "Sorry sir, we're having a brief network issue on our end. I'll have someone call you back in a few minutes to continue — thank you for your patience!",
    hindi: "Sorry sir, hamari taraf se thodi network problem aa rahi hai. Kuch minute mein hum aapko wapas call karenge — dhanyawad!",
    telugu: "Sorry sir, konchem network issue vachindi. Memu two minutes lo malli call chestamu — thank you sir!",
  },
}

export type WhatsAppFallbacks = Record<
  "formLink" | "callFollowup" | "missedCall",
  string
>

export const DEFAULT_WHATSAPP_FALLBACKS: WhatsAppFallbacks = {
  formLink: `Hi {name}! Thanks for speaking with Priya from {brand}. Please complete your loan application here: {link}\n\nWe never ask for OTP, PIN, or any payment. — {brand}`,
  callFollowup: `Hi {name}! Thanks for speaking with Priya from {brand}. Feel free to message us here anytime with questions.\n\nWe never ask for OTP, PIN, or any payment. — {brand}`,
  missedCall: `Hi {name}! We tried calling you from {brand} about a loan offer but couldn't reach you. Reply here or call us back anytime.\n\nWe never ask for OTP, PIN, or any payment. — {brand}`,
}

export type InstagramCommentScripts = {
  publicReply: string
  privateDm: string
}

// ---------- Pure parsing / merging (exported for tests) ----------

/** Replace {token} placeholders; unknown tokens are left untouched. */
export function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  )
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function safeParse(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Per-language merge: a partial row (e.g. only telugu) keeps defaults for the rest. */
export function parseLangRecord(
  raw: unknown,
  fallback: Record<ScriptLanguage, string>
): Record<ScriptLanguage, string> {
  const out = { ...fallback }
  if (!isPlainObject(raw)) return out
  for (const lang of SCRIPT_LANGUAGES) {
    const v = raw[lang]
    if (typeof v === "string" && v.trim()) out[lang] = v
  }
  return out
}

export function parseVoiceOpeners(raw: unknown, fallback: VoiceOpeners): VoiceOpeners {
  if (!isPlainObject(raw)) return { ...fallback }
  const out = {} as VoiceOpeners
  for (const key of Object.keys(fallback) as (keyof VoiceOpeners)[]) {
    out[key] = parseLangRecord(raw[key], fallback[key])
  }
  return out
}

export function parseVoiceClosings(raw: unknown, fallback: VoiceClosings): VoiceClosings {
  if (!isPlainObject(raw)) return { ...fallback }
  const out = {} as VoiceClosings
  for (const key of Object.keys(fallback) as (keyof VoiceClosings)[]) {
    out[key] = parseLangRecord(raw[key], fallback[key])
  }
  return out
}

export function parseWhatsAppFallbacks(raw: unknown, fallback: WhatsAppFallbacks): WhatsAppFallbacks {
  if (!isPlainObject(raw)) return { ...fallback }
  const out = { ...fallback }
  for (const key of Object.keys(fallback) as (keyof WhatsAppFallbacks)[]) {
    const v = raw[key]
    if (typeof v === "string" && v.trim()) out[key] = v
  }
  return out
}

export function parseInstagramComment(raw: unknown, fallback: InstagramCommentScripts): InstagramCommentScripts {
  if (!isPlainObject(raw)) return { ...fallback }
  const out = { ...fallback }
  for (const key of ["publicReply", "privateDm"] as const) {
    const v = raw[key]
    if (typeof v === "string" && v.trim()) out[key] = v
  }
  return out
}

export type ChannelScriptsSnapshot = {
  instagramDm: string
  instagramComment: InstagramCommentScripts
  voiceOpeners: VoiceOpeners
  voiceClosings: VoiceClosings
  whatsappFallbacks: WhatsAppFallbacks
}

export const DEFAULT_SNAPSHOT: ChannelScriptsSnapshot = {
  instagramDm: DEFAULT_INSTAGRAM_DM,
  instagramComment: { ...DEFAULT_INSTAGRAM_COMMENT },
  voiceOpeners: DEFAULT_VOICE_OPENERS,
  voiceClosings: DEFAULT_VOICE_CLOSINGS,
  whatsappFallbacks: DEFAULT_WHATSAPP_FALLBACKS,
}

/**
 * Build the effective snapshot from raw ai_scripts rows (channel keys only).
 * Rows that are missing / corrupt / wrong-typed fall back per-field to the
 * code defaults — a bad save can never break the call stack.
 */
export function mergeChannelRows(
  rows: { language: string; content: string | null | undefined }[]
): ChannelScriptsSnapshot {
  const snap: ChannelScriptsSnapshot = {
    instagramDm: DEFAULT_INSTAGRAM_DM,
    instagramComment: { ...DEFAULT_INSTAGRAM_COMMENT },
    voiceOpeners: DEFAULT_VOICE_OPENERS,
    voiceClosings: DEFAULT_VOICE_CLOSINGS,
    whatsappFallbacks: DEFAULT_WHATSAPP_FALLBACKS,
  }
  for (const row of rows || []) {
    const content = typeof row.content === "string" ? row.content : ""
    switch (row.language) {
      case "instagram_dm":
        if (content.trim()) snap.instagramDm = content
        break
      case "instagram_comment": {
        const parsed = safeParse(content)
        if (parsed) snap.instagramComment = parseInstagramComment(parsed, snap.instagramComment)
        break
      }
      case "voice_openers": {
        const parsed = safeParse(content)
        if (parsed) snap.voiceOpeners = parseVoiceOpeners(parsed, snap.voiceOpeners)
        break
      }
      case "voice_closings": {
        const parsed = safeParse(content)
        if (parsed) snap.voiceClosings = parseVoiceClosings(parsed, snap.voiceClosings)
        break
      }
      case "whatsapp_fallbacks": {
        const parsed = safeParse(content)
        if (parsed) snap.whatsappFallbacks = parseWhatsAppFallbacks(parsed, snap.whatsappFallbacks)
        break
      }
    }
  }
  return snap
}

// ---------- Stale-while-revalidate cache ----------

const SCRIPTS_TTL_MS = 5 * 60 * 1000

let _snapshot: ChannelScriptsSnapshot = DEFAULT_SNAPSHOT
let _fetchedAt = 0
let _refreshing: Promise<void> | null = null

async function refreshChannelScripts(): Promise<void> {
  const result = await query(
    `SELECT language, content FROM ai_scripts WHERE language = ANY($1)`,
    [[...CHANNEL_SCRIPT_KEYS]]
  )
  _snapshot = mergeChannelRows(result.rows || [])
  _fetchedAt = Date.now()
}

/**
 * Await this where the call path can afford one cached DB read (call start)
 * to guarantee fresh openers; the sync getters below never block.
 */
export async function refreshChannelScriptsIfStale(): Promise<void> {
  if (Date.now() - _fetchedAt < SCRIPTS_TTL_MS) return
  if (!_refreshing) {
    _refreshing = refreshChannelScripts()
      .catch(() => {
        // Back off until the next TTL window — a dead DB must not be
        // re-hit on every getter call. Snapshot keeps its last value.
        _fetchedAt = Date.now()
      })
      .finally(() => {
        _refreshing = null
      })
  }
  await _refreshing
}

/** Force the next refresh immediately (after a dashboard save/reset). */
export function invalidateChannelScriptsCache(): void {
  _fetchedAt = 0
}

function maybeKickRefresh(): void {
  if (Date.now() - _fetchedAt >= SCRIPTS_TTL_MS && !_refreshing) {
    void refreshChannelScriptsIfStale()
  }
}

/** SYNC — last known effective scripts; defaults until the first read lands. */
export function getChannelScriptsSnapshot(): ChannelScriptsSnapshot {
  maybeKickRefresh()
  return _snapshot
}

export function getVoiceOpenersSnapshot(): VoiceOpeners {
  return getChannelScriptsSnapshot().voiceOpeners
}

export function getVoiceClosingsSnapshot(): VoiceClosings {
  return getChannelScriptsSnapshot().voiceClosings
}

export function getWhatsAppFallbackTemplates(): WhatsAppFallbacks {
  return getChannelScriptsSnapshot().whatsappFallbacks
}

export function getInstagramDmTemplate(): string {
  return getChannelScriptsSnapshot().instagramDm
}

export function getInstagramCommentTemplates(): InstagramCommentScripts {
  return getChannelScriptsSnapshot().instagramComment
}

/** Test hook — inject a snapshot without a database. */
export function __setChannelScriptsSnapshotForTests(snap: ChannelScriptsSnapshot): void {
  _snapshot = snap
  _fetchedAt = Date.now()
}

/** Test hook — back to pure defaults, empty cache. */
export function __resetChannelScriptsForTests(): void {
  _snapshot = DEFAULT_SNAPSHOT
  _fetchedAt = 0
  _refreshing = null
}

// Boot: prime the cache once per process (skipped during `next build`).
// Fire-and-forget — the sync getters already handle the "not loaded yet" case.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  void refreshChannelScripts().catch(() => {
    _fetchedAt = Date.now() // back off; next getter call retries after TTL
  })
}
