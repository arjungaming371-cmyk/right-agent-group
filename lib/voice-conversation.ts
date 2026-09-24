import { randomUUID } from "crypto"
import { db, query } from "./db"
import { chatWithLLM, chatWithLLMStream, extractLeadInfo, mightBeComplete, isRateLimitError, type Language } from "./llm"
import { splitSentences } from "./sentences"
import { sendApplicationLink } from "./whatsapp"
import { buildLeadBrief, runPostCallAnalysis } from "./lead-brain"
import { searchKnowledgeBase } from "./knowledge-base"
import { buildEmiInstruction, buildEligibilityInstruction, buildRateInstruction, detectLoanType } from "./finance"
import { detectFrustration, flagFrustratedCall, detectHumanRequest, flagHumanRequested } from "./frustration"
import { createNotification } from "./notifications"
import { maybeProposeLoanEdit } from "./loan-edit-requests"
import { currentDateTimeInstruction } from "./compliance"

// Permission-based opener — respect keeps people on the line.
// Neutral/informational by design: this is an intake call, not a sales
// pitch, so it states the purpose plainly instead of leading with benefits.
// This is the FIRST line of every outbound call — spoken before the AI
// conversation even starts, so it must already match the script's "have a
// real conversation first, collect details only later" flow. It used to
// jump straight to "may I have your full name" as the opening sentence,
// defeating the whole discovery/convince flow before it began. Now it
// introduces Priya + the company and opens the floor, exactly like a human
// cold-caller would — name/city/WhatsApp come later, once there's a reason to.
// SCRIPT MATTERS HERE — these are spoken aloud, and the TTS service picks the
// VOICE from the script, not from the `language` argument (any run of Latin
// letters is treated as an English loanword, by design, so English words in a
// native sentence keep their real pronunciation).
//
// So while these lines were written in Roman Tenglish/Hinglish, every one of
// them was spoken end to end by the ENGLISH voice — "Namaskaram" pronounced by
// an English speaker — while the model's own replies, which CALL_LANGUAGE_STYLES
// asks for in native script, came out of the Telugu/Hindi voice. Two different
// women in one call, and the fixed half mispronounced.
//
// Written in native script they get the native voice, matching the model's
// replies: one consistent Priya for the whole call. English loanwords stay in
// Latin letters on purpose — that is exactly what CALL_LANGUAGE_STYLES asks the
// model for, and the TTS stitching handles it.
//
// These constants are used ONLY on the call path. WhatsApp replies stay Roman
// (LANGUAGE_STYLES) so the ops team can read them on the dashboard.
export const GREETINGS: Record<Language, string> = {
  english:
    "Hello, good morning! This is Priya calling from Right Agent Group, Hyderabad — we help people get loans from over 20 banks without the running around. Do you have a minute? I'd love to know if you have any loan or financial need right now.",
  hindi:
    "नमस्ते, good morning! मैं प्रिया बोल रही हूं Right Agent Group, Hyderabad से — हम बीस से ज़्यादा banks से loan दिलवाने में मदद करते हैं, बिना bank bank घूमे। एक minute है आपके पास? बताइए, आपको कोई loan या financial ज़रूरत है क्या अभी?",
  telugu:
    "నమస్కారం! నేను ప్రియ, Right Agent Group, Hyderabad నుండి మాట్లాడుతున్నాను — మేము ఇరవైకి పైగా banks తో కలిసి మీకు సులభంగా loan దొరికేలా help చేస్తాము, bank bank తిరగకుండా. మీకు కొంచెం సమయం ఉందా? ఇప్పుడు మీకు ఏదైనా loan లేదా financial అవసరం ఉందా అని తెలుసుకోవాలని అనుకుంటున్నాను.",
}

// Repeat outbound calls to the same lead (call_count > 0 before this call)
// used to replay the exact same cold-open pitch every single time —
// "we help people get loans from 20+ banks..." on call 5 sounds exactly
// like what it is: a script replaying, not a person who remembers them.
// Short, warm follow-up instead — the LLM's own REAL MEMORY instructions
// pick up the specific details once the conversation continues from here.
export const RETURNING_GREETINGS: Record<Language, string> = {
  english:
    "Hello again! This is Priya from Right Agent Group, following up on your loan interest — do you have a minute?",
  hindi:
    "नमस्ते! मैं प्रिया, Right Agent Group से, फिर से call कर रही हूं आपके loan interest के बारे में follow-up के लिए — एक minute है क्या?",
  telugu:
    "నమస్కారం! నేను ప్రియ, Right Agent Group నుండి, మీ loan interest గురించి follow-up చేస్తున్నాను — కొంచెం time ఉందా?",
}

function personalizedReturningGreeting(language: Language, name: string): string {
  const templates: Record<Language, string> = {
    english: `Hello ${name}! Priya here again from Right Agent Group. Just following up on our last conversation about your loan — do you have a moment?`,
    hindi: `नमस्ते ${name} जी! मैं प्रिया, Right Agent Group से, फिर से call कर रही हूं। आपके loan के बारे में follow-up करना था — एक minute है क्या?`,
    telugu: `నమస్కారం ${name} గారు! నేను ప్రియ, Right Agent Group నుండి మళ్ళీ call చేస్తున్నాను. మీ loan గురించి follow-up చేద్దామా అనుకుంటున్నాను — కొంచెం time ఉందా?`,
  }
  return templates[language]
}

// Inbound calls are the customer's initiative — greet like a receptionist,
// not a telemarketer. The pitch only comes later, if it fits.
export const INBOUND_GREETINGS: Record<Language, string> = {
  english:
    "Hello! Thank you for calling Right Agent Group, Hyderabad. This is Priya. How can I help you today?",
  hindi:
    "नमस्ते! Right Agent Group, Hyderabad को call करने के लिए धन्यवाद। मैं प्रिया बोल रही हूं। बताइए, मैं आपकी क्या मदद कर सकती हूं?",
  telugu:
    "నమస్కారం! Right Agent Group, Hyderabad కి call చేసినందుకు ధన్యవాదాలు. నేను ప్రియ. చెప్పండి, మీకు ఎలా help చేయగలను?",
}

const CLOSING: Record<Language, string> = {
  english: "Thank you! I'm sending a simple loan application on your WhatsApp right now — just fill it in, and our loan officer will personally consult you after that. Have a great day!",
  hindi: "धन्यवाद! मैं अभी आपके WhatsApp पे एक simple loan application भेज रही हूं — बस उसको fill कर दीजिएगा, उसके बाद हमारे loan officer आपसे personally बात करके consult करेंगे। आपका दिन शुभ हो!",
  telugu: "ధన్యవాదాలు! నేను ఇప్పుడే మీ WhatsApp కి ఒక simple loan application పంపిస్తున్నాను — దాన్ని fill చేయండి చాలు, ఆ తర్వాత మా loan officer మీతో వ్యక్తిగతంగా మాట్లాడి సలహా ఇస్తారు. మీకు మంచి రోజు జరగాలి!",
}

// Inbound calls auto-create a lead with a placeholder like "Caller 8090"
// before we know the real name — never greet someone by that fake name.
const PLACEHOLDER_NAME_RE = /^(Caller \d+|Unknown|WA \d+)$/i

// Same fix as GREETINGS above, for when the lead's name is already known
// (most outbound calls — CSV uploads, manual adds, repeat callers). This
// used to skip straight to "confirm details and get WhatsApp" as the FIRST
// thing said — before the AI ever got to ask what they need or make a
// case. Now it greets by name and opens the conversation like a human
// would; discovery/convince/collect all happen through the real script.
function personalizedGreeting(language: Language, name: string): string {
  const templates: Record<Language, string> = {
    english: `Hello ${name}! This is Priya calling from Right Agent Group, Hyderabad — we help people get loans from over 20 banks without the running around. Do you have a minute? I'd love to know if you have any loan need right now.`,
    hindi: `नमस्ते ${name} जी! मैं प्रिया बोल रही हूं, Right Agent Group, Hyderabad से — हम बीस से ज़्यादा banks से loan दिलवाने में मदद करते हैं। एक minute है आपके पास? बताइए, आपको कोई loan ज़रूरत है क्या अभी?`,
    telugu: `నమస్కారం ${name} గారు! నేను ప్రియ, Right Agent Group, Hyderabad నుండి మాట్లాడుతున్నాను — మేము ఇరవైకి పైగా banks తో కలిసి మీకు సులభంగా loan దొరికేలా help చేస్తాము. మీకు కొంచెం సమయం ఉందా? ఇప్పుడు ఏదైనా loan అవసరం ఉందా అని తెలుసుకోవాలని అనుకుంటున్నాను.`,
  }
  return templates[language]
}

function personalizedInboundGreeting(language: Language, name: string): string {
  const templates: Record<Language, string> = {
    english: `Hello ${name}! Thank you for calling Right Agent Group, Hyderabad. This is Priya. How can I help you today?`,
    hindi: `नमस्ते ${name} जी! Right Agent Group, Hyderabad को call करने के लिए धन्यवाद। मैं प्रिया बोल रही हूं। बताइए, मैं आपकी क्या मदद कर सकती हूं?`,
    telugu: `నమస్కారం ${name} గారు! Right Agent Group, Hyderabad కి call చేసినందుకు ధన్యవాదాలు. నేను ప్రియ. చెప్పండి, మీకు ఎలా help చేయగలను?`,
  }
  return templates[language]
}

const RETRY_MSG: Record<Language, string> = {
  english: "Sorry, I had a small technical moment. Could you please share your name so I can send your loan application link?",
  hindi:   "माफ़ कीजिए, छोटी technical problem हुई। कृपया अपना नाम बताएं ताकि मैं आपका loan application link भेज सकूं।",
  telugu:  "Sorry, చిన్న technical problem వచ్చింది. దయచేసి మీ పేరు చెప్పండి, మీ loan application link పంపిస్తాను.",
}

// Used ONLY when the LLM backend is genuinely out of capacity (Groq 429) —
// retrying won't help mid-call since the rate window doesn't clear in the
// next few seconds, so stringing the customer along with repeated
// "technical moment" replies is worse than ending politely and calling
// back once things clear.
const RATE_LIMIT_REPLY: Record<Language, string> = {
  english: "Sorry sir, we're having a brief network issue on our end. I'll have someone call you back in a few minutes to continue — thank you for your patience!",
  hindi:   "Sorry sir, हमारी तरफ से थोड़ी network problem आ रही है। कुछ minute में हम आपको वापस call करेंगे — धन्यवाद!",
  telugu:  "Sorry sir, మా వైపు నుండి కొంచెం network problem వచ్చింది. కొన్ని నిమిషాల్లో మేము మళ్ళీ call చేస్తాము — ధన్యవాదాలు!",
}

// FIXED: only real goodbye phrases end the call.
// Plain "thank you" / "धन्यवाद" / "ధన్యవాదాలు" must NOT hang up —
// Priya says thanks naturally in the middle of a conversation.
const GOODBYE_RE =
  /goodbye|bye[- ]?bye|have a (great|good|nice) day|din shubh ho|phir milenge|alvida|manchi roju|selavu|veedkolu|अलविदा|फिर मिलेंगे|दिन शुभ हो|వీడ్కోలు|సెలవు|మంచి రోజు జరగాలి/i

// CUSTOMER-side goodbye: when the CALLER says bye, the call is over — full
// stop. Observed live: customer said "Thank you. Bye." and Priya kept
// probing for a WhatsApp number, which reads as pushy and disrespectful.
// \b keeps "bye" from matching inside other words; Telugu/Hindi phrases are
// the common phone sign-offs ("I'll hang up now", "I'll take leave").
const CUSTOMER_BYE_RE =
  /\b(bye|goodbye|bye[- ]?bye)\b|రేపు మాట్లాడుదాం|సెలవు|ఉంటాను మరి|పెట్టేస్తున్నాను|फोन रखत[ाी] हूँ?|रखत[ाी] हूँ?|अलविदा|बाय/i

// VOICEMAIL / ANSWERING MACHINE detection — checked ONLY on the very first
// thing heard after an OUTBOUND greeting (history.length === 0). Deliberately
// narrow: only phrases that are unambiguously part of a recorded voicemail
// prompt ("leave a message", "after the beep/tone", "voicemail/mailbox").
// Broader network phrases like "switched off" or "not reachable" are left
// OUT on purpose — a real busy lead could plausibly say something similar
// about themselves ("sorry, my phone was switched off"), and wrongly
// hanging up on a live human is worse than occasionally missing a real
// voicemail and burning one extra turn talking to a machine.
const VOICEMAIL_RE =
  /leave (a|your) message|after the (tone|beep)|voice ?mail|mailbox( is full)?|record your message|please try your call (again )?later|message chhod|beep ke baad|message pettandi|beep tarvata/i

// Short, warm sign-off — NOT the link-sending CLOSING above, which promises a
// WhatsApp message that may not exist yet.
const GOODBYE_REPLY: Record<Language, string> = {
  english: "Thank you for your time! Have a great day. Goodbye!",
  hindi: "आपके समय के लिए धन्यवाद! आपका दिन शुभ हो। नमस्ते!",
  telugu: "మీ సమయానికి ధన్యవాదాలు! మీకు మంచి రోజు జరగాలి. నమస్కారం!",
}

/** Called on the first webhook hit of a call (before any speech). Bumps call_count once per call. */
export async function startCall(
  leadId: string,
  callSid: string,
  language: Language,
  direction: "inbound" | "outbound" = "outbound"
): Promise<string> {
  // Read name + call_count BEFORE bumping call_count below, so "is this a
  // repeat call" reflects the count going INTO this call, not after it.
  let name: string | undefined
  let isRepeatCall = false
  if (leadId) {
    // FIX (2026-09-20): the read and the fire-and-forget increment could
    // interleave with a duplicate `start` webhook (double count). One
    // atomic statement increments AND returns the pre/post state.
    try {
      const res = await query(
        `UPDATE leads SET call_count = call_count + 1, last_called_at = now()
         WHERE id = $1
         RETURNING name, call_count, (call_count = 1) AS first_call`,
        [leadId]
      )
      name = res.rows[0]?.name
      isRepeatCall = !res.rows[0]?.first_call
    } catch (e) {
      console.error("greeting name/call_count update error:", e instanceof Error ? e.message : e)
    }
  }
  if (callSid) {
    // NOTE: no `direction` here on purpose — the row already exists by this point
    // (outbound: inserted by POST /api/calls; inbound: inserted by /api/calls/turn
    // just before this runs). Overwriting it would relabel inbound calls as outbound.
    //
    // NOTE: no `transcript` here on purpose either — the column already defaults
    // to '[]' on INSERT (local-setup.sql), and upsert() writes EXCLUDED.<col> for
    // every column present in the values object on conflict. If Exotel ever resends
    // a "start" event mid-call (reconnect/retry) and startCall() re-runs, including
    // transcript here would silently wipe the whole conversation back to empty —
    // observed as Priya "reintroducing herself" with no memory of what was just said.
    db.from("voice_calls")
      .upsert(
        {
          twilio_call_sid: callSid,
          lead_id: leadId || null,
          status: "in-progress",
          language,
        },
        { onConflict: "twilio_call_sid" }
      )
      .catch((e) =>
        // A swallowed failure here used to erase the entire call's conversation
        // record with no trace — now it is at least visible in the pm2 logs.
        console.error("voice_calls upsert error (call row may be missing/stale):", e instanceof Error ? e.message : e))
  }

  const hasName = name && !PLACEHOLDER_NAME_RE.test(name)

  if (direction === "inbound") {
    return hasName ? personalizedInboundGreeting(language, name!) : INBOUND_GREETINGS[language]
  }
  if (isRepeatCall) {
    return hasName ? personalizedReturningGreeting(language, name!) : RETURNING_GREETINGS[language]
  }
  return hasName ? personalizedGreeting(language, name!) : GREETINGS[language]
}

async function getHistory(callSid: string): Promise<{ role: "user" | "model"; content: string }[]> {
  try {
    const { data } = await db.from("voice_calls").select("transcript").eq("twilio_call_sid", callSid).single()
    if (!data?.transcript) return []
    const transcript = typeof data.transcript === "string" ? JSON.parse(data.transcript) : data.transcript
    if (!Array.isArray(transcript)) return []
    // FIX (2026-09-20): re-parsed + returned in full on EVERY turn — cap the
    // working set (the reply path only ever uses the last 12 messages, and
    // extraction now takes 12 too).
    return (transcript as { role?: unknown; text?: unknown }[])
      .slice(-40)
      .map((t) => ({ role: t.role === "ai" ? ("model" as const) : ("user" as const), content: typeof t.text === "string" ? t.text : "" }))
      .filter((m) => m.content)
  } catch {
    return []
  }
}

// Returns the write promise so callers who need ordering guarantees (e.g.
// triggering analysis right after) can await it; normal callers just fire
// it and move on.
async function updateTranscriptAsync(callSid: string | null, speech: string, reply: string): Promise<void> {
  if (!callSid) return
  try {
    // Atomic DB-side append (COALESCE + ||) instead of read-modify-write in
    // JS — most callers fire this without awaiting it, so a JS-side
    // read-then-write let an overlapping turn's write land on stale data
    // and silently drop earlier turns from the saved transcript.
    const newTurns = JSON.stringify([{ role: "customer", text: speech }, { role: "ai", text: reply }])
    await query(
      `UPDATE voice_calls
          SET transcript = COALESCE(transcript, '[]'::jsonb) || $2::jsonb,
              status = 'in-progress'
        WHERE twilio_call_sid = $1`,
      [callSid, newTurns]
    )
  } catch (e) {
    console.error("transcript update error:", e)
  }
}

/**
 * Rewrite the last AI reply in a call's transcript to what the caller
 * actually heard, after the voicebot cut it short on a barge-in.
 *
 * This matters because getHistory() feeds this column straight back to the
 * model every turn — leave the full generated reply in place and Priya spends
 * the rest of the call believing she said things the caller never heard.
 *
 * Every clause of the guard is load-bearing:
 *  - '{-1,text}' addresses the LAST element's text key (jsonb paths count
 *    negative indices from the end), so no subquery is needed.
 *  - to_jsonb($2::text), not $2::jsonb — escapes server-side, so a reply
 *    containing a quote can't blow up the statement.
 *  - the trailing false is create_missing: if the element somehow has no
 *    text key, leave it alone rather than inventing one.
 *  - `transcript -> -1 ->> 'role' = 'ai'` is simultaneously the role check,
 *    the non-empty check and the is-an-array check: on '[]', on a non-array,
 *    and on SQL NULL it yields NULL, so the row simply doesn't match. Note
 *    that jsonb_array_length() is deliberately NOT AND-ed in — SQL does not
 *    guarantee short-circuit evaluation, so it could be evaluated against a
 *    non-array row and raise, turning a harmless no-op into a 500.
 *  - no status write (unlike updateTranscriptAsync): a correction must never
 *    resurrect a call that already completed.
 */
export async function correctLastSpokenReply(callSid: string, spokenText: string): Promise<boolean> {
  if (!callSid) return false
  try {
    const res = await query(
      `UPDATE voice_calls
          SET transcript = jsonb_set(transcript, '{-1,text}', to_jsonb($2::text), false),
              updated_at = now()
        WHERE twilio_call_sid = $1
          AND jsonb_typeof(transcript) = 'array'
          AND transcript -> -1 ->> 'role' = 'ai'`,
      [callSid, spokenText]
    )
    return (res.rowCount || 0) > 0
  } catch (e) {
    console.error("transcript correction error:", e)
    return false
  }
}

/**
 * The three per-turn reads that depend ONLY on the lead and what was just
 * said — never on the conversation history. Split out from
 * buildTurnInstructions so the caller can start them BEFORE awaiting the
 * transcript read (see handleTurn/handleTurnStream): the history query and
 * these have no dependency on each other, so running them back to back was
 * stacking two round-trips of dead air in front of every single turn.
 *
 * Each read catches its own failure. Both callers kick this off before the
 * turn is known to need it (a voicemail/goodbye turn returns early without
 * ever awaiting the result), and a rejected promise nobody awaits is an
 * unhandled rejection. Degrading to "no brief"/"no KB context" also beats
 * killing a live call over one failed lookup, which is what the previous
 * uncaught version did.
 */
function startTurnContext(leadId: string, speech: string) {
  return Promise.all([
    leadId ? buildLeadBrief(leadId).catch(() => "") : Promise.resolve(""),
    searchKnowledgeBase(speech).catch(() => ""),
    leadId
      ? Promise.all([
          db.from("leads").select("loan_amount, product_interest").eq("id", leadId).single(),
          db.from("lead_memory").select("facts").eq("lead_id", leadId).single(),
        ]).catch(() => null)
      : Promise.resolve(null),
  ])
}

type TurnContext = Awaited<ReturnType<typeof startTurnContext>>

/** Per-turn context assembly shared by both turn paths (blocking + streaming). */
async function buildTurnInstructions(
  leadId: string,
  history: { role: "user" | "model"; content: string }[],
  instructions: string | undefined,
  speech: string,
  callerPhone: string | undefined,
  contextPromise: Promise<TurnContext>
): Promise<string> {
  // LEAD BRAIN: brief Priya with the full cross-channel picture — known
  // facts, rolling relationship summary, recent interactions, sentiment
  // warnings — every turn. Raw history alone isn't reliable enough at
  // tracking "already answered" facts (observed live: the model re-asked
  // for info the customer had already given), so the brief's explicit
  // "don't re-ask known facts" instruction needs to stay in context for the
  // whole call, not just the open. One cheap query (lib/lead-brain.ts), no
  // live LLM analysis.
  let merged = instructions || ""

  // DATE/TIME AWARENESS: without this the model has no idea what the real
  // date/time is — can't correctly say "today"/"tomorrow", the right
  // weekday, or judge whether a promised callback slot has already passed.
  merged = [merged, currentDateTimeInstruction()].filter(Boolean).join("\n\n")

  // SPEED: brief/KB-search/finance-rows are three independent reads that
  // used to run as three separate sequential awaits — none of them needs
  // another's result, so that was pure added silence before the LLM call
  // even starts. They now run together AND overlap the transcript read that
  // used to precede them (startTurnContext, fired by the caller), so the
  // wait here is whichever single read is slowest rather than the sum.
  const [brief, kbContext, financeRows] = await contextPromise

  if (brief) merged = [merged, brief].filter(Boolean).join("\n\n")

  // GROUNDING: give Priya the real caller number every turn. Without it, a
  // customer saying "same number / this number" left the model with nothing
  // to anchor on — observed live inventing "9888888888" out of thin air.
  // A single short line per turn; costs a handful of tokens.
  if (callerPhone) {
    merged = [
      merged,
      `The customer is calling from ${callerPhone}. If they say their WhatsApp is this same number, use it — never say or invent any phone number yourself.`,
    ].filter(Boolean).join("\n\n")
  }

  // KNOWLEDGE BASE: unlike the Lead Brain brief above, this runs on EVERY
  // turn — a question about documents/eligibility/rates can land at any
  // point in the call, not just the opening. One cheap indexed query.
  if (kbContext) merged = [merged, kbContext].filter(Boolean).join("\n\n")

  // REAL MATH: an LLM asked "what's my EMI" will confidently invent a
  // plausible-sounding but WRONG number. lib/finance.ts does the actual
  // arithmetic here and hands Priya an exact figure to state — she never
  // computes EMI/eligibility herself.
  if (leadId && financeRows) {
    const [leadRow, memoryRow] = financeRows
    const knownIncome = memoryRow.data?.facts?.monthly_income ? Number(memoryRow.data.facts.monthly_income) : null

    // Loan type may have been mentioned in an EARLIER turn ("I have a shop,
    // want to expand") while the rate/EMI QUESTION comes later ("what's the
    // interest?") — detecting only off the current utterance missed that
    // and silently fell back to Home Loan. Scan the whole conversation.
    const conversationSoFar = [...history.map((h) => h.content), speech].join(" ")
    const detectedType = detectLoanType(conversationSoFar) || leadRow.data?.product_interest || null
    if (detectedType && detectedType !== leadRow.data?.product_interest) {
      db.from("leads").update({ product_interest: detectedType }).eq("id", leadId).catch(() => {})
    }

    const rate = buildRateInstruction(speech, { loanType: detectedType })
    if (rate) merged = [merged, rate].filter(Boolean).join("\n\n")

    const emi = buildEmiInstruction(speech, {
      loanAmount: leadRow.data?.loan_amount ? Number(leadRow.data.loan_amount) : null,
      loanType: detectedType,
    })
    if (emi) merged = [merged, emi.instruction].filter(Boolean).join("\n\n")

    const eligibility = buildEligibilityInstruction(speech, {
      loanType: detectedType,
      monthlyIncome: knownIncome,
    })
    if (eligibility) merged = [merged, eligibility.instruction].filter(Boolean).join("\n\n")
  }

  return merged
}

/**
 * Post-reply completion check shared by both turn paths. Returns true when
 * the lead just became complete (name + city + WhatsApp all known): saves the
 * lead, creates the one-time form link, sends/logs the WhatsApp message.
 *
 * SPEED FIX: a lead can only be complete once a WhatsApp number exists in
 * the transcript. Skip the second (expensive) LLM extraction call until a
 * phone-number-like string actually appears — most turns stay at ONE model
 * call. The caller-phone header both grounds the extractor for "same number"
 * answers AND lets mightBeComplete() pass without spoken digits.
 */
/**
 * Cheap client-side pre-check mirroring mightBeComplete: lets the caller hear
 * the closing sentence immediately while completeLeadIfReady's extraction LLM
 * + WhatsApp round-trips run in the background of the same turn.
 */
function mightBeCompleteQuick(
  messages: { role: "user" | "model"; content: string }[],
  reply: string
): boolean {
  const transcriptText =
    [...messages, { role: "model" as const, content: reply }]
      .map((m) => `${m.role === "model" ? "Priya" : "Customer"}: ${m.content}`)
      .join("\n")
  return mightBeComplete(transcriptText)
}

async function completeLeadIfReady(opts: {
  leadId: string
  callSid: string | null
  callerPhone?: string
  messages: { role: "user" | "model"; content: string }[]
  reply: string
  branchId?: string | null
}): Promise<boolean> {
  const { leadId, callSid, callerPhone, messages, reply, branchId } = opts
  // FIX (2026-09-20): extraction used to receive the ENTIRE transcript (the
  // main reply is capped at 12 messages, but this LLM call fired on any
  // potentially-complete turn with everything ever said) — growing token
  // cost + per-turn CPU on the hot path. Name/number surface late in calls
  // anyway; the last 12 turns are what matters.
  const allTurns = [...messages.slice(-12), { role: "model" as const, content: reply }]
  const transcriptText =
    (callerPhone ? `(The customer is calling from: ${callerPhone}. Use this as their whatsapp_number ONLY if they EXPLICITLY said WhatsApp is on this same number — if they never mentioned their WhatsApp number, leave whatsapp_number null.)\n` : "") +
    allTurns.map((m) => `${m.role === "model" ? "Priya" : "Customer"}: ${m.content}`).join("\n")

  if (!mightBeComplete(transcriptText)) return false
  const extracted = await extractLeadInfo(transcriptText)
  if (!leadId) return false

  // extractLeadInfo only reads what was SPOKEN this call — a returning lead
  // whose name/address is already on file correctly never gets re-asked (by
  // design, see the script's memory rules), so extraction alone reports
  // "incomplete" forever even though the lead genuinely has all three facts.
  // Merge with what the lead record already knows before deciding.
  const existing = await db.from("leads").select("name, address, whatsapp_number, status").eq("id", leadId).single()

  // If the lead was already completed (status is no longer 'new') before this call,
  // do not trigger the auto-onboarding completion hangup.
  if (existing.data?.status && existing.data?.status !== "new") return false

  const knownName = existing.data?.name && !PLACEHOLDER_NAME_RE.test(existing.data.name) ? existing.data.name : null
  const effectiveName = extracted.name || knownName
  const effectiveAddress = extracted.address || existing.data?.address || null
  const effectiveWhatsapp = extracted.whatsapp_number || existing.data?.whatsapp_number || null

  if (!effectiveName || !effectiveAddress || !effectiveWhatsapp) return false

  try {
    const updates: Record<string, any> = {
      status: "contacted",
      updated_at: new Date().toISOString(),
      interested: extracted.interested === true ? "interested" : extracted.interested === false ? "not_interested" : "unknown",
    }
    if (extracted.name) updates.name = extracted.name
    if (extracted.address) updates.address = extracted.address
    if (extracted.whatsapp_number) updates.whatsapp_number = extracted.whatsapp_number
    // RACE GATE (2026-09 fix): the status read above and this update are not
    // atomic — two overlapping turns/webhooks for the same lead could both
    // read status='new' and BOTH create a form link and message the customer.
    // Making the completion itself conditional (…WHERE status = 'new') means
    // exactly one writer wins: the loser's update matches 0 rows and returns
    // without sending anything. (Postgres evaluates WHERE against the OLD row,
    // so filtering on the same column we're setting is correct.)
    const claim = await db.from("leads").update(updates).eq("id", leadId).eq("status", "new")
    if (!claim.data || (Array.isArray(claim.data) && claim.data.length === 0)) {
      console.log(`lead ${leadId} completion race lost — another turn already completed it, skipping duplicate form link/send`)
      return false
    }

    const token = randomUUID()
    await db.from("form_links").insert({ token, lead_id: leadId })

    const waNumber = extracted.whatsapp_number
    if (waNumber) {
      // Per-branch WhatsApp: the link goes out from the BRANCH's WABA number
      // (branded with the branch's name), or the company number when the
      // branch has none.
      const { branchWhatsAppCtx } = await import("./whatsapp")
      const waBranch = await branchWhatsAppCtx(branchId)
      const result = await sendApplicationLink(waNumber, extracted.name || "there", token, waBranch)
      if (!result.ok) console.error("WhatsApp link send failed:", result.error)
      // Mark this call as already followed-up so the status webhook doesn't
      // ALSO send the generic post-call WhatsApp message once the call ends.
      // Only on SUCCESS — if the link send failed, the post-call fallback
      // template is the customer's only remaining automatic touchpoint.
      if (callSid && result.ok) {
        db.from("voice_calls").update({ followup_sent: true }).eq("twilio_call_sid", callSid).catch((e) =>
          console.error("followup_sent flag error (status webhook may double-message):", e instanceof Error ? e.message : e))
      }
      // Surface the exact link in the dashboard's Communication Log.
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")
      db.from("comm_logs").insert({
        lead_id: leadId,
        type: "whatsapp",
        summary: result.ok
          ? `Application form link sent on WhatsApp to ${waNumber}: ${appUrl}/form/${token}`
          : `Application form link generated but WhatsApp send FAILED (${result.error}) — share manually: ${appUrl}/form/${token}`,
        outcome: result.ok ? "sent" : "failed",
      }).catch((e) => console.error("comm_log form-link entry error:", e instanceof Error ? e.message : e))
      // Priya just told the customer "the link is on its way" — if the send
      // actually failed, ping the operator to share it manually before the
      // customer gives up waiting.
      if (!result.ok) {
        createNotification({
          type: "whatsapp_message",
          title: "Form link send FAILED — share manually",
          body: `${extracted.name || waNumber}: WhatsApp send failed (${result.error}). Link: ${appUrl}/form/${token}`,
          linkView: "leads",
        })
      }
    }
  } catch (e) {
    console.error("lead completion error:", e)
  }
  return true
}

// Marks the call outcome as "voicemail" and closes it out — same bookkeeping
// completeLeadIfReady/rate-limit paths do (status completed + post-call
// analysis), so a voicemail hit shows up correctly in Voice Logs instead of
// sitting at "in-progress" or "resolved".
async function markVoicemail(callSid: string | null, speech: string): Promise<void> {
  if (!callSid) return
  // Awaited (unlike the normal fire-and-forget transcript path) so
  // runPostCallAnalysis below reads the completed transcript, not a
  // still-in-flight write.
  await updateTranscriptAsync(callSid, speech, "(Detected voicemail/answering machine — call ended)")
  await db.from("voice_calls").update({ outcome: "voicemail", status: "completed" }).eq("twilio_call_sid", callSid).catch((e) =>
    console.error("voicemail mark error:", e instanceof Error ? e.message : e))
  runPostCallAnalysis(callSid)
}

export async function handleTurn(opts: {
  leadId: string
  callSid: string | null
  speech: string
  language: Language
  callerPhone?: string
  instructions?: string
  direction?: "inbound" | "outbound"
  /** Multi-branch: the branch the call belongs to (branch scripts + branding + per-branch WhatsApp). */
  branchId?: string | null
}): Promise<{ text: string; hangup: boolean }> {
  const { leadId, callSid, speech, language, callerPhone, instructions, direction, branchId } = opts

  // Fire the history-independent reads NOW, so they overlap the transcript
  // read instead of queueing behind it (see startTurnContext).
  const contextPromise = startTurnContext(leadId, speech)
  const history = callSid ? await getHistory(callSid) : []

  // VOICEMAIL: only ever checked on the first thing heard after our own
  // OUTBOUND greeting (history empty) — a mid-call false match would risk
  // cutting off a real, ongoing conversation.
  if (history.length === 0 && direction === "outbound" && VOICEMAIL_RE.test(speech)) {
    await markVoicemail(callSid, speech)
    return { text: "", hangup: true }
  }

  const messages = [...history, { role: "user" as const, content: speech }]

  // The CALLER said goodbye → say a short goodbye back and end the call.
  // No LLM turn: asking anything more after "bye" is exactly the pushy
  // behavior a human agent would never do. History must be non-empty so a
  // first-utterance misfire can't kill a call that just connected.
  if (history.length > 0 && CUSTOMER_BYE_RE.test(speech)) {
    const reply = GOODBYE_REPLY[language]
    updateTranscriptAsync(callSid, speech, reply)
    return { text: reply, hangup: true }
  }

  // FRUSTRATION RADAR: zero-latency keyword pass; flagging is fire-and-forget.
  if (detectFrustration(speech, history.map((h) => ({ role: h.role === "model" ? "model" : "user", content: h.content })))) {
    flagFrustratedCall(callSid, leadId || null, speech)
  }
  // Calm request for a human — separate from frustration (see frustration.ts).
  if (detectHumanRequest(speech)) {
    flagHumanRequested(callSid, leadId || null, speech)
  }

  const mergedInstructions = await buildTurnInstructions(leadId, history, instructions, speech, callerPhone, contextPromise)

  let reply = ""
  let rateLimited = false
  try {
    reply = (await chatWithLLM(messages, language, mergedInstructions || undefined, { channel: "call", branchId })).trim()
    if (!reply) reply = GREETINGS[language]
  } catch (e) {
    console.error("LLM error:", e)
    if (isRateLimitError(e)) {
      rateLimited = true
      reply = RATE_LIMIT_REPLY[language]
    } else {
      reply = RETRY_MSG[language]
    }
  }

  if (rateLimited) {
    // Cut the call NOW rather than let the customer sit through more dead
    // turns — the token window won't clear in the next few seconds. AWAIT
    // the transcript write (unlike the normal fire-and-forget path) before
    // triggering analysis, so Lead Brain reads the complete transcript
    // instead of racing the save — a follow-up call needs everything
    // learned so far to continue the thread instead of starting cold.
    await updateTranscriptAsync(callSid, speech, reply)
    maybeProposeLoanEdit(leadId, "priya_voice", speech)
    if (callSid) {
      await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
      runPostCallAnalysis(callSid)
    }
    return { text: reply, hangup: true }
  }

  updateTranscriptAsync(callSid, speech, reply)
  maybeProposeLoanEdit(leadId, "priya_voice", speech)

  const completed = await completeLeadIfReady({ leadId, callSid, callerPhone, messages, reply, branchId })
  if (completed) return { text: CLOSING[language], hangup: true }

  return { text: reply, hangup: GOODBYE_RE.test(reply) }
}

/**
 * Streaming twin of handleTurn for the live voicebot: sentences are pushed to
 * onSentence AS THE MODEL WRITES THEM, so TTS + playback of sentence 1
 * overlaps generation of sentence 2. Same context, same rules, same post-turn
 * logic. Differences by design:
 *  - on lead completion the CLOSING line is emitted as an EXTRA sentence
 *    (the reply already streamed out — it can't be replaced retroactively).
 *  - returns only control data; the text has already been delivered.
 */
export async function handleTurnStream(
  opts: {
    leadId: string
    callSid: string | null
    speech: string
    language: Language
    callerPhone?: string
    instructions?: string
    direction?: "inbound" | "outbound"
    /** Multi-branch: the branch the call belongs to (branch scripts + branding + per-branch WhatsApp). */
    branchId?: string | null
  },
  onSentence: (sentence: string) => void
): Promise<{ hangup: boolean }> {
  const { leadId, callSid, speech, language, callerPhone, instructions, direction, branchId } = opts

  // Fire the history-independent reads NOW, so they overlap the transcript
  // read instead of queueing behind it (see startTurnContext). This is the
  // live-call path — every millisecond here is silence on the caller's ear.
  const contextPromise = startTurnContext(leadId, speech)
  const history = callSid ? await getHistory(callSid) : []

  // VOICEMAIL: see handleTurn's identical check for why this is restricted
  // to the first turn of an outbound call only.
  if (history.length === 0 && direction === "outbound" && VOICEMAIL_RE.test(speech)) {
    await markVoicemail(callSid, speech)
    return { hangup: true }
  }

  if (history.length > 0 && CUSTOMER_BYE_RE.test(speech)) {
    const reply = GOODBYE_REPLY[language]
    updateTranscriptAsync(callSid, speech, reply)
    onSentence(reply)
    return { hangup: true }
  }

  const messages = [...history, { role: "user" as const, content: speech }]

  if (detectFrustration(speech, history.map((h) => ({ role: h.role === "model" ? "model" : "user", content: h.content })))) {
    flagFrustratedCall(callSid, leadId || null, speech)
  }
  if (detectHumanRequest(speech)) {
    flagHumanRequested(callSid, leadId || null, speech)
  }

  const mergedInstructions = await buildTurnInstructions(leadId, history, instructions, speech, callerPhone, contextPromise)

  let reply = ""
  let pending = ""
  try {
    reply = (
      await chatWithLLMStream(messages, language, mergedInstructions || undefined, (delta) => {
        pending += delta
        const { complete, rest } = splitSentences(pending)
        for (const s of complete) onSentence(s)
        pending = rest
      }, "call", { branchId })
    ).trim()
    const tail = pending.trim()
    if (tail) onSentence(tail)
    if (!reply) {
      reply = GREETINGS[language]
      onSentence(reply)
    }
  } catch (e) {
    console.error("LLM error:", e)
    if (isRateLimitError(e)) {
      const msg = RATE_LIMIT_REPLY[language]
      await updateTranscriptAsync(callSid, speech, msg)
      onSentence(msg)
      if (callSid) {
        await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
        runPostCallAnalysis(callSid)
      }
      return { hangup: true }
    }
    const msg = RETRY_MSG[language]
    await updateTranscriptAsync(callSid, speech, msg)
    onSentence(msg)
    return { hangup: false }
  }

  // AWAITED, not fire-and-forget: the voicebot may follow this turn with a
  // correction (correctLastSpokenReply) when the caller barged in, and that
  // POST must not race the append it is correcting. Costs the caller nothing —
  // every sentence has already streamed out above, so the only thing gated is
  // the "done" line, and the very next statement already awaits
  // completeLeadIfReady, which can run a whole second LLM call.
  await updateTranscriptAsync(callSid, speech, reply)
  maybeProposeLoanEdit(leadId, "priya_voice", speech)

  // FIX (2026-09-20): the closing sentence used to be spoken only AFTER
  // completeLeadIfReady finished — and it runs a second LLM call + a branch
  // WhatsApp round-trip (0.5-15s of dead air) while the caller waits. Speak
  // first, complete after; completion only decides the hangup now.
  if (mightBeCompleteQuick(messages, reply)) {
    onSentence(CLOSING[language])
  }
  const completed = await completeLeadIfReady({ leadId, callSid, callerPhone, messages, reply, branchId })
  if (completed) {
    return { hangup: true }
  }

  return { hangup: GOODBYE_RE.test(reply) }
}
