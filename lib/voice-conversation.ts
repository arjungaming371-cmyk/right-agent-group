import { randomUUID } from "crypto"
import { db, query } from "./db"
import { chatWithLLM, chatWithLLMStream, extractLeadInfo, mightBeComplete, isRateLimitError, type Language } from "./llm"
import { splitSentences } from "./sentences"
import { sendApplicationLink } from "./whatsapp"
import { buildLeadBrief, runPostCallAnalysis } from "./lead-brain"
import { searchKnowledgeBase } from "./knowledge-base"
import { buildEmiInstruction, buildEligibilityInstruction, buildPrepaymentInstruction, buildRateInstruction, detectLoanType } from "./finance"
import { detectFrustration, flagFrustratedCall, detectHumanRequest, flagHumanRequested, OPERATOR_REPLY_INSTRUCTION } from "./frustration"
import { extractCallFacts, formatInCallFactsBlock } from "./call-facts"
import { analyzeVoiceSpeech } from "./voice-intent"
import { createNotification } from "./notifications"
import { maybeProposeLoanEdit } from "./loan-edit-requests"
import { isAiPaused } from "./ai-pause"
import { currentDateTimeInstruction } from "./compliance"
import { buildReschedule, detectCallerWillCall, type RescheduleMatch } from "./speech-scheduler"
import {
  DEFAULT_VOICE_CLOSINGS,
  DEFAULT_VOICE_OPENERS,
  getVoiceClosingsSnapshot,
  getVoiceOpenersSnapshot,
  refreshChannelScriptsIfStale,
  type VoiceOpenerFamily,
} from "./channel-scripts"

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
// Openers/closings are now EDITABLE from the dashboard (Script Manager →
// Voice tab → ai_scripts rows 'voice_openers' / 'voice_closings', 5-min
// stale-while-revalidate cache in lib/channel-scripts.ts). The exported
// constants below are the code defaults used when no DB row exists.
export const GREETINGS = DEFAULT_VOICE_OPENERS.cold

// Repeat outbound calls to the same lead (call_count > 0 before this call)
// used to replay the exact same cold-open pitch every single time —
// "we help people get loans from 20+ banks..." on call 5 sounds exactly
// like what it is: a script replaying, not a person who remembers them.
// Short, warm follow-up instead — the LLM's own REAL MEMORY instructions
// pick up the specific details once the conversation continues from here.
export const RETURNING_GREETINGS = DEFAULT_VOICE_OPENERS.returning

// Inbound calls are the customer's initiative — greet like a receptionist,
// not a telemarketer. The pitch only comes later, if it fits.
export const INBOUND_GREETINGS = DEFAULT_VOICE_OPENERS.inbound

// Inbound/outbound calls may have a placeholder like "Caller 8090" or "Customer"
// before we know the real name — never greet someone by that placeholder name.
const PLACEHOLDER_NAME_RE = /^(Caller \d+|Unknown|WA \d+|Customer|Lead|User|Sir|Madam|Client|neeku telusuko|telusuko|telusa|cheppanu)$/i

/**
 * Pick the opener for a call: the "{name}" personalized variant when we know
 * the lead's real name, the plain opener otherwise. Both come from the live
 * channel-scripts snapshot (dashboard-editable), falling back to the code
 * defaults per language.
 */
function greetingFor(language: Language, family: VoiceOpenerFamily, name?: string): string {
  const openers = getVoiceOpenersSnapshot()
  const withName = openers[`${family}WithName`]
  if (name && withName?.[language]) return withName[language].replace(/\{name\}/g, name)
  return openers[family][language]
}

/**
 * The mandatory AI + recording disclosure for this language (2026-11-13).
 * Spoken by BOTH transports before the greeting, straight from the turn API —
 * never generated by the model, so it cannot be reworded, shortened or skipped.
 */
export function disclosureFor(language: Language): string {
  try {
    return greetingFor(language, "disclosure")
  } catch {
    return DEFAULT_VOICE_OPENERS.disclosure.english
  }
}

// BUSINESS-INITIATED WHATSAPP CALLBACK — the lead called US on WhatsApp
// (that is exactly who Meta lets us dial back), so the cold pitch is the
// wrong opener: the customer picked up a WhatsApp call from a number they
// contacted, and the first line should CONNECT the two events. "You reached
// out earlier, I'm calling you back" is instantly credible; "we help people
// get loans from 20+ banks" on a callback sounds like the agent has no idea
// who they are. Repeat calls (call_count > 1) keep RETURNING_GREETINGS —
// by then the follow-up framing is correct on every channel.
export const WA_CALLBACK_GREETINGS = DEFAULT_VOICE_OPENERS.whatsappCallback

// RETRY_MSG / RATE_LIMIT_REPLY / CLOSING / GOODBYE_REPLY moved to the
// editable channel-scripts snapshot as 'voice_closings' (keys: retry,
// rateLimit, qualified, goodbye) — same texts as defaults, now editable
// from the dashboard with per-language fallback to these defaults.

// FIXED: only real goodbye phrases end the call.
// Plain "thank you" / "धन्यवाद" / "ధన్యవాదాలు" must NOT hang up —
// Priya says thanks naturally in the middle of a conversation.
export const GOODBYE_RE =
  /\b(goodbye|bye|bye[- ]?bye|take care)\b|have a (great|good|nice|wonderful) day|din shubh ho|phir milenge|alvida|manchi roju|selavu|veedkolu|call cut చేస్తున్నా|call cut chestunna|phone cut చేస్తున్నా|phone cut chestunna|call cut చేస్తాను|call cut chesthanu|call disconnect|अलविदा|फिर मिलेंगे|दिन शुभ हो|వీడ్కోలు|సెలవు|మంచి రోజు జరగాలి/i

// ==============================================================================
// INTENT HIERARCHY: DND -> CALLBACK -> UNAMBIGUOUS GOODBYE -> CONFIRMATION CHECK
// ==============================================================================

// 1. DND (DO NOT CALL) — HIGHEST PRIORITY:
// Apologize once, register number in dnd_suppression, immediately end the call.
export const DND_INTENT_RE = new RegExp(
  [
    // English
    `\\b(?:please\\s+)?(?:don't|do not|never|stop)\\s+(?:call|contact|ring|message|reach)\\b`,
    `\\b(?:please\\s+)?(?:remove|delete|take off)\\s+(?:my\\s+)?(?:number|contact|phone|details|me)\\b`,
    `\\b(?:unsubscribe|put me on (?:the )?(?:dnd|do not call)|add (?:this number )?to (?:the )?(?:dnd|do not call list)|don't call me again|stop calling me|do not call again|never call me again|take me off your list)\\b`,
    `\\b(?:dnd|d\\.n\\.d)\\b.*\\b(?:pettandi|daal do|kardo|kariye|rakho|list)\\b|\\b(?:dnd|d\\.n\\.d)\\s*(?:me|lo|mein)\\b`,
    // Telugu
    `\\b(?:call|calls|phone)\\s+(?:cheyyakandi|cheyoddu|cheyyoddu|cheyakandi|cheyavaddu|vaddu)(?:\\s+andi)?\\b`,
    `\\b(?:malli|inkosari)\\s+(?:call|phone)\\s+(?:cheyyakandi|cheyoddu|cheyyoddu|cheyakandi)\\b`,
    `\\b(?:naaku\\s+calls?\\s+vaddu|calls?\\s+vaddu|malli\\s+(?:call\\s+)?vaddu)\\b`,
    `\\b(?:number|na number)\\s+(?:remove|delete|teeseyandi|theeseyandi)\\s*(?:cheyyandi)?\\b`,
    `కాల్ చేయకండి|కాల్స్ వద్దు|మళ్లీ కాల్ చేయకండి|నెంబర్ తీసేయండి|కాల్ చేయొద్దు|కాల్ చేయవద్దు|కాల్స్ చేయవద్దు|ఇంకెప్పుడూ కాల్ చేయవద్దు|డిలీట్ చేయండి|నాకు కాల్స్ వద్దు|ఫోన్ చేయకండి|నా నెంబర్ తీసేయండి|ఫోన్ చేయొద్దు`,
    // Hindi
    `\\b(?:call|phone)\\s+(?:mat|nahi)\\s+(?:karo|karna|kariye)\\b`,
    `\\b(?:dobara|phir|kabhi)\\s+call\\s+mat\\s+(?:karo|karna|kariye)\\b`,
    `\\b(?:mera\\s+)?number\\s+(?:hata\\s+do|hatao|delete karo|nikal\\s+do|nikalo)\\b`,
    `\\blist\\s+se\\s+(?:nikal\\s+do|nikalo|hata\\s+do|hatao)\\b`,
    `कॉल मत करो|फोन मत करना|दोबारा कॉल मत करना|नंबर हटा दो|मुझे कॉल मत करो`,
  ].join("|"),
  "i"
)

export function detectDndIntent(speech: string): boolean {
  if (!speech) return false
  const safeText = speech.trim().slice(0, 4000)
  return DND_INTENT_RE.test(safeText)
}

// 2. CONTINUATION / QUESTION MARKERS:
// If the caller utterance contains doubt/question markers or contrastive conjunctions
// (e.g., "Chalu, oka doubt undi", "Okay andi, interest rate entha?"), NEVER treat it as an ending!
export const CONTINUATION_INTENT_RE = new RegExp(
  '\\b(' +
  '(?<!no\\s+|no more\\s+|em\\s+|emi\\s+|koi\\s+)(?:doubt|doubts|question|questions)(?!\\s+(?:levu|em levu|levandi|ledu|nahi))|' +
  'oka doubt|oka question|small doubt|last doubt|one last question|last question|actually|wait|adagali|entha|rate|interest|emi|ela|enduku|cheppandi|cheppu|' +
  'clarification|clarify|meeru ippudu|ippudu cheppandi|malli cheppandi|' +
  'kani|kaani|but|okati|ayithe|aithe|' +
  'inka(?!(?:\\s+(?:em|emi))?\\s*(?:vaddu|vaddandi|ledu|ledandi|untanu|cheppoddu))|' +
  'what|how|why|when\\s+(?:can|will|do|is|are|did|does|should|would|to)|when\\?|which|can you|tell me|kya|kaise|kitna|lekin|par' +
  ')\\b|\\?|డౌట్|డౌట్స్|ఒక డౌట్|ఒక ప్రశ్న|చిన్న డౌట్|చివరి డౌట్|ఎంత|ఎలా|ఎందుకు|చెప్పండి|కానీ|కాని|ఇప్పుడు చెప్పండి|' +
  'ఇంకా(?!(?:\\s*(?:ఏం|ఏమీ))?\\s*(?:వద్దు|లేవు|లేదు|ఉంటాను))',
  'i'
)

// 2b. EXPLICIT CALL DISCONNECT / HANGUP COMMANDS:
// When the caller explicitly tells Priya to cut or disconnect the call.
export const CALL_DISCONNECT_RE = new RegExp(
  '\\b(' +
  '(?:calls?|phone|callulu)\\s+(?:cut\\s+cheyandi|cut\\s+cheyyandi|cut\\s+chey|cut\\s+chesta|cut\\s+chestha|cut\\s+chestunna|pettandi|pettestunna|pettestha|pettesthunna|disconnect\\s+cheyandi|disconnect\\s+kandi)|' +
  'cut\\s+(?:the\\s+)?(?:call|calls|phone)|cut\\s+(?:call|calls|phone)|' +
  'disconnect\\s+(?:the\\s+)?(?:call|calls|phone)|hang\\s*up|end\\s+(?:the\\s+)?call|' +
  '(?:call|calls|phone)\\s+(?:kaat\\s+do|kat\\s+do|cut\\s+karo|cut\\s+kardo|rakho|rakh\\s+do|kaatna)' +
  ')\\b|' +
  'కాల్ కట్ చేయండి|కాల్స్ కట్ చేయండి|కాల్ కట్|కాల్ పెట్టండి|ఫోన్ కట్ చేయండి|ఫోన్ పెట్టండి|కాల్ డిస్‌కనెక్ట్ చేయండి|' +
  'कॉल काट दो|कॉल कट करो|फोन काट दो|फोन रखो|कॉल कट कर दो',
  'i'
)

// Negative disconnect markers — when caller specifically asks NOT to hang up or cut the call.
// "cut cheyoddu", "phone cut cheyoddu", "don't hang up", "do not disconnect", "call mat kaatna"
export const NEGATIVE_DISCONNECT_RE = new RegExp(
  '\\b(' +
  '(?:calls?|phone|callulu)?\\s*(?:cut|disconnect|hang\\s*up)?\\s*(?:cheyoddu|cheyoddandi|cheyyoddu|cheyakandi|cheyavaddu|mat\\s+karna|mat\\s+karo|mat\\s+kariye|don\'t|do\\s+not|never)|' +
  '(?:don\'t|do\\s+not|never)\\s+(?:cut|disconnect|hang\\s*up|end)\\s+(?:the\\s+)?(?:call|calls|phone)?|' +
  '(?:cut|disconnect|hang\\s*up)\\s+(?:cheyoddu|cheyoddandi|cheyyoddu|cheyakandi|cheyavaddu)|' +
  '(?:call|calls|phone)\\s+(?:mat\\s+kaato|mat\\s+kaatna|mat\\s+rakho|mat\\s+rakhna|cut\\s+mat\\s+karo|cut\\s+mat\\s+karna)|' +
  'mat\\s+(?:kaato|kaatna|rakho|rakhna)' +
  ')\\b|' +
  'కాల్ కట్ చేయొద్దు|కట్ చేయొద్దు|కట్ చేయకండి|కాల్ కట్ చేయకండి|ఫోన్ కట్ చేయొద్దు|ఫోన్ పెట్టొద్దు|పెట్టొద్దు|కట్ చేయవద్దు|' +
  'कॉल मत काटो|फोन मत काटो|कॉल मत काटना|फोन मत रखना|कट मत करो|कट मत करना',
  'i'
)

export function isCallDisconnectIntent(speech: string): boolean {
  if (!speech) return false
  const safeText = speech.trim().slice(0, 4000)
  if (NEGATIVE_DISCONNECT_RE.test(safeText)) return false
  return CALL_DISCONNECT_RE.test(safeText)
}

// 3. UNAMBIGUOUS GOODBYES:
// Explicit sign-offs that cannot be mistaken for mid-conversation fillers.
export const UNAMBIGUOUS_GOODBYE_RE = new RegExp(
  '\\b(' +
  'bye|goodbye|bye[- ]?bye|bye bye|thanks bye|thank you bye|sare bye|ok bye|okay bye|chalo bye|' +
  'catch you later|talk to you later|see you later|catch up later|call you later|have a good day|have a nice day|good night|take care|bye for now|talk later|' +
  'calls? cut cheyandi|calls? cut cheyyandi|calls? cut chestunna|calls? cut chestha|calls? pettandi|' +
  'phone pettestunna|phone pettestha|phone pettesthunna|phone cut chestunna|phone cut chestha|phone pettandi|phone cut cheyyandi|' +
  'selavu|veedkolu|alvida|phir milenge' +
  ')\\b|' +
  '^(?:sare|ok|okay)[\\s,]+(?:andi[\\s,]+)?(?:thank you|thanks)?\\s*bye[!.]*$|' +
  'కాల్ కట్ చేయండి|కాల్స్ కట్ చేయండి|ఫోన్ పెట్టేస్తున్నా|ఫోన్ కట్ చేస్తున్నా|ఫోన్ పెట్టండి|సెలవు|వీడ్కోలు|సరే బాయ్|ఓకే బాయ్|బాయ్|अलविदा|बाय|फोन रख रहा हूँ|फोन रख रही हूँ',
  'i'
)

// 4. AMBIGUOUS SHORT CLOSINGS (Requiring context check or confirmation):
// Single words like "chalu", "anthe", "untanu", "saripothundi" are ambiguous mid-conversation.
// We only treat them as call endings if Priya just asked if there are any doubts.
export const AMBIGUOUS_CLOSING_RE = new RegExp(
  '\\b(' +
  'no doubts?|no more doubts?|no questions?|all clear|everything clear|that is all|that\'s all|that is it|that\'s it|' +
  'nothing else|nothing more|no thanks?|no thank you|' +
  'em ledu|emi ledu|em ledhu|emi ledhu|em ledandi|emi ledandi|inka em ledu|inka emi ledu|inkem vaddu|inka em vaddu|inka em vaddandi|inkem vaddandi|em vaddu|em vaddandi|emi vaddu|emi vaddandi|inkem ledu|inkem ledhu|' +
  'doubts? em levu|doubts? emi levu|doubts? levu|doubts? levandi|doubt em ledu|doubt ledu|' +
  'chalu|chalandi|chalu sir|avunu chalu|saripothundi|saripoddi|' +
  'anthe|anthe andi|anthe sir|anthey|' +
  'untanu|untanu sir|untanandi|untanu mari|sare untanu|inka untanu|' +
  'koi doubt nahi|kuch nahi|sab clear hai|bas itna hi|itna hi|ho gaya' +
  ')\\b|' +
  '^(no|no sir|no madam|ledu|ledu sir|ledandi|ledu andi|nahi|nahi sir|chalu|anthe|untanu|inkem vaddu|inkem vaddandi|inka em vaddandi)[.!? ]*$|' +
  '^(లేదు|లేదండి|లేదు సర్|ఏం లేదు|ఏమీ లేదు|చాలు|చాలండి|అంతే|ఉంటాను|ఇంకేం వద్దు|ఇంకేం వద్దండి|ఇంకా ఏం వద్దు)[.!? ]*$|' +
  'ఏం లేదు|ఏమీ లేదు|ఏం లేదండి|ఇంకేం లేదు|ఇంకేం వద్దు|ఇంకేం వద్దండి|ఇంకా ఏం వద్దు|ఇంకా ఏం వద్దండి|డౌట్స్ లేవు|డౌట్ లేదు|చాలు|చాలండి|అంతే|సరిపోతుంది|అంతా క్లియర్|క్లియర్ అయింది|' +
  'कोई डाउट नहीं|कुछ नहीं|बस इतना ही|हो गया',
  'i'
)

// Backward-compatible alias
export const CUSTOMER_BYE_RE = UNAMBIGUOUS_GOODBYE_RE

function isAfterDoubtInquiry(history: { role: "user" | "model"; content: string }[]): boolean {
  if (!history || history.length === 0) return false
  const lastModelMsg = [...history].reverse().find((m) => m.role === "model")?.content || ""
  return /\b(doubts?|questions?|clarify|doubt unda|doubts unnaya|doubts emaina|help cheyagalam|help చేయగలం|ఏమైనా సందేహం|డౌట్|డౌట్స్|సందేహాలు|सवाल|पूछना)\b/i.test(lastModelMsg)
}

async function handleDndOptOut(
  leadId: string | null,
  callSid: string | null,
  callerPhone: string | null | undefined,
  language: Language
): Promise<string> {
  let persisted = false
  let phone = callerPhone

  if (!phone && leadId) {
    try {
      const res = await db.from("leads").select("phone").eq("id", leadId).single()
      phone = res.data?.phone || null
    } catch (e: any) {
      console.error("handleDndOptOut phone lookup error:", e?.message)
    }
  }

  if (phone) {
    const digits = String(phone).replace(/\D/g, "").slice(-10)
    if (digits.length === 10) {
      const normalizedPhone = `+91${digits}`
      // Retry persistence up to 3 attempts with exponential backoff
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await query(
            `INSERT INTO dnd_suppression (phone, reason, source, added_by)
             VALUES ($1, 'Customer requested DND on call', 'voice_call', 'priya_voice')
             ON CONFLICT (phone) DO UPDATE SET updated_at = NOW()`,
            [normalizedPhone]
          )
          persisted = true
          break
        } catch (dbErr: any) {
          console.error(`DND persistence attempt ${attempt}/3 failed for ${normalizedPhone}:`, dbErr?.message)
          if (attempt < 3) await new Promise((r) => setTimeout(r, 150 * attempt))
        }
      }
    }
  }

  // Update lead and immediately cease automated outreach
  if (leadId) {
    try {
      await db.from("leads").update({ status: "lost", dnd: true }).eq("id", leadId)
      await db.from("lead_memory").upsert(
        {
          lead_id: leadId,
          stage: "do_not_call",
          summary: "Customer requested Do Not Call during voice call. Immediate suppression enforced.",
        },
        { onConflict: "lead_id" }
      )
      await db.from("comm_logs").insert({
        lead_id: leadId,
        type: "dnd_request",
        summary: persisted
          ? "Customer opted out via voice call (DND verified in database)"
          : "Customer requested DND (DATABASE PERSISTENCE FAILED - OPERATOR ACTION REQUIRED)",
        outcome: persisted ? "suppressed" : "escalated",
      })
    } catch (leadErr: any) {
      console.error("handleDndOptOut lead status update error:", leadErr?.message)
    }
  }

  // If DB persistence failed, escalate to human operator immediately
  if (!persisted) {
    try {
      await query(
        `INSERT INTO escalations (lead_id, call_sid, reason, details, severity)
         VALUES ($1, $2, 'dnd_persistence_failed', $3, 'critical')`,
        [leadId, callSid, `Failed to persist DND suppression for phone ${phone || "unknown"}. Manual suppression required immediately.`]
      )
    } catch (escErr: any) {
      console.error("handleDndOptOut escalation insert error:", escErr?.message)
    }

    // Never falsely claim the number was added to the DND list if database write failed!
    const honestApologies: Record<Language, string> = {
      telugu: "క్షమించండి sir, మీ రిక్వెస్ట్ మేము నోట్ చేసుకున్నాము. ఇకపై మీకు మా టీమ్ నుంచి calls రాకుండా వెంటనే చర్యలు తీసుకుంటాము. Thank you.",
      english: "We sincerely apologize sir. I have urgently flagged your request to stop calls so our team suppresses your number from all outreach. Thank you, goodbye.",
      hindi: "माफ़ कीजिए sir, मैंने आपकी request दर्ज कर ली है ताकि आगे से आपको कोई call न आए। धन्यवाद, good day.",
    }
    return honestApologies[language] || honestApologies.english
  }

  const apologies: Record<Language, string> = {
    telugu: "క్షమించండి sir, ఇకపై మీకు మా నుండి ఎలాంటి calls రావు. Thank you, have a good day.",
    english: "We sincerely apologize sir. Your number has been added to our Do Not Call list and you will not receive any more calls from us. Thank you, goodbye.",
    hindi: "माफ़ कीजिए sir, आपका नंबर DND लिस्ट में जोड़ दिया गया है, आगे से कोई call नहीं आएगी। धन्यवाद, good day.",
  }
  return apologies[language] || apologies.telugu
}

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

/**
 * Persist a speech-parsed callback (Outpero-style smart reschedule) onto the
 * lead + a comm_logs line so the dashboard Calendar shows it immediately.
 * NEVER overwrites a manually-set callback: an operator's explicit booking
 * outranks a regex parse. Best-effort — a failed write must not block hangup.
 */
export async function scheduleSpeechCallback(
  leadId: string,
  callSid: string | null,
  reschedule: RescheduleMatch
): Promise<boolean> {
  try {
    const existing = await query(`SELECT callback_note FROM leads WHERE id = $1 LIMIT 1`, [leadId])
    const existingNote = String(existing.rows[0]?.callback_note || "")
    if (existingNote && !existingNote.startsWith("Auto-scheduled")) {
      console.log(`📅 reschedule skipped: lead ${leadId} has a manual callback (${existingNote.slice(0, 60)})`)
      return false
    }
    const updateRes = await query(
      `UPDATE leads SET callback_at = $1, callback_note = $2 WHERE id = $3`,
      [reschedule.whenIso, reschedule.note, leadId]
    )
    if ((updateRes.rowCount || 0) === 0) {
      console.error(`📅 reschedule update failed for lead ${leadId}`)
      return false
    }
    await db.from("comm_logs").insert({
      lead_id: leadId,
      type: "note",
      summary: `Callback auto-scheduled ${reschedule.desc.english} (customer said it on ${callSid || "call"})`,
      outcome: "pending",
    }).catch(() => {})
    console.log(`📅 reschedule: lead=${leadId} → ${reschedule.whenIso} (${reschedule.desc.english})`)
    return true
  } catch (e) {
    console.error("scheduleSpeechCallback error:", e instanceof Error ? e.message : e)
    return false
  }
}

// Short, warm sign-off — NOT the link-sending 'qualified' closing, which
// promises a WhatsApp message that may not exist yet. Text: voice_closings.goodbye.

/** Called on the first webhook hit of a call (before any speech). Bumps call_count once per call. */
export async function startCall(
  leadId: string,
  callSid: string,
  language: Language,
  direction: "inbound" | "outbound" = "outbound"
): Promise<string> {
  // Pull the freshest dashboard-edited openers/closings (no-op when the
  // 5-min cache is warm; backs off silently if the DB is unreachable).
  await refreshChannelScriptsIfStale().catch(() => {})
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

  let callInstructions = ""
  if (callSid) {
    try {
      const cRes = await query(`SELECT instructions FROM voice_calls WHERE twilio_call_sid = $1 LIMIT 1`, [callSid])
      callInstructions = cRes.rows[0]?.instructions || ""
    } catch {}
  }
  const isEmiCollection = callInstructions && /\b(emi|overdue|due|defaul|not paid|harsh|warning|settle|recover|police|penalty|arrears)\b/i.test(callInstructions)
  const isNonLoanCustom = callInstructions && !/\b(loan|borrow|lakh|crore|home|personal|education|business|emi|cibil|interest)\b/i.test(callInstructions)

  const hasName = name && !PLACEHOLDER_NAME_RE.test(name)
  let greeting = ""

  if (isEmiCollection) {
    if (language === "telugu") {
      greeting = hasName
        ? `నమస్కారం ${name} garu, Right Agent Group నుంచి మాట్లాడుతున్నాను sir. మీ overdue loan EMI payment గురించి మాట్లాడటానికి call చేశాను.`
        : `నమస్కారం sir, Right Agent Group నుంచి మాట్లాడుతున్నాను. మీ overdue loan EMI payment గురించి మాట్లాడటానికి call చేశాను.`
    } else if (language === "hindi") {
      greeting = hasName
        ? `नमस्ते ${name} जी, Right Agent Group से बात कर रही हूँ। आपके overdue loan EMI payment के सिलसिले में call किया है।`
        : `नमस्ते sir, Right Agent Group से बात कर रही हूँ। आपके overdue loan EMI payment के सिलसिले में call किया है।`
    } else {
      greeting = hasName
        ? `Hello ${name}, this is Priya calling from Right Agent Group regarding your overdue loan EMI payment.`
        : `Hello sir, this is Priya calling from Right Agent Group regarding your overdue loan EMI payment.`
    }
  } else if (isNonLoanCustom) {
    if (language === "telugu") {
      greeting = hasName
        ? `నమస్కారం ${name} garu, Right Agent Group నుంచి ప్రియ మాట్లాడుతున్నాను sir. మాట్లాడటానికి ఒక నిమిషం time ఉందా?`
        : `నమస్కారం sir, Right Agent Group నుంచి ప్రియ మాట్లాడుతున్నాను. మాట్లాడటానికి ఒక నిమిషం time ఉందా?`
    } else if (language === "hindi") {
      greeting = hasName
        ? `नमस्ते ${name} जी, Right Agent Group से प्रिया बात कर रही हूँ। क्या आपके पास बात करने के लिए एक मिनट का समय है?`
        : `नमस्ते sir, Right Agent Group से प्रिया बात कर रही हूँ। क्या आपके पास बात करने के लिए एक मिनट का समय है?`
    } else {
      greeting = hasName
        ? `Hello ${name}, this is Priya calling from Right Agent Group. Do you have a minute to speak?`
        : `Hello sir, this is Priya calling from Right Agent Group. Do you have a minute to speak?`
    }
  } else if (direction === "inbound") {
    greeting = greetingFor(language, "inbound", hasName ? name! : undefined)
  } else if (callSid.startsWith("wacall-")) {
    if (isRepeatCall) {
      greeting = greetingFor(language, "returning", hasName ? name! : undefined)
    } else {
      greeting = greetingFor(language, "whatsappCallback", hasName ? name! : undefined)
    }
  } else if (isRepeatCall) {
    greeting = greetingFor(language, "returning", hasName ? name! : undefined)
  } else {
    greeting = greetingFor(language, "cold", hasName ? name! : undefined)
  }

  if (callSid && greeting) {
    query(
      `UPDATE voice_calls
       SET transcript = jsonb_build_array(jsonb_build_object('role', 'ai', 'text', $2::text))
       WHERE twilio_call_sid = $1 AND (transcript IS NULL OR transcript = '[]'::jsonb)`,
      [callSid, greeting]
    ).catch((e) => console.error("error persisting initial greeting to transcript:", e))
  }

  return greeting
}

export function parseTranscriptHistory(rawTranscript: unknown): { role: "user" | "model"; content: string }[] {
  try {
    if (!rawTranscript) return []
    const transcript = typeof rawTranscript === "string" ? JSON.parse(rawTranscript) : rawTranscript
    if (!Array.isArray(transcript)) return []
    // Cap working set to last 40 turns
    return (transcript as { role?: unknown; text?: unknown }[])
      .slice(-40)
      .map((t) => ({
        role: t.role === "ai" ? ("model" as const) : ("user" as const),
        content: typeof t.text === "string"
          ? t.text.replace(/\s*…?\s*\([^)]*interrupted[^)]*\)/gi, "").trim()
          : ""
      }))
      .filter((m) => m.content)
  } catch {
    return []
  }
}

async function getHistory(callSid: string): Promise<{ role: "user" | "model"; content: string }[]> {
  try {
    const { data } = await db.from("voice_calls").select("transcript").eq("twilio_call_sid", callSid).single()
    return parseTranscriptHistory(data?.transcript)
  } catch {
    return []
  }
}

// In-memory 60s cache for finance rows (loan_amount, product_interest, facts)
// so turns 2-10 in a live call do not query Postgres twice every turn.
const _financeRowsCache = new Map<string, { at: number; data: any }>()

export function invalidateFinanceRowsCache(leadId?: string) {
  if (leadId) _financeRowsCache.delete(leadId)
  else _financeRowsCache.clear()
}

async function getCachedFinanceRows(leadId: string) {
  const cached = _financeRowsCache.get(leadId)
  if (cached && Date.now() - cached.at < 60_000) {
    return cached.data
  }
  const data = await Promise.all([
    db.from("leads").select("loan_amount, product_interest").eq("id", leadId).single(),
    db.from("lead_memory").select("facts").eq("lead_id", leadId).single(),
  ])
  _financeRowsCache.set(leadId, { at: Date.now(), data })
  return data
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
    leadId ? getCachedFinanceRows(leadId).catch(() => null) : Promise.resolve(null),
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
  contextPromise: Promise<TurnContext>,
  voiceChannel: "whatsapp" | "phone" = "phone",
  direction?: "inbound" | "outbound"
): Promise<string> {
  // LEAD BRAIN: brief Priya with the full cross-channel picture — known
  // facts, rolling relationship summary, recent interactions, sentiment
  // warnings — every turn. Raw history alone isn't reliable enough at
  // tracking "already answered" facts (observed live: the model re-asked
  // for info the customer had already given), so the brief's explicit
  // "don't re-ask known facts" instruction needs to stay in context for the
  // whole call, not just the open. One cheap query (lib/lead-brain.ts), no
  // live LLM analysis.
  //
  // OPERATOR AGENDA ("What should Priya talk about?"): the instructions text
  // arrives from the voice_calls row (single dials via /api/calls/dial, bulk
  // campaigns via the Call Queue runner) RAW — an unlabeled operator note the
  // model reads like its own thought. Frame it as THE AGENDA for this call
  // and forbid word-for-word recital, so she weaves it into the script
  // naturally instead of robotic monologuing. Both turn paths (blocking +
  // streaming) and both channels (phone + WhatsApp) pass through here.
  const isEmiCollection = Boolean(instructions && /\b(emi|overdue|due|defaul|not paid|harsh|warning|settle|recover|police|penalty|arrears)\b/i.test(instructions))
  const isNonLoanCall = Boolean(instructions && !/\b(loan|borrow|lakh|crore|home|personal|education|business|emi|cibil|interest)\b/i.test(instructions))

  let merged = ""
  if (isEmiCollection) {
    merged = `=== CRITICAL OPERATOR MANDATE: OVERDUE LOAN EMI COLLECTION CALL ===
OPERATOR AGENDA & INSTRUCTIONS FOR THIS CALL:
"${instructions}"

YOU ARE PRIYA IN FIRM DEBT RECOVERY MODE.
THIS IS A COLLECTION CALL FOR A BORROWER WHO HAS NOT PAID THEIR LOAN EMI FOR 5 MONTHS.

STRICT OPERATIONAL DIRECTIVES:
1. OVERRIDE ALL SALES & INTAKE CONTEXT:
   - NEVER pitch new loans, never ask what loan they want, never mention interest rates (like 7.15%), and never invite them for new inquiries!
   - This call is 100% focused on collecting the pending overdue EMI payment.
2. FIRM, FORMAL, DIRECT STATEMENT:
   - State clearly and firmly that their EMI payment is severely overdue (pending for 5 months) and must be paid immediately.
   - Speak authoritatively:
     "Ajay Kumar garu, మీ loan account లో 5 నెలల నుంచి EMI payment pending ఉంది sir. దీన్ని వెంటనే clear చేయాలి."
3. STRICT WARNING & LEGAL NOTICE (FORMAL ESCALATION):
   - The operator instructed to give a strict warning. Use standard, legally enforceable banking recovery warnings:
     "ఈరోజు లోపు payment clear చేయకపోతే, మీ account immediate గా formal legal recovery team కి handover అవుతుంది, severe legal recovery notice issue అవుతుంది, మరియు మీ CIBIL score permanently damage అవుతుంది sir. దయచేసి వెంటనే payment చేయండి."
   - If the borrower tries to make excuses, delays, or tries to dismiss, press firmly:
     "ఇప్పటికే 5 నెలలు overdue అయింది sir. ఇంక ఆలస్యం చేయడానికి వీలులేదు. ఈరోజు ఎన్ని గంటల లోపు payment complete చేస్తారు?"
4. DEMAND PAYMENT COMMITMENT:
   - Demand an exact time and method of payment before ending the call:
     "Online లో UPI/Bank transfer ద్వారా ఇప్పుడే pay చేస్తారా, లేక immediate గా branch కి వచ్చి settle చేస్తారా sir?"`
  } else if (isNonLoanCall) {
    merged = `=== CRITICAL OPERATOR MANDATE: NON-LOAN CUSTOM INSTRUCTIONS CALL ===
OPERATOR AGENDA FOR THIS CALL:
"${instructions}"

STRICT OPERATIONAL DIRECTIVES:
1. THIS IS NOT A LOAN SALES OR INTAKE CALL:
   - STRICT BAN: DO NOT pitch any loan (home loan, personal loan, business loan, education loan).
   - NEVER ask "మీ loan requirement గురించి ఏమైనా doubts ఉన్నాయా", "ఎన్ని lakh loan కావాలి", or ask about loan inquiries!
2. STICK 100% TO THE OPERATOR'S AGENDA:
   - Convey the exact message specified by the operator (e.g. employee reporting instructions, office address, timings, joining details, or general reminder).
   - Address the customer respectfully.
   - If they ask for office address or timings, use the official knowledge base facts:
     * Office: 4-143 Mallikarjuna Complex, 5th Floor, Gandimaisamma X Road, Medchal District (above Masters GYM), Hyderabad.
     * Office Timings: Morning 9 AM to Evening 6 PM.`
  } else if (instructions) {
    merged = `WHAT THIS CALL IS ABOUT — the operator's talking points for THIS call. Work them into the conversation naturally (never recite them word-for-word), open by steering toward this agenda, and stay on it unless the customer redirects:\n${instructions}`
  }

  // DATE/TIME AWARENESS: without this the model has no idea what the real
  // date/time is — can't correctly say "today"/"tomorrow", the right
  // weekday, or judge whether a promised callback slot has already passed.
  merged = [merged, currentDateTimeInstruction()].filter(Boolean).join("\n\n")

  if (direction === "inbound") {
    merged = [
      merged,
      "CALL DIRECTION RULE: THIS IS AN INCOMING / INBOUND CALL. The customer CALLED YOU (Right Agent Group). You ANSWERED their incoming call. NEVER say \"I called you\", \"నేను call చేశాను\", \"call chesaanu\", or \"maine call kiya\" — you did NOT call them, THEY called you. Say \"Right Agent Group ki call chesinanduku thanks\", \"Cheppandi sir, meeku ela help cheyagalanu?\", or \"How can I help you today?\"." ,
    ].filter(Boolean).join("\n\n")
  } else if (direction === "outbound") {
    merged = [
      merged,
      isEmiCollection
        ? "CALL DIRECTION RULE: THIS IS AN OUTBOUND OVERDUE EMI COLLECTION CALL. You placed this call to demand immediate payment of their overdue loan EMI."
        : isNonLoanCall
        ? "CALL DIRECTION RULE: THIS IS AN OUTBOUND OPERATOR-DIRECTED CALL. You placed this call strictly to convey the operator's message and agenda above."
        : "CALL DIRECTION RULE: THIS IS AN OUTBOUND CALL. You placed this call to follow up with the customer about their loan requirement.",
    ].filter(Boolean).join("\n\n")
  }

  // SPEED: brief/KB-search/finance-rows are three independent reads that
  // used to run as three separate sequential awaits — none of them needs
  // another's result, so that was pure added silence before the LLM call
  // even starts. They now run together AND overlap the transcript read that
  // used to precede them (startTurnContext, fired by the caller), so the
  // wait here is whichever single read is slowest rather than the sum.
  const [brief, kbFromSpeech, financeRows] = await contextPromise

  let kbContext = isEmiCollection ? "" : kbFromSpeech

  // KB RETRY WITH CONVERSATION CONTEXT (2026-09-30): the first search uses
  // only the customer's raw words — but on a real call the question is often
  // SPLIT across turns (Priya asks "which product are you looking at?", the
  // customer answers "home loan... and what documents?") or STT-garbled. When
  // that first search missed, retry ONCE with Priya's last question prepended
  // — it usually carries the actual topic. One extra indexed Postgres query,
  // and only on the miss path, so the common case pays nothing.
  if (!isEmiCollection && !kbContext && history.length > 0) {
    const lastPriyaTurn = [...history].reverse().find((h) => h.role === "model")
    if (lastPriyaTurn?.content) {
      kbContext = await searchKnowledgeBase(`${lastPriyaTurn.content} ${speech}`.slice(0, 300)).catch(() => "")
    }
  }

  // If this is an EMI collection call or non-loan call, DO NOT inject the new loan intake brief!
  if (!isEmiCollection && !isNonLoanCall && brief) merged = [merged, brief].filter(Boolean).join("\n\n")

  // IN-CALL FACT MEMORY (2026-09-30): lead_memory is only written AFTER the
  // call (post-call analysis), and the model's live window holds the last 12
  // messages — so facts given early in a longer call (name at turn 2, area at
  // turn 4) fell out of the window and Priya re-asked them, sometimes twice.
  // This deterministic scan of the FULL retained transcript (getHistory keeps
  // the last 40 messages) re-surfaces every answered item, every turn, at
  // zero LLM cost. lib/call-facts.ts is unit-tested.
  const inCallFacts = extractCallFacts(history, speech)
  const inCallFactsBlock = formatInCallFactsBlock(inCallFacts)
  if (inCallFactsBlock) merged = [merged, inCallFactsBlock].filter(Boolean).join("\n\n")

  // VOICE INTENT & OBJECTION INTELLIGENCE
  const semantic = analyzeVoiceSpeech(speech)
  if (semantic.intent === "wait_hold_request") {
    merged = [
      merged,
      `=== CALLER ASKED TO HOLD / WAIT ===
- The caller asked to wait or hold on ("oka nimisham", "one second", "rukiye", "wait", "hold on").
- Respond in 1 brief, courteous sentence confirming you are on the line and waiting:
  * If speaking Telugu: "తప్పకుండా sir, నేను లైన్ లోనే ఉంటాను, మీరు తీరిగ్గా మాట్లాడండి."
  * If speaking Hindi: "ज़रूर sir, मैं लाइन पर हूँ, आप आराम से समय लीजिए।"
  * If speaking English: "Sure sir, I am on the line, please take your time."
- Then STOP speaking immediately and patiently wait for them.`,
    ].filter(Boolean).join("\n\n")
  } else if (semantic.intent === "repeat_request") {
    merged = [
      merged,
      `=== CALLER ASKED TO REPEAT ===
- The caller asked you to repeat what you just said ("malli cheppandi", "phir se boliye", "pardon", "can you repeat", "didn't hear").
- Rephrase your previous point simply and clearly in 1 short sentence. DO NOT repeat the entire greeting or long pitch.`,
    ].filter(Boolean).join("\n\n")
  } else if (semantic.intent === "product_correction" && semantic.productCorrection?.corrected) {
    merged = [
      merged,
      `=== CUSTOMER PRODUCT CORRECTION ===
- Customer explicitly corrected their loan product preference to: ${semantic.productCorrection.corrected.replace(/_/g, " ")}.
- Immediately acknowledge their corrected requirement naturally without arguing or defending your previous statement.
- Transition directly into their requested loan: ${semantic.productCorrection.corrected.replace(/_/g, " ")}.`,
    ].filter(Boolean).join("\n\n")
  } else if (semantic.intent === "objection" && semantic.objectionType) {
    let objectionGuidance = ""
    switch (semantic.objectionType) {
      case "high_interest_rate":
        objectionGuidance = `OBJECTION HANDLING — HIGH INTEREST RATE CONCERN:
- Transparently explain that as an authorized partner for 20+ top banks and NBFCs, Right Agent Group compares rates across all institutions to secure the lowest possible ROI based on their credit profile and current bank offers.
- No high-pressure sales pitch. Offer to check which specific bank provides the lowest rate for their profile.`
        break
      case "processing_fee":
        objectionGuidance = `OBJECTION HANDLING — PROCESSING CHARGES CONCERN:
- Explain that processing charges are determined directly by the sanctioning bank's official schedule, and many partner banks currently offer zero or nominal fee waivers during ongoing seasonal schemes.`
        break
      case "existing_loan":
        objectionGuidance = `OBJECTION HANDLING — ALREADY HAS EXISTING LOAN / EMI:
- Reassure them that having existing loans is common; banks evaluate eligibility based on FOIR (Fixed Obligation to Income Ratio), and options like balance transfer or top-up can actually reduce their overall EMI burden.`
        break
      case "documentation_difficulty":
        objectionGuidance = `OBJECTION HANDLING — DIFFICULT OR MISSING DOCUMENTATION:
- Reassure the caller that we partner with digital, paperless lenders where basic KYC (PAN and Aadhaar) and banking statements are sufficient, and our team assists through the entire paperless process.`
        break
      case "trust_identity":
        objectionGuidance = `OBJECTION HANDLING — TRUST & VERIFICATION / WHO ARE YOU:
- Warmly and professionally state who Right Agent Group is: an authorized financial loan distribution partner with 20+ leading banks, located at Mallikarjuna Complex, 5th Floor, Gandimaisamma X Road, Medchal Hyderabad.
- We never ask for upfront payment or OTPs.`
        break
      case "timing_busy":
        objectionGuidance = `OBJECTION HANDLING — BUSY / BAD TIMING:
- Respect their time immediately! Do not keep talking or pitching. Offer a short, convenient callback: "Sure sir, I completely understand you are busy. When would be a convenient time for our team to call you back?"`
        break
      case "family_consultation":
        objectionGuidance = `OBJECTION HANDLING — NEED TO CONSULT SPOUSE / PARENTS / FAMILY:
- Respect this completely: consulting family is very sensible.
- Offer: "తప్పకుండా sir, ఇంట్లో మాట్లాడి నిర్ణయం తీసుకోండి. మీ reference కోసం ప్రాథమిక వివరాలు WhatsApp లో పంపమంటారా?"`
        break
      case "general_reluctance":
        objectionGuidance = `OBJECTION HANDLING — GENERAL RELUCTANCE / HESITATION:
- Respect their hesitation warmly without being pushy: "No problem sir, we are here to help whenever you need financial assistance. Have a wonderful day!"`
        break
    }
    if (objectionGuidance) {
      merged = [
        merged,
        `=== LIVE OBJECTION GUIDANCE ===\n${objectionGuidance}\n- Strict rule: EMPATHIZE, EXPLAIN TRANSPARENTLY, DO NOT PRESSURE OR ARGUE!`,
      ].filter(Boolean).join("\n\n")
    }
  }

  if (leadId && (inCallFacts.name || inCallFacts.area || inCallFacts.loanAmount)) {
    const liveUpdates: Record<string, any> = {}
    if (inCallFacts.name) liveUpdates.name = inCallFacts.name
    if (inCallFacts.area) liveUpdates.address = inCallFacts.area
    if (inCallFacts.loanAmount) {
      const numMatch = inCallFacts.loanAmount.match(/\d+/)
      if (numMatch) {
        const amt = inCallFacts.loanAmount.includes("lakh") ? Number(numMatch[0]) * 100000 : Number(numMatch[0])
        liveUpdates.loan_amount = amt
      }
    }
    if (Object.keys(liveUpdates).length) {
      db.from("leads").update(liveUpdates).eq("id", leadId).catch(() => {})
    }
  }

  // GROUNDING: give Priya the real caller number every turn. Without it, a
  // customer saying "same number / this number" left the model with nothing
  // to anchor on — observed live inventing "9888888888" out of thin air.
  // A single short line per turn; costs a handful of tokens.
  //
  // FIX (2026-09-26): on WHATSAPP calls the grounding now also CARRIES the
  // channel fact. The old line told Priya the number and nothing else — so on
  // a WhatsApp call, where the script's step 3 said "is your WhatsApp number
  // the same as this call?", she asked a question that makes no sense when
  // the call itself IS on the customer's WhatsApp. Observed live: every
  // WhatsApp call re-asked it. The phone wording is unchanged.
  if (callerPhone && voiceChannel === "whatsapp") {
    merged = [
      merged,
      `THIS CALL IS HAPPENING ON THE CUSTOMER'S WHATSAPP. The customer is calling from ${callerPhone} — that number IS their WhatsApp number.
- NEVER ask "is this your WhatsApp number" or "same or different" or in Telugu "ఇదే WhatsApp number కదా sir?" — that question is WRONG on a WhatsApp call.
- DO NOT push the loan application form link immediately in the early turns! First listen to the caller's requirement, find out what loan they need, and answer their questions. Only suggest sending the application link when they are actually ready to apply.
- When it is time to send the loan form, simply say you are sending it to this same WhatsApp ("నేను మీ WhatsApp కి link పంపిస్తున్నాను") — the send happens automatically to this number. Never say or invent any other phone number.`,
    ].filter(Boolean).join("\n\n")
  } else if (callerPhone) {
    merged = [
      merged,
      `The customer is calling from ${callerPhone}. If they say their WhatsApp is this same number, use it — never say or invent any phone number yourself.
- DO NOT push the loan application form link immediately in the early turns! First listen to the caller's requirement and answer their questions.`,
    ].filter(Boolean).join("\n\n")
  }

  // -------------------------------------------------------------------------
  // LIVE IN-CALL CONVERSATION SCANNER (Enforce cross-turn memory & prevent contradiction)
  // -------------------------------------------------------------------------
  const customerMessages = [...history.filter((h) => h.role === "user").map((h) => h.content), speech].join(" ").toLowerCase()
  const customerExplicitlySaidFormFilled = /\b(already\s*(?:apply|applied|submitted|fill|filled|pampinch)|form\s*(?:fill\s*ches|submitt)|apply\s*ches[a-z]*)\b/i.test(customerMessages)
  const isSanctionedOnRecord = /LOAN APPLICATION STATUS — SANCTIONED/i.test(brief || "")
  const isFormSubmitted = /LOAN APPLICATION STATUS — SUBMITTED/i.test(brief || "") || customerExplicitlySaidFormFilled

  if (isNonLoanCall) {
    // Non-loan call: do not ground on loan applications or inquiry forms
  } else if (isSanctionedOnRecord) {
    merged = [
      merged,
      `=== LIVE STATE: LOAN IS OFFICIALLY SANCTIONED ===
- The customer's loan has been SANCTIONED by our team! Congratulate them warmly.
- State that our Loan Officer will coordinate directly regarding the sanction letter and disbursal process.
- NEVER ask for documents or application forms.`,
    ].filter(Boolean).join("\n\n")
  } else if (isFormSubmitted) {
    merged = [
      merged,
      `=== LIVE STATE: LOAN APPLICATION ALREADY FILLED & SUBMITTED ===
- The customer has ALREADY filled out and submitted their complete official application with all their details and documents.
- NEVER ask them to fill out any form or promise to send a new application link.
- NEVER ask them for documents (PAN, Aadhaar, salary slips, etc.) over the phone — all documents were already submitted inside their application!
- Inform them clearly: "Our Loan Officer is reviewing your complete application and will get in touch with you directly for the next steps."
- If the customer asks questions about office timings (9 AM - 6 PM), address, or general process, answer directly from Knowledge Base.`,
    ].filter(Boolean).join("\n\n")
  } else {
    merged = [
      merged,
      `=== CRITICAL GROUNDING: INQUIRY ONLY (NO LOAN APPLICATION SUBMITTED YET) ===
- This caller has NOT submitted any official loan application yet. They only inquired about a loan.
- STRICT BAN: NEVER say or claim "మీ application already మా దగ్గర ఉంది sir" (we already have your application) or "already in our system"!
- STRICT BAN: NEVER ask them to provide documents (PAN, Aadhaar) over the phone — all documents are submitted when they fill the official application!
- Acknowledge their loan requirement warmly. Ask if they would like the official application link sent to their WhatsApp, or if they would prefer to visit our Gandimaisamma office directly to complete the application in person.
- STRICT SCRIPT RULE: Only send or promise the application link if the customer explicitly agrees ("ఆ పంపించండి", "pampandi", "yes", "sure", "ok"). If the customer says no, vaddu, not now, or does not ask for it, DO NOT send or promise any loan application link — simply provide information and follow the standard post-call script!`,
    ].filter(Boolean).join("\n\n")
  }

  // Detect if customer explicitly stated their name in this call OR already known from lead identity/opener
  const spokenNameMatch = speech.match(/\b(?:naa|my)\s+(?:full\s+)?name\s+(?:is\s+)?([A-Za-z\s]+)/i)
  const leadNameMatch = (brief || "").match(/IDENTITY\s*—\s*name:\s*([A-Za-z0-9_-]+)/i) || (history[0]?.content || "").match(/(?:నమస్కారం|namaskaram|hello|hi)\s+([A-Za-z]+)\s+garu/i)
  const effectiveName = spokenNameMatch ? spokenNameMatch[1].trim().split(/\s+/).slice(0, 3).join(" ") : (leadNameMatch ? leadNameMatch[1].trim() : "")

  if (effectiveName && effectiveName.length > 1 && !/prabhutvam|government|unknown/i.test(effectiveName)) {
    merged = [
      merged,
      `=== CUSTOMER NAME IS ALREADY KNOWN ===
- Customer name is ALREADY KNOWN as "${effectiveName}". Address them respectfully as ${effectiveName} sir/garu.
- STRICT BAN: NEVER ask for their name, full name, or "మీ full name చెప్తారా". That step is DONE.
${isEmiCollection ? "- Move directly to demanding payment of their overdue loan EMI." : isNonLoanCall ? "- Move directly to conveying the operator's message." : "- Move directly to discussing their loan requirement (purpose, amount, loan type)."}`
    ].filter(Boolean).join("\n\n")
  }

  // Live-call conversation rules — listen first, never rush the goodbye.
  // REWRITE (2026-09-30): the previous version mandated "ALWAYS proactively
  // ask if they have any doubts" after EVERY reply — that single line made
  // Priya stack a second question on top of every answer, every turn, which
  // read as robotic and pushed real questions out of the 1-2 sentence budget.
  // Doubt-checking is asked AT MOST ONCE in the entire call, never repeated every turn.
  const alreadyAskedDoubts = history.some(
    (h) => h.role === "model" && /(?:doubts?|help కావాలా|ప్రశ్నలు|సందేహాలు|అడగాలా|వివరాలు కావాలా|queries|questions|anything else|ఇంకేమైనా)/i.test(h.content || "")
  )
  merged = [
    merged,
    `=== LIVE-CALL CONVERSATION RULES (LISTEN CLEARLY & STRICT SCRIPT/KB GROUNDING) ===
- CONVERSATIONAL PACING & NATURAL HUMAN DIALOGUE (THE YESTERDAY STANDARD):
  * Maximum 1 to 2 short sentences ONLY (under 25 words).
  * MANDATORY FAST ACKNOWLEDGMENT: ALWAYS open every turn with a warm conversational acknowledgment joined by a COMMA (e.g. "Sure sir,", "అవును sir,", "తప్పకుండా sir,", "నమస్కారం sir,", "Definitely sir,") — this flushes the opening audio to the caller within 200ms with zero awkward dead air.
  * Speak like a warm, courteous, knowledgeable loan advisor. Say ONE thing, ask ONE simple question, or answer their doubt directly, then stop and listen.
  * NEVER string 3 or 4 clauses together with commas into an 8-second monologue.
  * When the customer responds with "Hello" or "Hello andi":
    ${isEmiCollection
      ? `Acknowledge firmly and state: "నమస్కారం sir, మీ loan account లో overdue EMI payment గురించి మాట్లాడటానికి call చేశాను, ఈరోజు payment clear చేయాలి sir."`
      : isNonLoanCall
      ? `Acknowledge warmly and state your exact call purpose according to the operator instructions.`
      : instructions
      ? `Acknowledge warmly and state your exact call purpose according to the operator instructions.`
      : direction === "inbound"
      ? `Acknowledge warmly: "నమస్కారం sir, Right Agent Group కి call చేసినందుకు ధన్యవాదాలు, చెప్పండి sir మీకు ఎలా help చేయగలను?"`
      : `Acknowledge warmly and state your purpose naturally: "Hello sir, నమస్కారం! Right Agent Group నుంచి మాట్లాడుతున్నాను, మీకు ఏదైనా loan requirement ఉందా sir?"`
    }
  * When the customer responds with "time undi cheppandi", "aa time undi", "time undi", "cheppandi", "haa cheppandi", or "avunu cheppandi":
    They are saying: "Yes, I have time, go ahead and speak / tell me why you called."
    THEY ARE NOT ASKING FOR OFFICE TIMINGS, APPOINTMENT SLOTS, OR CLOCK TIME! NEVER reply with office hours.
    ${isEmiCollection
      ? `Instead, firmly state your call purpose in clean Telugu: "Sure sir, మీ loan account లో 5 నెలల EMI pending ఉంది. దాన్ని వెంటనే ఎప్పుడు clear చేస్తారు sir?"`
      : isNonLoanCall
      ? `Instead, state your exact call purpose according to the operator instructions.`
      : `Instead, warmly acknowledge and state your call purpose in clean Telugu: "Sure sir, మీ loan requirement గురించి మాట్లాడటానికి call చేశాను, మీకు ఎన్ని lakh loan కావాలి sir?"`
    }

- STRICT ANTI-REPETITION MANDATE (TODAY'S CRITICAL MANDATE):
  * Check the previous conversation turns carefully. NEVER repeat the same statement, loan approval pitch, appointment pitch, or question you already said!
  * If you already told the caller their loan is approved or asked them to send documents on WhatsApp, DO NOT repeat that pitch again! Move forward to their specific question or next single step.
  * If the caller says "Enti?" (What?) or expresses confusion, explain in ONE simple sentence in plain words (e.g. "Just మీ PAN మరియు Aadhaar card upload చేయాలి sir, మిగతా ప్రాసెస్ అంతా ready గా ఉంది").
  * When the customer responds with short acknowledgments like "Ok", "Sare", "Hmm", DO NOT restart your pitch and DO NOT ask if they have doubts! Acknowledge warmly (e.g. "Sure sir / అవును sir") and continue the next logical step or wait for them.

- AUDIO CLARITY COMPLAINT HANDLING (ONLY WHEN THE CUSTOMER COMPLAINS):
  * ONLY if the caller explicitly complains about audio ("Voice clear-ga ledu", "vinipiyatledu", "voice cut avtundi"):
  * STOP pitching immediately! Reply ONLY: "Sorry sir, ఇప్పుడు నా voice clear గా వినిపిస్తోందా?" and WAIT for their confirmation. Do NOT ask this unless the customer explicitly complained.

- STRICT SCRIPT & KNOWLEDGE BASE GROUNDING (ZERO INVENTIONS / NEVER HALLUCINATE):
  * Stick STRICTLY to the Company Script and the provided KNOWLEDGE BASE facts below.
  * Office Address: "Office: 4-143 Mallikarjuna Complex, 5th Floor, Gandimaisamma X Road, Medchal District (above Masters GYM), Hyderabad."
  * Office Timings: "Morning 9 AM to Evening 6 PM."
  * Interest Rates: Quote rates strictly based on the specific loan product requested by the caller (from Knowledge Base / Rate context). Never assume or force Home Loan if the caller hasn't requested it.
  * If the customer asks for any unverified detail or direction not in the Knowledge Base, honestly state: "పూర్తి details మరియు exact location link మా loan officer మీకు WhatsApp లో పంపిస్తారు sir."

${isEmiCollection ? `- STRICT RECOVERY FOCUS (ABSOLUTE MANDATE):
  * This is an OVERDUE EMI COLLECTION CALL.
  * NEVER pitch new loans, never discuss education loan documents, and never quote new interest rates!
  * Demand payment of the 5 months overdue EMI immediately.
  * State the formal escalation: account handover to legal recovery, severe CIBIL score damage, and legal recovery notice.` : `- STRICT PRODUCT LOCKING & ANTI-DEFLECTION (ABSOLUTE MANDATE):
  * When the customer asks for or discusses an EDUCATION LOAN, BUSINESS LOAN, PERSONAL LOAN, CAR/BIKE LOAN, or LAP:
    - NEVER pitch or mention Home Loans! NEVER say "actually we specialize in home loans" or "would you like to explore home loans instead"!
    - Stay 100% focused on their requested product.
    - For Education Loans: confirm starting rate from 7.15% p.a. with our partner banks for studies in India and abroad, with up to 15 years tenure and study-period moratorium.
    - Required documents for Education Loans:
      1. Student: KYC (PAN, Aadhaar), academic marksheets, college admission letter, fee structure.
      2. Parent/Co-applicant (Sponsor): KYC, latest 3 months salary slips + 6 months bank statement (if salaried) OR 2-3 years ITR + 6 months bank statement (if self-employed).
      DO NOT ask the student for 3 years ITR — financial documents come from the parent/co-applicant!`}

- NATURAL TURN TAKING & CONCLUSION:
  * When the customer asks a doubt or question, answer it clearly and briefly (1 to 2 short sentences), then STOP.
  * RESPECT CUSTOMER DEFERRAL (PARENTS DETAILS / DOCUMENTS):
    When the customer says they will provide parents details or documents later ("tarvata chepta", "maare cheptha", "ippudu cheppanu", "later", "not now"), RESPECT IT IMMEDIATELY! NEVER ask again, NEVER repeat "చెప్పండి వింటున్నాను" or pressure them. Acknowledge warmly: "సరే sir, no problem, ఆ details తర్వాత అయినా ఇవ్వొచ్చు. నేను మీ WhatsApp కి application link పంపిస్తాను." and proceed.
  * STRICT BAN ON TRAILING REPETITIVE QUESTIONS: NEVER append "ఇంకేమైనా doubts ఉన్నాయా sir?", "ఇంకేమైనా అడగాలా sir?", "ఇంకేమైనా వివరాలు కావాలా sir?", "do you have any other questions regarding the loan process?", or any closing question at the end of turns! Answer what was asked and STOP talking. Let the caller speak.
  * STRICT BAN ON PROACTIVE DOUBT QUESTIONS: Never proactively append doubt questions ("Do you have any doubts?", "దీని గురించి ఇంకా ఏమైనా doubts ఉన్నాయా sir?") at the end of answers. Answer what was asked and STOP talking. Let the caller ask if they have anything.
  * SINGLE CLEAN SIGN-OFF:
    When the customer indicates they are done or says goodbye ("catch you later", "talk to you later", "see you later", "bye", "chalu"):
    - Respond with ONE warm, concise closing (e.g. "Sure sir, thank you for your time! Have a great day, goodbye!") and conclude.
    - NEVER repeat closing phrases or contradict time of day (e.g. never say "have a good evening" then "have a great day").
  * NO UNILATERAL HANGUPS: NEVER say goodbye ("Thank you sir, have a great day, bye" or "bye") while the customer is still speaking, asking questions, or discussing banks/loans. ONLY say goodbye when the customer EXPLICITLY indicates they are done (e.g. "chalu andi", "em ledu", "thank you bye", "untanu", "catch you later"). Conclude politely ONLY when the customer has finished.`,
  ].filter(Boolean).join("\n\n")

  // KNOWLEDGE BASE: unlike the Lead Brain brief above, this runs on EVERY
  // turn — a question about documents/eligibility/rates can land at any
  // point in the call, not just the opening. One cheap indexed query.
  if (kbContext) merged = [merged, kbContext].filter(Boolean).join("\n\n")

  // REAL MATH: an LLM asked "what's my EMI" will confidently invent a
  // plausible-sounding but WRONG number. lib/finance.ts does the actual
  // arithmetic here and hands Priya an exact figure to state — she never
  // computes EMI/eligibility herself.
  if (!isEmiCollection && !isNonLoanCall && leadId && financeRows) {
    const [leadRow, memoryRow] = financeRows
    const knownIncome = memoryRow.data?.facts?.monthly_income ? Number(memoryRow.data.facts.monthly_income) : null

    // Only scan CUSTOMER utterances for loan interest (never Priya's own list of loans!)
    const customerSpeechSoFar = [...history.filter((h) => h.role === "user").map((h) => h.content), speech].join(" ")
    const detectedType = detectLoanType(customerSpeechSoFar) || leadRow.data?.product_interest || null
    if (detectedType && detectedType !== leadRow.data?.product_interest) {
      db.from("leads").update({ product_interest: detectedType }).eq("id", leadId).catch(() => {})
      invalidateFinanceRowsCache(leadId)
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

    // PREPAYMENT / FORECLOSURE (2026-09-29): "if I close early / prepay 5
    // lakh after 2 years, how much do I save?" used to fall through with no
    // grounding — the model guessed a savings figure. Now the real schedule
    // simulation answers it, same contract as the EMI/eligibility hooks.
    const prepay = buildPrepaymentInstruction(speech, {
      loanAmount: leadRow.data?.loan_amount ? Number(leadRow.data.loan_amount) : null,
      loanType: detectedType,
    })
    if (prepay) merged = [merged, prepay.instruction].filter(Boolean).join("\n\n")
  }

  // OPERATOR / HUMAN HANDOFF (2026-09-26, "train the agent + call operators"):
  // the keyword flag in handleTurn/handleTurnStream alerts the team
  // fire-and-forget — this instruction is what trains the SPOKEN reply
  // itself, on the exact turn it matters, with the script's callback
  // contract (acknowledge → promise the officer callback → stop; never
  // pitch, never ask). Lives in buildTurnInstructions so BOTH turn paths
  // (blocking + streaming, phone + WhatsApp calls) get identical training.
  if (detectHumanRequest(speech)) {
    merged = [merged, OPERATOR_REPLY_INSTRUCTION].filter(Boolean).join("\n\n")
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
  /** True when the callSid is a wacall-* — the call itself runs on the customer's WhatsApp. */
  isWhatsAppCall?: boolean
  messages: { role: "user" | "model"; content: string }[]
  reply: string
  branchId?: string | null
}): Promise<boolean> {
  const { leadId, callSid, callerPhone, isWhatsAppCall, messages, reply, branchId } = opts
  if (!leadId) return false

  // FAST PATH: If the lead was already completed (status is no longer 'new') before this call,
  // do not trigger the auto-onboarding completion hangup, and skip the expensive extraction LLM call.
  const existing = await db.from("leads").select("name, address, whatsapp_number, status").eq("id", leadId).single()
  const aiPromisedLink = /(?:link|లింక్).*(?:పంపిస్త|పంపించ|send|shared|share)/i.test(reply)
  if (existing.data?.status && existing.data?.status !== "new" && !aiPromisedLink) return false

  // FIX (2026-09-20): extraction used to receive the ENTIRE transcript (the
  // main reply is capped at 12 messages, but this LLM call fired on any
  // potentially-complete turn with everything ever said) — growing token
  // cost + per-turn CPU on the hot path. Name/number surface late in calls
  // anyway; the last 12 turns are what matters.
  const allTurns = [...messages.slice(-12), { role: "model" as const, content: reply }]
  // FIX (2026-09-26): on a WHATSAPP call the calling number IS the customer's
  // WhatsApp — extraction no longer demands the customer "explicitly say so"
  // (there is no other possibility to confirm against). Phone calls keep the
  // strict explicit-confirmation rule.
  const phonePreamble = callerPhone
    ? isWhatsAppCall
      ? `(This call is happening ON the customer's WhatsApp: the customer is calling from ${callerPhone}, and that number IS their WhatsApp number. Use it as their whatsapp_number.)\n`
      : `(The customer is calling from: ${callerPhone}. Use this as their whatsapp_number ONLY if they EXPLICITLY said WhatsApp is on this same number — if they never mentioned their WhatsApp number, leave whatsapp_number null.)\n`
    : ""
  const transcriptText =
    phonePreamble +
    allTurns.map((m) => `${m.role === "model" ? "Priya" : "Customer"}: ${m.content}`).join("\n")

  if (!mightBeComplete(transcriptText)) return false
  const extracted = await extractLeadInfo(transcriptText)

  const knownName = existing.data?.name && !PLACEHOLDER_NAME_RE.test(existing.data.name) ? existing.data.name : null
  const effectiveName = extracted.name || knownName
  const effectiveAddress = extracted.address || existing.data?.address || null
  const effectiveWhatsapp = extracted.whatsapp_number || existing.data?.whatsapp_number || callerPhone || null

  // Address is filled on the online form — do not block link delivery on missing address.
  if ((!effectiveName && !callerPhone) || !effectiveWhatsapp) return false

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
    const claimQuery = aiPromisedLink
      ? db.from("leads").update(updates).eq("id", leadId)
      : db.from("leads").update(updates).eq("id", leadId).eq("status", "new")
    await claimQuery
  } catch (e) {
    console.error("lead update error:", e)
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
  history?: { role: "user" | "model"; content: string }[]
}): Promise<{ text: string; hangup: boolean }> {
  const { leadId, callSid, speech, language, callerPhone, instructions, direction, branchId } = opts
  // Channel fact: WhatsApp voice calls carry wacall-* sids (Meta's call id).
  // Everything downstream (grounding, extraction, form send) keys off this.
  const isWhatsAppCall = !!callSid?.startsWith("wacall-")

  // Fire the history-independent reads NOW, so they overlap the transcript
  // read instead of queueing behind it (see startTurnContext).
  const contextPromise = startTurnContext(leadId, speech)
  const history = opts.history || (callSid ? await getHistory(callSid) : [])

  // VOICEMAIL: only ever checked on the first thing heard after our own
  // OUTBOUND greeting (history empty) — a mid-call false match would risk
  // cutting off a real, ongoing conversation.
  if (history.length === 0 && direction === "outbound" && VOICEMAIL_RE.test(speech)) {
    await markVoicemail(callSid, speech)
    return { text: "", hangup: true }
  }

  const messages = [...history, { role: "user" as const, content: speech }]

  // 1. DND (DO NOT CALL) — HIGHEST PREEMPTIVE PRIORITY (Absolute Override)
  if (detectDndIntent(speech)) {
    const dndReply = await handleDndOptOut(leadId, callSid, callerPhone, language)
    updateTranscriptAsync(callSid, speech, dndReply)
    if (callSid) {
      await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
      runPostCallAnalysis(callSid)
    }
    return { text: dndReply, hangup: true }
  }

  // 2. EXPLICIT CONTINUATION / QUESTION CHECK
  // If the caller is asking a doubt, clarifying, or continuing (e.g., "Chalu, oka doubt undi",
  // "Okay sir, bye... actually one small doubt", "Repu call chesta, meeru ippudu cheppandi"),
  // this MUST BEAT any ending, callback, or goodbye detection and proceed straight to the AI conversation!
  const hasContinuation = CONTINUATION_INTENT_RE.test(speech)

  if (!hasContinuation) {
    // 3. SMART RESCHEDULE: Caller explicitly requests the company/agent to call back
    if (leadId && history.length > 0) {
      const reschedule = buildReschedule(speech, language)
      if (reschedule) {
        const persisted = await scheduleSpeechCallback(leadId, callSid, reschedule)
        const confirmMsg = persisted
          ? reschedule.confirm
          : (language === "telugu"
              ? `నేను ${reschedule.desc.telugu} కోసం మీ సమయాన్ని నోట్ చేసుకున్నాను. మా టీమ్ మిమ్మల్ని సంప్రదిస్తుంది. ధన్యవాదాలు!`
              : language === "hindi"
              ? `मैंने ${reschedule.desc.hindi} के लिए आपका समय नोट कर लिया है। हमारी टीम आपसे संपर्क करेगी। धन्यवाद!`
              : `I have noted your preferred callback time for ${reschedule.desc.english}. Our team will reach out accordingly. Thank you!`)
        updateTranscriptAsync(callSid, speech, confirmMsg)
        return { text: confirmMsg, hangup: true }
      }
    }

    // 4. CALLER WILL CALL LATER: Caller says THEY will call back (do NOT book calendar callback)
    if (history.length > 0 && detectCallerWillCall(speech)) {
      const callerCallReplies: Record<Language, string> = {
        telugu: "Sure sir, మీకు వీలైనప్పుడు తప్పకుండా call చేయండి. Have a great day, bye!",
        english: "Sure sir, feel free to call us whenever you're free. Have a great day, goodbye!",
        hindi: "Sure sir, जब भी आप free हों call कर लीजिएगा। Have a great day, bye!",
      }
      const reply = callerCallReplies[language] || callerCallReplies.telugu
      updateTranscriptAsync(callSid, speech, reply)
      if (callSid) {
        await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
        runPostCallAnalysis(callSid)
      }
      return { text: reply, hangup: true }
    }

    // 5. UNAMBIGUOUS GOODBYE OR DISCONNECT COMMAND: Clear sign-off without contrast/continuation
    if (history.length > 0 && (UNAMBIGUOUS_GOODBYE_RE.test(speech) || isCallDisconnectIntent(speech))) {
      const reply = getVoiceClosingsSnapshot().goodbye[language]
      updateTranscriptAsync(callSid, speech, reply)
      if (callSid) {
        await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
      }
      return { text: reply, hangup: true }
    }

    // 6. AMBIGUOUS SHORT WORD WITH CONTEXT CONFIRMATION:
    // e.g. caller said "chalu", "anthe", "untanu", "saripothundi", "ok andi", "okay"
    if (history.length > 0 && AMBIGUOUS_CLOSING_RE.test((speech || "").trim())) {
      if (isAfterDoubtInquiry(history)) {
        // Caller confirms they have no more doubts -> conclude cleanly
        const reply = getVoiceClosingsSnapshot().goodbye[language]
        updateTranscriptAsync(callSid, speech, reply)
        if (callSid) {
          await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
        }
        return { text: reply, hangup: true }
      } else {
        // Caller said ambiguous word mid-conversation -> CONFIRM before hanging up!
        const confirmInquiries: Record<Language, string> = {
          telugu: "Sure sir, మీకు లోన్ ప్రాసెస్ గురించి ఇంకేమైనా doubts ఉన్నాయా?",
          english: "Sure sir, do you have any other questions regarding the loan process?",
          hindi: "Sure sir, क्या आपको लोन के बारे में कोई और सवाल पूछना है?",
        }
        const reply = confirmInquiries[language] || confirmInquiries.telugu
        updateTranscriptAsync(callSid, speech, reply)
        return { text: reply, hangup: false }
      }
    }
  }

  // FRUSTRATION RADAR: zero-latency keyword pass; flagging is fire-and-forget.
  if (detectFrustration(speech, history.map((h) => ({ role: h.role === "model" ? "model" : "user", content: h.content })))) {
    flagFrustratedCall(callSid, leadId || null, speech)
  }
  // Calm request for a human — separate from frustration (see frustration.ts).
  if (detectHumanRequest(speech)) {
    flagHumanRequested(callSid, leadId || null, speech)
  }

  const mergedInstructions = await buildTurnInstructions(leadId, history, instructions, speech, callerPhone, contextPromise, isWhatsAppCall ? "whatsapp" : "phone", direction)

  let reply = ""
  let rateLimited = false
  try {
    reply = (await chatWithLLM(messages, language, mergedInstructions || undefined, { channel: "call", branchId })).trim()
    if (!reply) reply = getVoiceOpenersSnapshot().cold[language]
    // NO toTanglish here: on a telugu/hindi call the reply is SPOKEN by the
    // native Indic TTS voice, which needs the native script to sound native
    // (the old flattening pass was the root cause of the foreign accent).
  } catch (e) {
    console.error("LLM error:", e)
    const closings = getVoiceClosingsSnapshot()
    if (isRateLimitError(e)) {
      rateLimited = true
      reply = closings.rateLimit[language]
    } else {
      reply = closings.retry[language]
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

  await completeLeadIfReady({ leadId, callSid, callerPhone, isWhatsAppCall, messages, reply, branchId })

  // Same guard as the early bye-check above: without history.length > 0 a
  // pickup utterance like "sare andi" / "ok andi" matched here AFTER Priya's
  // first reply and hung the call up immediately.
  const isCustomerDisconnect = isCallDisconnectIntent(speech)
  const isCustomerEnding = isCustomerDisconnect || (history.length > 0 && !hasContinuation && (UNAMBIGUOUS_GOODBYE_RE.test(speech) || (AMBIGUOUS_CLOSING_RE.test((speech || "").trim()) && isAfterDoubtInquiry(history))))
  const isCustomerActive = /\b(bank|loan|rate|interest|emi|lakh|address|office|document|sbi|hdfc|icici|kavali|cheppandi|enduku|ela|details|doubt|process)\b/i.test(speech)
  const isPriyaEnding = !hasContinuation && !isCustomerActive && GOODBYE_RE.test(reply) && (history.length >= 2 || isCustomerDisconnect)
  const hangup = isCustomerEnding || isPriyaEnding
  if (hangup && callSid) {
    db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
  }
  return { text: reply, hangup }
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
    history?: { role: "user" | "model"; content: string }[]
  },
  onSentence: (sentence: string) => void
): Promise<{ hangup: boolean }> {
  const { leadId, callSid, speech, language, callerPhone, instructions, direction, branchId } = opts
  // Channel fact: see handleTurn. Same wacall-* derivation, streaming twin.
  const isWhatsAppCall = !!callSid?.startsWith("wacall-")

  // Fire the history-independent reads NOW, so they overlap the transcript
  // read instead of queueing behind it (see startTurnContext). This is the
  // live-call path — every millisecond here is silence on the caller's ear.
  const contextPromise = startTurnContext(leadId, speech)
  const history = opts.history || (callSid ? await getHistory(callSid) : [])

  // VOICEMAIL: see handleTurn's identical check for why this is restricted
  // to the first turn of an outbound call only.
  if (history.length === 0 && direction === "outbound" && VOICEMAIL_RE.test(speech)) {
    await markVoicemail(callSid, speech)
    return { hangup: true }
  }

  // 1. DND (DO NOT CALL) — HIGHEST PREEMPTIVE PRIORITY (Absolute Override)
  if (detectDndIntent(speech)) {
    const dndReply = await handleDndOptOut(leadId, callSid, callerPhone, language)
    updateTranscriptAsync(callSid, speech, dndReply)
    onSentence(dndReply)
    if (callSid) {
      await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
      runPostCallAnalysis(callSid)
    }
    return { hangup: true }
  }

  // 2. EXPLICIT CONTINUATION / QUESTION CHECK
  const hasContinuation = CONTINUATION_INTENT_RE.test(speech)

  if (!hasContinuation) {
    // 3. SMART RESCHEDULE: Caller requests company to call back
    if (leadId && history.length > 0) {
      const reschedule = buildReschedule(speech, language)
      if (reschedule) {
        const persisted = await scheduleSpeechCallback(leadId, callSid, reschedule)
        const confirmMsg = persisted
          ? reschedule.confirm
          : (language === "telugu"
              ? `నేను ${reschedule.desc.telugu} కోసం మీ సమయాన్ని నోట్ చేసుకున్నాను. మా టీమ్ మిమ్మల్ని సంప్రదిస్తుంది. ధన్యవాదాలు!`
              : language === "hindi"
              ? `मैंने ${reschedule.desc.hindi} के लिए आपका समय नोट कर लिया है। हमारी टीम आपसे संपर्क करेगी। धन्यवाद!`
              : `I have noted your preferred callback time for ${reschedule.desc.english}. Our team will reach out accordingly. Thank you!`)
        updateTranscriptAsync(callSid, speech, confirmMsg)
        onSentence(confirmMsg)
        return { hangup: true }
      }
    }

    // 4. CALLER WILL CALL LATER: Caller says THEY will call back (no calendar booking)
    if (history.length > 0 && detectCallerWillCall(speech)) {
      const callerCallReplies: Record<Language, string> = {
        telugu: "Sure sir, మీకు వీలైనప్పుడు తప్పకుండా call చేయండి. Have a great day, bye!",
        english: "Sure sir, feel free to call us whenever you're free. Have a great day, goodbye!",
        hindi: "Sure sir, जब भी आप free हों call कर लीजिएगा। Have a great day, bye!",
      }
      const reply = callerCallReplies[language] || callerCallReplies.telugu
      updateTranscriptAsync(callSid, speech, reply)
      onSentence(reply)
      if (callSid) {
        await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
        runPostCallAnalysis(callSid)
      }
      return { hangup: true }
    }

    // 5. UNAMBIGUOUS GOODBYE OR DISCONNECT COMMAND
    if (history.length > 0 && (UNAMBIGUOUS_GOODBYE_RE.test(speech) || isCallDisconnectIntent(speech))) {
      const reply = getVoiceClosingsSnapshot().goodbye[language]
      updateTranscriptAsync(callSid, speech, reply)
      onSentence(reply)
      if (callSid) {
        await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
      }
      return { hangup: true }
    }

    // 6. AMBIGUOUS SHORT WORD WITH CONTEXT CONFIRMATION
    if (history.length > 0 && AMBIGUOUS_CLOSING_RE.test((speech || "").trim())) {
      if (isAfterDoubtInquiry(history)) {
        const reply = getVoiceClosingsSnapshot().goodbye[language]
        updateTranscriptAsync(callSid, speech, reply)
        onSentence(reply)
        if (callSid) {
          await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
        }
        return { hangup: true }
      } else {
        const confirmInquiries: Record<Language, string> = {
          telugu: "Sure sir, మీకు లోన్ ప్రాసెస్ గురించి ఇంకేమైనా doubts ఉన్నాయా?",
          english: "Sure sir, do you have any other questions regarding the loan process?",
          hindi: "Sure sir, क्या आपको लोन के बारे में कोई और सवाल पूछना है?",
        }
        const reply = confirmInquiries[language] || confirmInquiries.telugu
        updateTranscriptAsync(callSid, speech, reply)
        onSentence(reply)
        return { hangup: false }
      }
    }
  }

  const messages = [...history, { role: "user" as const, content: speech }]

  if (detectFrustration(speech, history.map((h) => ({ role: h.role === "model" ? "model" : "user", content: h.content })))) {
    flagFrustratedCall(callSid, leadId || null, speech)
  }
  if (detectHumanRequest(speech)) {
    flagHumanRequested(callSid, leadId || null, speech)
  }

  const mergedInstructions = await buildTurnInstructions(leadId, history, instructions, speech, callerPhone, contextPromise, isWhatsAppCall ? "whatsapp" : "phone", direction)

  let reply = ""
  let pending = ""
  // Outpero-grade first-audio latency: the FIRST clause ("నమస్కారం sir,")
  // is flushed to TTS at the first comma while the model is still writing
  // the main clause. Comma flushes only apply to the very first emission —
  // flushedSentences tracks that (splitSentences itself stays pure).
  let flushedSentences = 0
  try {
    reply = (
      await chatWithLLMStream(messages, language, mergedInstructions || undefined, (delta) => {
        pending += delta
        const { complete, rest } = splitSentences(pending, { allowFirstCommaFlush: flushedSentences === 0 })
        for (const s of complete) onSentence(s)
        flushedSentences += complete.length
        pending = rest
      }, "call", { branchId })
    ).trim()
    const tail = pending.trim()
    if (tail) onSentence(tail)
    if (!reply) {
      reply = getVoiceOpenersSnapshot().cold[language]
      onSentence(reply)
    }
  } catch (e) {
    console.error("LLM error:", e)
    const closings = getVoiceClosingsSnapshot()
    if (isRateLimitError(e)) {
      const msg = closings.rateLimit[language]
      await updateTranscriptAsync(callSid, speech, msg)
      onSentence(msg)
      if (callSid) {
        await db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
        runPostCallAnalysis(callSid)
      }
      return { hangup: true }
    }
    const msg = closings.retry[language]
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

  await completeLeadIfReady({ leadId, callSid, callerPhone, isWhatsAppCall, messages, reply, branchId })

  // Same guard as the early bye-check: no history → never hang up on the
  // strength of a single pickup utterance ("sare andi" right after pickup).
  const isCustomerDisconnect = CALL_DISCONNECT_RE.test(speech)
  const isCustomerEnding = isCustomerDisconnect || (history.length > 0 && !hasContinuation && (UNAMBIGUOUS_GOODBYE_RE.test(speech) || (AMBIGUOUS_CLOSING_RE.test((speech || "").trim()) && isAfterDoubtInquiry(history))))
  const isCustomerActive = /\b(bank|loan|rate|interest|emi|lakh|address|office|document|sbi|hdfc|icici|kavali|cheppandi|enduku|ela|details|doubt|process)\b/i.test(speech)
  const isPriyaEnding = !hasContinuation && !isCustomerActive && GOODBYE_RE.test(reply) && (history.length >= 2 || isCustomerDisconnect)
  const hangup = isCustomerEnding || isPriyaEnding
  if (hangup && callSid) {
    db.from("voice_calls").update({ status: "completed" }).eq("twilio_call_sid", callSid).catch(() => {})
  }
  return { hangup }
}
