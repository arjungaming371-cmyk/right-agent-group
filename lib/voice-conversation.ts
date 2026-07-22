import { randomUUID } from "crypto"
import { db, query } from "./db"
import { chatWithLLM, chatWithLLMStream, extractLeadInfo, mightBeComplete, isRateLimitError, type Language } from "./llm"
import { splitSentences } from "./sentences"
import { sendApplicationLink } from "./whatsapp"
import { buildLeadBrief, runPostCallAnalysis } from "./lead-brain"
import { searchKnowledgeBase } from "./knowledge-base"
import { buildEmiInstruction, buildEligibilityInstruction, buildRateInstruction, detectLoanType } from "./finance"
import { detectFrustration, flagFrustratedCall } from "./frustration"
import { createNotification } from "./notifications"
import { maybeProposeLoanEdit } from "./loan-edit-requests"

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
export const GREETINGS: Record<Language, string> = {
  english:
    "Hello, good morning! This is Priya calling from Right Agent Group, Hyderabad — we help people get loans from over 20 banks without the running around. Do you have a minute? I'd love to know if you have any loan or financial need right now.",
  hindi:
    "Namaste, good morning! Main Priya bol rahi hoon Right Agent Group, Hyderabad se — hum log 20+ banks se loan dilwane mein madad karte hain, bina bank bank ghume. Ek minute hai aapke paas? Bataiye, aapko koi loan ya financial zaroorat hai kya abhi?",
  telugu:
    "Namaskaram! Nenu Priya, Right Agent Group, Hyderabad nunchi matladutunnanu — memu 20+ banks tho kalisi meeku easy ga loan dorikేలా help chestham, bank bank tirగakunda. Meeku konchem time undha? Ippudu meeku edaina loan lేదా financial avasaram unda ani తెలుసుకోవాలని అనుకుంటున్నా.",
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
  english: "Thank you! I'm sending a simple loan application on your WhatsApp right now — just fill it in, and our loan officer will personally consult you after that. Have a great day!",
  hindi: "Dhanyavad! Main abhi aapke WhatsApp pe ek simple loan application bhej rahi hoon — bas usko fill kar dijiyega, uske baad hamare loan officer aapse personally baat karke consult karenge. Aapka din shubh ho!",
  telugu: "Dhanyavadalu! Nenu ippude mee WhatsApp ki oka simple loan application pampistunnanu — danini fill cheyandi chalu, aa tarvata maa loan officer mee tho personal ga matladi consult chestaru. Meeku manchi roju!",
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
    hindi: `Namaste ${name} ji! Main Priya bol rahi hoon, Right Agent Group, Hyderabad se — hum 20+ banks se loan dilwane mein madad karte hain. Ek minute hai aapke paas? Bataiye, aapko koi loan zaroorat hai kya abhi?`,
    telugu: `Namaskaram ${name} garu! Nenu Priya, Right Agent Group, Hyderabad nunchi matladutunnanu — memu 20+ banks tho kalisi meeku easy ga loan dorikేలా help chestham. Meeku konchem time undha? Ippudu edaina loan avasaram unda ani తెలుసుకోవాలని అనుకుంటున్నా.`,
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

// Used ONLY when the LLM backend is genuinely out of capacity (Groq 429) —
// retrying won't help mid-call since the rate window doesn't clear in the
// next few seconds, so stringing the customer along with repeated
// "technical moment" replies is worse than ending politely and calling
// back once things clear.
const RATE_LIMIT_REPLY: Record<Language, string> = {
  english: "Sorry sir, we're having a brief network issue on our end. I'll have someone call you back in a few minutes to continue — thank you for your patience!",
  hindi:   "Sorry sir, hamari taraf se thodi network problem aa rahi hai. Kuch minute mein hum aapko wapas call karenge — dhanyavad!",
  telugu:  "Sorry sir, maa vaipu nunchi konchem network problem vachindi. Konni nimishaallo maname malli call chestham — dhanyavadalu!",
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

// Returns the write promise so callers who need ordering guarantees (e.g.
// triggering analysis right after) can await it; normal callers just fire
// it and move on.
async function updateTranscriptAsync(callSid: string | null, speech: string, reply: string): Promise<void> {
  if (!callSid) return
  try {
    const { data: existing } = await db.from("voice_calls").select("transcript").eq("twilio_call_sid", callSid).single()
    let prev: any[] = []
    if (existing?.transcript) prev = typeof existing.transcript === "string" ? JSON.parse(existing.transcript) : existing.transcript
    await db
      .from("voice_calls")
      .update({
        transcript: JSON.stringify([...prev, { role: "customer", text: speech }, { role: "ai", text: reply }]),
        status: "in-progress",
      })
      .eq("twilio_call_sid", callSid)
  } catch (e: any) {
    console.error("transcript update error:", e)
  }
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

  // REAL MATH: an LLM asked "what's my EMI" will confidently invent a
  // plausible-sounding but WRONG number. lib/finance.ts does the actual
  // arithmetic here and hands Priya an exact figure to state — she never
  // computes EMI/eligibility herself.
  if (leadId) {
    const [leadRow, memoryRow] = await Promise.all([
      db.from("leads").select("loan_amount, product_interest").eq("id", leadId).single(),
      db.from("lead_memory").select("facts").eq("lead_id", leadId).single(),
    ])
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
  if (!leadId) return false

  // extractLeadInfo only reads what was SPOKEN this call — a returning lead
  // whose name/address is already on file correctly never gets re-asked (by
  // design, see the script's memory rules), so extraction alone reports
  // "incomplete" forever even though the lead genuinely has all three facts.
  // Merge with what the lead record already knows before deciding.
  const existing = await db.from("leads").select("name, address, whatsapp_number").eq("id", leadId).single()
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
  let rateLimited = false
  try {
    reply = (await chatWithLLM(messages, language, mergedInstructions || undefined)).trim()
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
