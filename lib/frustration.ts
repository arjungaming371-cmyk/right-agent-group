// Frustration detection — the cheap, reliable version.
//
// Strategy: a fast multilingual keyword pass runs on EVERY customer turn
// (zero latency added to the call). When it trips, the call is flagged
// asynchronously: voice_calls.sentiment → "Frustrated" and a comm_log entry
// appears so a human can jump in from the dashboard. The call itself is
// never slowed down — flagging happens fire-and-forget after the reply.

import { db, query } from "./db"
import { sendMail, isMailConfigured } from "./mail"
import { createNotification } from "./notifications"
import { escapeHtml } from "./utils"

// English / Hindi / Telugu frustration & escalation markers.
// Deliberately conservative — false positives annoy operators.
const FRUSTRATION_RE = new RegExp(
  [
    // English
    "stop calling", "don'?t call", "how many times", "again and again", "fed up",
    "wasting my time", "waste of time", "not interested at all", "leave me alone",
    "irritating", "annoy", "scam", "fraud", "fake call", "harass", "complain",
    "report you", "shut up", "listen to me",
    // Hindi
    "परेशान", "बार बार", "कितनी बार", "तंग", "बकवास", "फ्रॉड", "धोखा",
    "समय बर्बाद", "फोन मत", "कॉल मत", "शिकायत",
    // Telugu
    "విసిగి", "ఎన్నిసార్లు", "మళ్ళీ మళ్ళీ", "ఫోన్ చేయవద్దు", "కాల్ చేయవద్దు",
    "మోసం", "ఫ్రాడ్", "టైమ్ వేస్ట్", "కంప్లైంట్",
  ].join("|"),
  "i"
)

// Repeated short negative replies also signal trouble ("no." "no!" "NO")
const HARD_NO_RE = /^(no+|nahi+|nahin|వద్దు|లేదు|नहीं)[.!\s]*$/i

export function detectFrustration(speech: string, history: { role: string; content: string }[]): boolean {
  if (FRUSTRATION_RE.test(speech)) return true
  // Three hard "no"s in the recent customer turns = flag it
  const recentUser = history.filter((m) => m.role === "user").slice(-3)
  const hardNos = [...recentUser.map((m) => m.content), speech].filter((t) => HARD_NO_RE.test(t.trim()))
  return hardNos.length >= 3
}

// A CALM request for a human — "can I talk to a person instead" — is not
// frustration and shouldn't be lumped into FRUSTRATION_RE (that regex feeds
// flagFrustratedCall, which marks sentiment "Frustrated"; mislabeling a
// polite request as an angry customer would mislead whoever checks the
// dashboard). RBI's Fair Practices Code expects a way for the customer to
// reach a human — this call has no live transfer capability, so the
// script's job is to acknowledge it and promise a real callback (see
// lib/default-scripts.ts's "SPEAK TO A HUMAN" rule), and this flag is what
// makes that callback actually happen.
//
// SCRIPT FIX (2026-09-26, "train the agent + call operators"): STT runs
// Sarvam Saaras with mode=translit — EVERY caller sentence arrives as
// ROMANIZED text ("manager tho matladali", "insaan se baat karao"), never
// native script. The old pattern list covered English + native-script
// Telugu/Hindi, so a Telugu or Hindi caller asking for an operator was
// silently never detected and never got the callback the script promised.
// The romanized patterns below close that gap; native-script forms stay
// for WhatsApp messages typed in Indic keyboards (mode=codemix STT too).
const HUMAN_REQUEST_RE = new RegExp(
  [
    // English (extended: agent / supervisor / operator / human being)
    // NOTE: "customer care" is deliberately phrase-level ("talk to customer
    // care", "customer care number") — a bare mention also matches praise
    // like "your customer care service is good".
    "speak to a human", "talk to a human", "talk to a person", "speak to a person",
    "real person", "human agent", "human being", "want a human", "need a human",
    "is there a person", "live agent", "talk to customer care", "customer care number",
    "reach customer care", "speak to someone", "talk to someone",
    "talk to someone else", "speak to someone else", "connect me to", "transfer me", "escalate",
    "speak to (your |the |a |an )?(manager|supervisor|officer|agent|operator)",
    "talk to (your |the |a |an )?(manager|supervisor|officer|agent|operator)",
    // Hindi romanized (what mode=translit STT actually produces)
    "manager se baat", "manager se milo", "manager bula", "manager ko bol",
    "officer se baat", "insaan se baat", "insan se baat", "aadmi se baat",
    "kisi se baat kara", "baat kara do", "baat karwao", "human se baat",
    "agent se baat", "supervisor se\\b", "customer care se\\b", "real person",
    // Hindi native script (typed WhatsApp messages)
    "इंसान से बात", "किसी आदमी से", "मैनेजर से बात", "असली आदमी", "ऑफिसर से बात",
    // Telugu romanized — phrase-level postposition forms, not bare words,
    // so ordinary speech never false-positives ("manager" inside a story
    // about their own office manager doesn't match; "manager tho" does).
    // Short postposition endings carry a trailing \b so they can't bleed
    // into English words ("manager nicely", "customer care service").
    "manager tho\\b", "manager ni\\b", "manager ki\\b", "manager unte\\b", "naaku manager", "naku manager",
    "officer tho\\b", "manishi tho\\b", "manishini", "human tho\\b", "agent tho\\b",
    "supervisor tho\\b", "customer care ki\\b", "customer care tho\\b", "connect cheyandi", "connect chey\\b",
    "real person ki\\b",
    // Telugu native script (typed WhatsApp messages)
    "మనిషితో మాట్లాడ", "నిజమైన వ్యక్తి", "మేనేజర్ తో మాట్లాడ", "ఆఫీసర్ తో మాట్లాడ",
  ].join("|"),
  "i"
)

export function detectHumanRequest(speech: string): boolean {
  return HUMAN_REQUEST_RE.test(speech)
}

// The exact reply contract the agent must follow on the turn an operator
// request is detected. Exported so the call path (lib/voice-conversation.ts)
// and the WhatsApp chat path (app/api/whatsapp/route.ts) inject the SAME
// training, and the regression tests can lock the wording. Language-neutral
// on purpose: WHAT language Priya replies in is decided by the REPLY LANGUAGE
// rule — this only fixes WHAT she says (never pitch, never ask, promise the
// callback once, stop).
export const OPERATOR_REPLY_INSTRUCTION =
  "OPERATOR REQUEST — THIS TURN: the customer just asked to speak with a human being (a manager, officer, agent or operator). Follow the script's SPEAK TO A HUMAN rule exactly: acknowledge warmly, say clearly that one of our loan officers will call them back personally very soon, then STOP. Do NOT keep pitching, do NOT ask any new question, do NOT promise an instant live transfer, do NOT give any phone number, and do NOT repeat details already known. One short reply is enough."

// Same contract for the WhatsApp TEXT channel, where "call them back" alone
// would sound odd — the human follows up on the same chat.
export const OPERATOR_CHAT_INSTRUCTION =
  "OPERATOR REQUEST: the customer just asked to speak with a human being (a manager, officer, agent or operator). Acknowledge warmly and tell them a real person from the team will reply to them right here on this same WhatsApp chat very soon — our loan officer may also call them directly. Do NOT keep pitching and do NOT ask any new question in this reply."

/** Emails ADMIN_EMAIL the moment a caller/chatter is flagged. No-op if SMTP isn't configured. */
async function sendEscalationEmail(channel: "Phone call" | "WhatsApp" | "Instagram", leadId: string | null, snippet: string): Promise<void> {
  const to = process.env.ADMIN_EMAIL || ""
  if (!to || !isMailConfigured()) return
  let leadName = "Unknown lead"
  let leadPhone = ""
  if (leadId) {
    const { data: lead } = await db.from("leads").select("name, phone").eq("id", leadId).single()
    if (lead) { leadName = lead.name || leadName; leadPhone = lead.phone || "" }
  }
  await sendMail({
    to,
    subject: `⚠️ Needs human — ${leadName}${leadPhone ? " (" + leadPhone + ")" : ""}`,
    html: `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
  <div style="background:#fb5670;border-radius:12px 12px 0 0;padding:20px 24px">
    <div style="font-size:16px;font-weight:700;color:#fff">A caller needs a human, now</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
    <p style="font-size:14px;margin:0 0 10px"><strong>${channel}</strong> with <strong>${escapeHtml(leadName)}</strong>${leadPhone ? ` (${escapeHtml(leadPhone)})` : ""}</p>
    <div style="background:#f9fafb;border-left:3px solid #fb5670;border-radius:6px;padding:12px 14px;font-size:13px;color:#374151;margin:0 0 14px">
      "${escapeHtml(snippet.slice(0, 200))}"
    </div>
    <p style="font-size:13px;color:#6b7280;margin:0">Open the dashboard's Communication Log to see the full thread and step in.</p>
  </div>
</div>`,
  }).catch((e) => console.error("escalation email error:", e))
}

async function leadDisplayName(leadId: string | null): Promise<string> {
  if (!leadId) return "Unknown lead"
  const { data } = await db.from("leads").select("name, phone").eq("id", leadId).single()
  return data?.name || data?.phone || "Unknown lead"
}

/** Fire-and-forget: mark the call + surface it on the dashboard + email the admin. Never blocks the call. */
export function flagFrustratedCall(callSid: string | null, leadId: string | null, speech: string): void {
  ;(async () => {
    try {
      if (callSid) {
        await db.from("voice_calls").update({ sentiment: "Frustrated", outcome: "needs_human" }).eq("twilio_call_sid", callSid)
      }
      await query(
        `INSERT INTO comm_logs (lead_id, type, summary, outcome)
         VALUES ($1, 'alert', $2, 'needs_human')`,
        [leadId, `⚠️ FRUSTRATED CALLER — said: "${speech.slice(0, 120)}" — consider a human callback`]
      )
      await sendEscalationEmail("Phone call", leadId, speech)
      createNotification({
        type: "escalation",
        title: `${await leadDisplayName(leadId)} needs a human`,
        body: `Phone call — "${speech.slice(0, 120)}"`,
        linkView: "voice",
      })
    } catch (e: any) {
      console.error("flagFrustratedCall error:", e.message)
    }
  })()
}

/** Fire-and-forget: same alert channel as flagFrustratedCall, but for a calm
 * request to speak with a human — distinct sentiment/summary so the
 * dashboard doesn't conflate "asked for a human" with "angry customer". */
export function flagHumanRequested(callSid: string | null, leadId: string | null, speech: string): void {
  ;(async () => {
    try {
      if (callSid) {
        await db.from("voice_calls").update({ sentiment: "Requested Human", outcome: "needs_human" }).eq("twilio_call_sid", callSid)
      }
      await query(
        `INSERT INTO comm_logs (lead_id, type, summary, outcome)
         VALUES ($1, 'alert', $2, 'needs_human')`,
        [leadId, `📞 ASKED FOR A HUMAN — said: "${speech.slice(0, 120)}" — call them back directly`]
      )
      await sendEscalationEmail("Phone call", leadId, speech)
      createNotification({
        type: "escalation",
        title: `${await leadDisplayName(leadId)} asked to speak with a human`,
        body: `Phone call — "${speech.slice(0, 120)}"`,
        linkView: "voice",
      })
    } catch (e: any) {
      console.error("flagHumanRequested error:", e.message)
    }
  })()
}

/** Calm "let me talk to a human" on the WhatsApp TEXT channel — same alert
 * channel as flagFrustratedWhatsApp, but distinct wording/sentiment so the
 * ops queue doesn't conflate "asked for a human" with "angry customer".
 * (2026-09-26: WhatsApp chat never ran detectHumanRequest at all — a customer
 * typing "I want to talk to a real person" never surfaced anywhere.) */
export function flagHumanRequestedWhatsApp(leadId: string | null, message: string): void {
  ;(async () => {
    try {
      await query(
        `INSERT INTO comm_logs (lead_id, type, summary, outcome)
         VALUES ($1, 'alert', $2, 'needs_human')`,
        [leadId, `📞 ASKED FOR A HUMAN — said: "${message.slice(0, 120)}" — reply to them directly on this chat`]
      )
      await sendEscalationEmail("WhatsApp", leadId, message)
      createNotification({
        type: "escalation",
        title: `${await leadDisplayName(leadId)} asked to speak with a human`,
        body: `WhatsApp — "${message.slice(0, 120)}"`,
        linkView: "whatsapp",
      })
    } catch (e: any) {
      console.error("flagHumanRequestedWhatsApp error:", e.message)
    }
  })()
}

/** Same idea for WhatsApp — no callSid/voice_calls row to update, just the alert + email. */
export function flagFrustratedWhatsApp(leadId: string | null, message: string): void {
  ;(async () => {
    try {
      await query(
        `INSERT INTO comm_logs (lead_id, type, summary, outcome)
         VALUES ($1, 'alert', $2, 'needs_human')`,
        [leadId, `⚠️ FRUSTRATED WHATSAPP CHAT — said: "${message.slice(0, 120)}" — consider a human reply`]
      )
      await sendEscalationEmail("WhatsApp", leadId, message)
      createNotification({
        type: "escalation",
        title: `${await leadDisplayName(leadId)} needs a human`,
        body: `WhatsApp — "${message.slice(0, 120)}"`,
        linkView: "whatsapp",
      })
    } catch (e: any) {
      console.error("flagFrustratedWhatsApp error:", e.message)
    }
  })()
}

/** Same idea for Instagram DMs — an angry DM flags the lead exactly like the
 * call and WhatsApp paths do, so the dashboard shows one consistent
 * "needs a human" queue across every channel. (2026-09-22: the IG webhook
 * previously ran NO frustration pass at all — a customer shouting "stop
 * messaging me, scam!" on Instagram never surfaced anywhere.) */
export function flagFrustratedInstagram(leadId: string | null, message: string): void {
  ;(async () => {
    try {
      await query(
        `INSERT INTO comm_logs (lead_id, type, summary, outcome)
         VALUES ($1, 'alert', $2, 'needs_human')`,
        [leadId, `⚠️ FRUSTRATED INSTAGRAM DM — said: "${message.slice(0, 120)}" — consider a human reply`]
      )
      await sendEscalationEmail("Instagram", leadId, message)
      createNotification({
        type: "escalation",
        title: `${await leadDisplayName(leadId)} needs a human`,
        body: `Instagram — "${message.slice(0, 120)}"`,
        linkView: "instagram",
      })
    } catch (e: any) {
      console.error("flagFrustratedInstagram error:", e.message)
    }
  })()
}
