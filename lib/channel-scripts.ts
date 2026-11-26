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
- If the customer asks for the loan application, application form, or the link, tell them it is DONE: the system delivers the form automatically with your reply — right here in this chat when we don't have their number yet, or on their WhatsApp when we do. Never promise to send it later, never ask them to wait, never point them to another app.
- Ask a helpful follow-up question to qualify their loan needs.`

export const DEFAULT_INSTAGRAM_COMMENT: InstagramCommentScripts = {
  publicReply: `You are Priya, senior loan advisor at Right Agent Group responding to a public Instagram post comment from @{username}.
Always provide a concise, high-converting public reply (under 25 words) that instructs them to check their direct message (DM).
Example: "Hi @{username}, check your DM! Sent you the complete loan details and rate chart directly 📩"`,
  privateDm: `Hi @{username}! Thanks for checking out our post. I'm Priya, senior loan advisor at Right Agent Group.
We arrange Home Loans (from 7.25% p.a.), Business Loans (up to ₹75 Lakhs), and Loan Against Property with 20+ top banks in Hyderabad with 0 advance fees.

💬 Ask any questions directly on WhatsApp with our senior loan advisor:
https://wa.me/918333993223?text=Hi%20Right%20Agent%20Group,%20I%20commented%20on%20Instagram%20and%20want%20to%20know%20more%20about%20loans

Feel free to ask any questions on WhatsApp or reply right here in this DM!`,
}

export type VoiceOpenerFamily =
  | "disclosure"
  | "cold"
  | "returning"
  | "inbound"
  | "whatsappCallback"

export type VoiceOpeners = Record<
  `${VoiceOpenerFamily}` | `${VoiceOpenerFamily}WithName`,
  Record<ScriptLanguage, string>
>

export const DEFAULT_VOICE_OPENERS: VoiceOpeners = {
  disclosure: {
    english:
      "Hi, I'm NIAT's AI Admissions Assistant. This call is being recorded for quality purposes. May I continue?",
    hindi:
      "नमस्ते, मैं NIAT का AI Admissions Assistant हूँ। यह कॉल रिकॉर्ड की जा रही है। क्या हम बात जारी रख सकते हैं?",
    telugu:
      "నమస్తే, నేను NIAT AI Admissions Assistant ని. ఈ కాల్ రికార్డ్ అవుతోంది. మనం మాట్లాడవచ్చా?",
  },
  disclosureWithName: {
    english:
      "Hi {name}, I'm NIAT's AI Admissions Assistant. This call is being recorded for quality purposes. May I continue?",
    hindi:
      "नमस्ते {name}, मैं NIAT का AI Admissions Assistant हूँ। यह कॉल रिकॉर्ड की जा रही है। क्या हम बात जारी रख सकते हैं?",
    telugu:
      "నమస్తే {name}, నేను NIAT AI Admissions Assistant ని. ఈ కాల్ రికార్డ్ అవుతోంది. మనం మాట్లాడవచ్చా?",
  },
  cold: {
    english:
      "Hi! I'm calling from NIAT Admissions. Are you exploring college options after 12th?",
    hindi:
      "नमस्ते! मैं NIAT Admissions से बोल रही हूँ। क्या आप 12वीं के बाद college options देख रहे हैं?",
    telugu:
      "హలో! నేను NIAT Admissions నుండి మాట్లాడుతున్నాను. మీరు 12th తర్వాత college options చూస్తున్నారా?",
  },
  coldWithName: {
    english:
      "Hi {name}! I'm calling from NIAT Admissions. Are you interested in technology-focused programmes?",
    hindi:
      "नमस्ते {name}! मैं NIAT Admissions से बोल रही हूँ। क्या आप technology programmes में interested हैं?",
    telugu:
      "హాయ్ {name}! నేను NIAT Admissions నుండి మాట్లాడుతున్నాను. మీకు technology programmes పై ఆసక్తి ఉందా?",
  },
  returning: {
    english:
      "Hi! I'm following up on your NIAT enquiry. Have you had a chance to discuss it with your family?",
    hindi:
      "नमस्ते! आपकी NIAT enquiry के बारे में दोबारा कॉल किया है। क्या आपने परिवार से बात की?",
    telugu:
      "హలో! మీ NIAT enquiry గురించి మళ్లీ కాల్ చేశాను. మీ కుటుంబ సభ్యులతో మాట్లాడారా?",
  },
  returningWithName: {
    english:
      "Hi {name}! Just following up on your NIAT enquiry. Do you have any questions?",
    hindi:
      "नमस्ते {name}! आपकी NIAT enquiry के बारे में follow-up कर रही हूँ। कोई सवाल है?",
    telugu:
      "హాయ్ {name}! మీ NIAT enquiry గురించి follow-up చేస్తున్నాను. ఏమైనా సందేహాలున్నాయా?",
  },
  inbound: {
    english:
      "Welcome to NIAT Admissions! I'm your AI assistant. How can I help you?",
    hindi:
      "NIAT Admissions में आपका स्वागत है! मैं आपकी AI Assistant हूँ। कैसे मदद कर सकती हूँ?",
    telugu:
      "NIAT Admissions కి స్వాగతం! నేను మీ AI Assistant ని. మీకు ఎలా సహాయం చేయగలను?",
  },
  inboundWithName: {
    english:
      "Hi {name}! Welcome to NIAT Admissions. What information are you looking for?",
    hindi:
      "नमस्ते {name}! NIAT Admissions में आपका स्वागत है। आपको क्या जानकारी चाहिए?",
    telugu:
      "నమస్తే {name}! NIAT Admissions కి స్వాగతం. మీకు ఏ సమాచారం కావాలి?",
  },
  whatsappCallback: {
    english:
      "Hi! I'm calling from NIAT about your WhatsApp enquiry. Is this a good time to talk?",
    hindi:
      "नमस्ते! आपकी WhatsApp enquiry के बारे में NIAT से कॉल कर रही हूँ। क्या अभी बात कर सकते हैं?",
    telugu:
      "హలో! మీ WhatsApp enquiry గురించి NIAT నుండి కాల్ చేస్తున్నాను. ఇప్పుడు మాట్లాడవచ్చా?",
  },
  whatsappCallbackWithName: {
    english:
      "Hi {name}! I'm calling about your NIAT WhatsApp enquiry. How can I help you?",
    hindi:
      "नमस्ते {name}! आपकी NIAT WhatsApp enquiry के बारे में कॉल कर रही हूँ। कैसे मदद कर सकती हूँ?",
    telugu:
      "హాయ్ {name}! మీ NIAT WhatsApp enquiry గురించి కాల్ చేస్తున్నాను. ఎలా సహాయం చేయగలను?",
  },
}

export type VoiceClosings = Record<
  "qualified" | "goodbye" | "retry" | "rateLimit",
  Record<ScriptLanguage, string>
>

export const DEFAULT_VOICE_CLOSINGS: VoiceClosings = {
  qualified: {
    english:
      "Thanks, {name}! I'll share the official NIAT details and application link on WhatsApp. Our admissions team can guide you further.",
    hindi:
      "धन्यवाद, {name}! मैं आपको NIAT की official details और application link WhatsApp पर भेज दूँगी। हमारी admissions team आगे मदद करेगी।",
    telugu:
      "ధన్యవాదాలు, {name}! NIAT official details మరియు application link మీ WhatsApp కి పంపిస్తాను. మా admissions team మీకు మరింత సహాయం చేస్తుంది.",
  },
  goodbye: {
    english: "Thank you for speaking with NIAT. Have a great day. Goodbye!",
    hindi: "NIAT से बात करने के लिए धन्यवाद। आपका दिन शुभ हो। अलविदा!",
    telugu: "NIAT తో మాట్లాడినందుకు ధన్యవాదాలు. మీ రోజు సంతోషంగా గడవాలి. బై!",
  },
  retry: {
    english: "Sorry, I missed that. Could you please repeat?",
    hindi: "माफ़ कीजिए, मैं समझ नहीं पाई। क्या आप दोबारा बता सकते हैं?",
    telugu: "క్షమించండి, నాకు సరిగ్గా అర్థం కాలేదు. మరోసారి చెప్పగలరా?",
  },
  rateLimit: {
    english:
      "Sorry, we're experiencing a technical issue. Please try again later. Thank you!",
    hindi:
      "माफ़ कीजिए, अभी technical issue है। कृपया थोड़ी देर बाद संपर्क करें। धन्यवाद!",
    telugu:
      "క్షమించండి, ప్రస్తుతం technical issue ఉంది. కొద్దిసేపటి తర్వాత మళ్లీ ప్రయత్నించండి. ధన్యవాదాలు!",
  },
}

export type WhatsAppFallbacks = Record<
  "formLink" | "callFollowup" | "missedCall",
  string
>

export const DEFAULT_WHATSAPP_FALLBACKS: WhatsAppFallbacks = {
  formLink: `Hi {name}! Thanks for speaking with NIAT Admissions. Please complete your admissions enquiry here: {link}\n\nOfficial NIAT Admissions Assistance. — NIAT`,
  callFollowup: `Hi {name}! Thanks for speaking with NIAT Admissions. Feel free to message us here anytime with questions about courses, campuses, or NAT.\n\n— NIAT Admissions`,
  missedCall: `Hi {name}! We tried calling you from NIAT Admissions regarding technology programmes after 12th. Reply here or call us back anytime.\n\n— NIAT Admissions`,
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
