import { randomUUID } from "crypto"
import { db, query } from "./db"
import { chatWithLLM, chatWithLLMStream, extractLeadInfo, mightBeComplete, type Language } from "./llm"
import { splitSentences } from "./sentences"
import { sendApplicationLink } from "./whatsapp"
import { buildLeadBrief } from "./lead-brain"
import { searchKnowledgeBase } from "./knowledge-base"
import { detectFrustration, flagFrustratedCall } from "./frustration"
import { createNotification } from "./notifications"
import { maybeProposeLoanEdit } from "./loan-edit-requests"

// Permission-based opener — respect keeps people on the line.
// Neutral/informational by design: this is an intake call, not a sales
// pitch, so it states the purpose plainly instead of leading with benefits.
export const GREETINGS: Record<Language, string> = {
  english:
    "Hello, good morning! This is Priya calling from Right Agent Group, Hyderabad. This will take just one minute — I'm calling to note down a few details for a loan application: your name, city, and a WhatsApp number to send the application link. May I have your full name, please?",
  hindi:
    "Namaste, good morning! Main Priya bol rahi hoon Right Agent Group, Hyderabad se. Sirf ek minute lagega — main loan application ke liye kuch details note karne ke liye call kar rahi hoon: aapka naam, city, aur application link bhejne ke liye WhatsApp number. Aapka poora naam bata sakte hain?",
  telugu:
    "Namaskaram! Nenu Priya, Right Agent Group, Hyderabad nunchi matladutunnanu. Okka nimisham chalu — loan application kosam konni details note cheyadaniki call chestunnanu: mee peru, ooru, mariyu application link pampadaniki WhatsApp number. Mee full name cheppagalara?",
}

// Inbound calls are the customer's initiative — greet like a receptionist,
// not a telemarketer. The pitch only comes later, if it fits.
export const INBOUND_GREETINGS: Record<Language, string> = {
  english:
    "Hello! Thank you for calling Right Agent Group, Hyderabad. This is Priya. How can I help you today?",
  hindi:
    "Namaste! Right Agent Group, Hyderabad ko call karne ke liye dhanyavad. Main Priya bol rahi hoon. Batayiye, main aapki kya madad kar sakti hoon?",
  telugu:
    "Namaskaram! Right Agent Group, Hyderabad ki call chesinanduku dhanyavadalu. Nenu Priya. Cheppandi, meeku ela help cheyagalanu?",
}

const CLOSING: Record<Language, string> = {
  english: "Thank you! I'm sending the application link to your WhatsApp right now. Our loan officer will confirm your best offer soon. Have a great day!",
  hindi: "Dhanyavad! Main abhi aapke WhatsApp pe application link bhej rahi hoon. Hamare loan officer jald aapka best offer confirm karenge. Aapka din shubh ho!",
  telugu: "Dhanyavadalu! Nenu ippude mee WhatsApp ki application link pampistunnanu. Maa loan officer tvaralo mee best offer confirm chestaru. Meeku manchi roju!",
}

// Inbound calls auto-create a lead with a placeholder like "Caller 8090"
// before we know the real name — never greet someone by that fake name.
const PLACEHOLDER_NAME_RE = /^Caller \d+$/

function personalizedGreeting(language: Language, name: string): string {
  const templates: Record<Language, string> = {
    english: `Hello ${name}! This is Priya calling from Right Agent Group, Hyderabad. This will take just a minute — I just need to confirm a couple of details and get a WhatsApp number to send your application link.`,
    hindi: `Namaste ${name} ji! Main Priya bol rahi hoon, Right Agent Group, Hyderabad se. Sirf ek minute lagega — mujhe bas kuch details confirm karni hain aur application link bhejne ke liye WhatsApp number chahiye.`,
    telugu: `Namaskaram ${name} garu! Nenu Priya, Right Agent Group, Hyderabad nunchi matladutunnanu. Okka nimisham chalu — nenu konni details confirm chesi, application link pampadaniki WhatsApp number teesukovali.`,
  }
  return templates[language]
}

function personalizedInboundGreeting(language: Language, name: string): string {
  const templates: Record<Language, string> = {
    english: `Hello ${name}! Thank you for calling Right Agent Group, Hyderabad. This is Priya. How can I help you today?`,
    hindi: `Namaste ${name} ji! Right Agent Group, Hyderabad ko call karne ke liye dhanyavad. Main Priya bol rahi hoon. Batayiye, main aapki kya madad kar sakti hoon?`,
    telugu: `Namaskaram ${name} garu! Right Agent Group, Hyderabad ki call chesinanduku dhanyavadalu. Nenu Priya. Cheppandi, meeku ela help cheyagalanu?`,
  }
  return templates[language]
}

const RETRY_MSG: Record<Language, string> = {
  english: "Sorry, I had a small technical moment. Could you please share your name so I can send your loan application link?",
  hindi:   "Maaf kijiye, chhoti technical problem hui. Kripya apna naam batayein taaki main aapka loan application link bhej sakoon.",
  telugu:  "Sorry, chinna technical problem vachindi. Dayachesi mee peru cheppandi, mee loan application link pampistanu.",
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

// Short, warm sign-off — NOT the link-sending CLOSING above, which promises a
// WhatsApp message that may not exist yet.
const GOODBYE_REPLY: Record<Language, string> = {
  english: "Thank you for your time! Have a great day. Goodbye!",
  hindi: "Aapke samay ke liye dhanyavad! Aapka din shubh ho. Namaste!",
  telugu: "Mee time ki dhanyavadalu! Meeku manchi roju. Namaskaram!",
}

/** Called on the first webhook hit of a call (before any speech). Bumps call_count once per call. */
export async function startCall(
  leadId: string,
  callSid: string,
  language: Language,
  direction: "inbound" | "outbound" = "outbound"
): Promise<string> {
  if (leadId) {
    query(`UPDATE leads SET call_count = call_count + 1, last_called_at = now() WHERE id = $1`, [leadId]).catch((e) =>
      console.error("call_count update error:", e)
    )
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
      .catch(() => {})
  }

  // Known real name (not the inbound placeholder)? Greet by name instead of
  // generically — a fast lookup, no LLM call, so call pickup stays quick.
  if (leadId) {
    try {
      const res = await query(`SELECT name FROM leads WHERE id = $1`, [leadId])
      const name = res.rows[0]?.name
      if (name && !PLACEHOLDER_NAME_RE.test(name)) {
        return direction === "inbound" ? personalizedInboundGreeting(language, name) : personalizedGreeting(language, name)
      }
    } catch (e: any) {
      console.error("greeting name lookup error:", e.message)
    }
  }

  return direction === "inbound" ? INBOUND_GREETINGS[language] : GREETINGS[language]
}

async function getHistory(callSid: string): Promise<{ role: "user" | "model"; content: string }[]> {
  try {
    const { data } = await db.from("voice_calls").select("transcript").eq("twilio_call_sid", callSid).single()
    if (!data?.transcript) return []
    const transcript = typeof data.transcript === "string" ? JSON.parse(data.transcript) : data.transcript
    if (!Array.isArray(transcript)) return []
    return transcript
      .map((t: any) => ({ role: t.role === "ai" ? ("model" as const) : ("user" as const), content: t.text ?? "" }))
      .filter((m: any) => m.content)
  } catch {
    return []
  }
}

function updateTranscriptAsync(callSid: string | null, speech: string, reply: string): void {
  if (!callSid) return
  db.from("voice_calls")
    .select("transcript")
    .eq("twilio_call_sid", callSid)
    .single()
    .then(({ data: existing }: any) => {
      let prev: any[] = []
      if (existing?.transcript) prev = typeof existing.transcript === "string" ? JSON.parse(existing.transcript) : existing.transcript
      return db
        .from("voice_calls")
        .update({
          transcript: JSON.stringify([...prev, { role: "customer", text: speech }, { role: "ai", text: reply }]),
          status: "in-progress",
        })
        .eq("twilio_call_sid", callSid)
    })
    .catch((e: any) => console.error("transcript update error:", e))
}

/** Per-turn context assembly shared by both turn paths (blocking + streaming). */
async function buildTurnInstructions(
  leadId: string,
  history: { role: "user" | "model"; content: string }[],
  instructions: string | undefined,
  speech: string,
  callerPhone: string | undefined
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
  if (leadId) {
    const brief = await buildLeadBrief(leadId)
    merged = [merged, brief].filter(Boolean).join("\n\n")
  }

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
  const kbContext = await searchKnowledgeBase(speech)
  if (kbContext) merged = [merged, kbContext].filter(Boolean).join("\n\n")

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
async function completeLeadIfReady(opts: {
  leadId: string
  callSid: string | null
  callerPhone?: string
  messages: { role: "user" | "model"; content: string }[]
  reply: string
}): Promise<boolean> {
  const { leadId, callSid, callerPhone, messages, reply } = opts
  const allTurns = [...messages, { role: "model" as const, content: reply }]
  const transcriptText =
    (callerPhone ? `(The customer is calling from: ${callerPhone}. Use this as their whatsapp_number ONLY if they EXPLICITLY said WhatsApp is on this same number — if they never mentioned their WhatsApp number, leave whatsapp_number null.)\n` : "") +
    allTurns.map((m) => `${m.role === "model" ? "Priya" : "Customer"}: ${m.content}`).join("\n")

  if (!mightBeComplete(transcriptText)) return false
  const extracted = await extractLeadInfo(transcriptText)
  if (!extracted.complete || !leadId) return false

  try {
    const updates: Record<string, any> = {
      status: "contacted",
      updated_at: new Date().toISOString(),
      interested: extracted.interested === true ? "interested" : extracted.interested === false ? "not_interested" : "unknown",
    }
    if (extracted.name) updates.name = extracted.name
    if (extracted.address) updates.address = extracted.address
    if (extracted.whatsapp_number) updates.whatsapp_number = extracted.whatsapp_number
    await db.from("leads").update(updates).eq("id", leadId)

    const token = randomUUID()
    await db.from("form_links").insert({ token, lead_id: leadId })

    const waNumber = extracted.whatsapp_number
    if (waNumber) {
      const result = await sendApplicationLink(waNumber, extracted.name || "there", token)
      if (!result.ok) console.error("WhatsApp link send failed:", result.error)
      // Mark this call as already followed-up so the status webhook doesn't
      // ALSO send the generic post-call WhatsApp message once the call ends.
      // Only on SUCCESS — if the link send failed, the post-call fallback
      // template is the customer's only remaining automatic touchpoint.
      if (callSid && result.ok) {
        db.from("voice_calls").update({ followup_sent: true }).eq("twilio_call_sid", callSid).catch(() => {})
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
      }).catch(() => {})
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

export async function handleTurn(opts: {
  leadId: string
  callSid: string | null
  speech: string
  language: Language
  callerPhone?: string
  instructions?: string
}): Promise<{ text: string; hangup: boolean }> {
  const { leadId, callSid, speech, language, callerPhone, instructions } = opts

  const history = callSid ? await getHistory(callSid) : []
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

  const mergedInstructions = await buildTurnInstructions(leadId, history, instructions, speech, callerPhone)

  let reply = ""
  try {
    reply = (await chatWithLLM(messages, language, mergedInstructions || undefined)).trim()
    if (!reply) reply = GREETINGS[language]
  } catch (e) {
    console.error("LLM error:", e)
    reply = RETRY_MSG[language]
  }

  updateTranscriptAsync(callSid, speech, reply)
  maybeProposeLoanEdit(leadId, "priya_voice", speech)

  const completed = await completeLeadIfReady({ leadId, callSid, callerPhone, messages, reply })
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
  },
  onSentence: (sentence: string) => void
): Promise<{ hangup: boolean }> {
  const { leadId, callSid, speech, language, callerPhone, instructions } = opts

  const history = callSid ? await getHistory(callSid) : []

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

  const mergedInstructions = await buildTurnInstructions(leadId, history, instructions, speech, callerPhone)

  let reply = ""
  let pending = ""
  try {
    reply = (
      await chatWithLLMStream(messages, language, mergedInstructions || undefined, (delta) => {
        pending += delta
        const { complete, rest } = splitSentences(pending)
        for (const s of complete) onSentence(s)
        pending = rest
      })
    ).trim()
    const tail = pending.trim()
    if (tail) onSentence(tail)
    if (!reply) {
      reply = GREETINGS[language]
      onSentence(reply)
    }
  } catch (e) {
    console.error("LLM error:", e)
    const msg = RETRY_MSG[language]
    updateTranscriptAsync(callSid, speech, msg)
    onSentence(msg)
    return { hangup: false }
  }

  updateTranscriptAsync(callSid, speech, reply)
  maybeProposeLoanEdit(leadId, "priya_voice", speech)

  const completed = await completeLeadIfReady({ leadId, callSid, callerPhone, messages, reply })
  if (completed) {
    onSentence(CLOSING[language])
    return { hangup: true }
  }

  return { hangup: GOODBYE_RE.test(reply) }
}
