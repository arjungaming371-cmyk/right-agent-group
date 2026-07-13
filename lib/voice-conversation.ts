import { randomUUID } from "crypto"
import { db, query } from "./db"
import { chatWithOllama, extractLeadInfo, mightBeComplete, type Language } from "./ollama"
import { sendApplicationLink } from "./whatsapp"
import { buildLeadBrief } from "./lead-brain"
import { detectFrustration, flagFrustratedCall } from "./frustration"

// Permission-based opener — respect keeps people on the line.
// Neutral/informational by design: this is an intake call, not a sales
// pitch, so it states the purpose plainly instead of leading with benefits.
export const GREETINGS: Record<Language, string> = {
  english:
    "Hello, good morning! This is Priya calling from Right Agent Group, Hyderabad. This will take just one minute — I'm calling to note down a few details for a loan application: your name, city, and a WhatsApp number to send the application link. May I have your full name, please?",
  hindi:
    "नमस्ते! मैं Priya बोल रही हूं, Right Agent Group, Hyderabad से। सिर्फ एक मिनट लगेगा — मैं लोन आवेदन के लिए कुछ जानकारी नोट करने के लिए कॉल कर रही हूं: आपका नाम, शहर और आवेदन लिंक भेजने के लिए WhatsApp नंबर। कृपया अपना पूरा नाम बताएं?",
  telugu:
    "నమస్కారం! నేను Priya, Right Agent Group, Hyderabad నుండి మాట్లాడుతున్నాను. ఒక్క నిమిషం చాలు — లోన్ అప్లికేషన్ కోసం కొన్ని వివరాలు నోట్ చేయడానికి కాల్ చేస్తున్నాను: మీ పేరు, ఊరు, మరియు అప్లికేషన్ లింక్ పంపడానికి WhatsApp నంబర్. దయచేసి మీ పూర్తి పేరు చెప్పండి?",
}

// Inbound calls are the customer's initiative — greet like a receptionist,
// not a telemarketer. The pitch only comes later, if it fits.
export const INBOUND_GREETINGS: Record<Language, string> = {
  english:
    "Hello! Thank you for calling Right Agent Group, Hyderabad. This is Priya. How can I help you today?",
  hindi:
    "नमस्ते! Right Agent Group, Hyderabad में कॉल करने के लिए धन्यवाद। मैं Priya बोल रही हूं। बताइए, मैं आपकी क्या मदद कर सकती हूं?",
  telugu:
    "నమస్కారం! Right Agent Group, Hyderabad కి కాల్ చేసినందుకు ధన్యవాదాలు. నేను Priya. చెప్పండి, మీకు ఎలా సహాయం చేయగలను?",
}

const CLOSING: Record<Language, string> = {
  english: "Thank you! I'm sending the application link to your WhatsApp right now. Our loan officer will confirm your best offer soon. Have a great day!",
  hindi: "धन्यवाद! मैं अभी आपके WhatsApp पर आवेदन लिंक भेज रही हूं। हमारे लोन ऑफिसर जल्द आपका बेस्ट ऑफर कन्फर्म करेंगे। आपका दिन शुभ हो!",
  telugu: "ధన్యవాదాలు! నేను ఇప్పుడు మీ WhatsApp కి అప్లికేషన్ లింక్ పంపుతున్నాను. మా లోన్ ఆఫీసర్ త్వరలో మీ బెస్ట్ ఆఫర్ కన్ఫర్మ్ చేస్తారు. మీకు మంచి రోజు జరగాలి!",
}

// Inbound calls auto-create a lead with a placeholder like "Caller 8090"
// before we know the real name — never greet someone by that fake name.
const PLACEHOLDER_NAME_RE = /^Caller \d+$/

function personalizedGreeting(language: Language, name: string): string {
  const templates: Record<Language, string> = {
    english: `Hello ${name}! This is Priya calling from Right Agent Group, Hyderabad. This will take just a minute — I just need to confirm a couple of details and get a WhatsApp number to send your application link.`,
    hindi: `नमस्ते ${name} जी! मैं Priya बोल रही हूं, Right Agent Group, Hyderabad से। सिर्फ एक मिनट लगेगा — मुझे बस कुछ जानकारी कन्फर्म करनी है और आवेदन लिंक भेजने के लिए WhatsApp नंबर चाहिए।`,
    telugu: `నమస్కారం ${name} గారు! నేను Priya, Right Agent Group, Hyderabad నుండి మాట్లాడుతున్నాను. ఒక్క నిమిషం చాలు — నేను కొన్ని వివరాలు నిర్ధారించి, అప్లికేషన్ లింక్ పంపడానికి WhatsApp నంబర్ తీసుకోవాలి.`,
  }
  return templates[language]
}

function personalizedInboundGreeting(language: Language, name: string): string {
  const templates: Record<Language, string> = {
    english: `Hello ${name}! Thank you for calling Right Agent Group, Hyderabad. This is Priya. How can I help you today?`,
    hindi: `नमस्ते ${name} जी! Right Agent Group, Hyderabad में कॉल करने के लिए धन्यवाद। मैं Priya बोल रही हूं। बताइए, मैं आपकी क्या मदद कर सकती हूं?`,
    telugu: `నమస్కారం ${name} గారు! Right Agent Group, Hyderabad కి కాల్ చేసినందుకు ధన్యవాదాలు. నేను Priya. చెప్పండి, మీకు ఎలా సహాయం చేయగలను?`,
  }
  return templates[language]
}

const RETRY_MSG: Record<Language, string> = {
  english: "Sorry, I had a small technical moment. Could you please share your name so I can send your loan application link?",
  hindi:   "माफ कीजिए, छोटी तकनीकी समस्या हुई। कृपया अपना नाम बताएं ताकि मैं आपका लोन आवेदन लिंक भेज सकूं।",
  telugu:  "క్షమించండి, చిన్న సాంకేతిక సమస్య వచ్చింది. దయచేసి మీ పేరు చెప్పండి, మీ లోన్ అప్లికేషన్ లింక్ పంపుతాను.",
}

// FIXED: only real goodbye phrases end the call.
// Plain "thank you" / "धन्यवाद" / "ధన్యవాదాలు" must NOT hang up —
// Priya says thanks naturally in the middle of a conversation.
const GOODBYE_RE =
  /goodbye|bye[- ]?bye|have a (great|good|nice) day|अलविदा|फिर मिलेंगे|दिन शुभ हो|వీడ్కోలు|సెలవు|మంచి రోజు జరగాలి/i

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

function updateTranscriptAsync(leadId: string | null, callSid: string | null, speech: string, reply: string): void {
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

export async function handleTurn(opts: {
  leadId: string
  callSid: string | null
  speech: string
  language: Language
  instructions?: string
}): Promise<{ text: string; hangup: boolean }> {
  const { leadId, callSid, speech, language, instructions } = opts

  const history = callSid ? await getHistory(callSid) : []
  const messages = [...history, { role: "user" as const, content: speech }]

  // FRUSTRATION RADAR: zero-latency keyword pass; flagging is fire-and-forget.
  if (detectFrustration(speech, history.map((h) => ({ role: h.role === "model" ? "model" : "user", content: h.content })))) {
    flagFrustratedCall(callSid, leadId || null, speech)
  }

  // LEAD BRAIN: brief Priya with the full cross-channel picture — known
  // facts, rolling relationship summary, recent interactions, sentiment
  // warnings — only on the first couple of turns, since after that it's
  // already in the conversation history and re-injecting would just waste
  // tokens. One cheap query (lib/lead-brain.ts), no live Ollama analysis.
  let mergedInstructions = instructions || ""
  if (leadId && history.length <= 2) {
    const brief = await buildLeadBrief(leadId)
    mergedInstructions = [mergedInstructions, brief].filter(Boolean).join("\n\n")
  }

  let reply = ""
  try {
    reply = (await chatWithOllama(messages, language, mergedInstructions || undefined)).trim()
    if (!reply) reply = GREETINGS[language]
  } catch (e) {
    console.error("Ollama error:", e)
    reply = RETRY_MSG[language]
  }

  updateTranscriptAsync(leadId || null, callSid, speech, reply)

  // SPEED FIX: a lead can only be complete once a WhatsApp number exists in
  // the transcript. Skip the second (expensive) Ollama extraction call until
  // a phone-number-like string actually appears — most turns stay at ONE
  // model call, which roughly halves per-turn latency.
  const allTurns = [...messages, { role: "model" as const, content: reply }]
  const transcriptText = allTurns.map((m) => `${m.role === "model" ? "Priya" : "Customer"}: ${m.content}`).join("\n")

  if (mightBeComplete(transcriptText)) {
    const extracted = await extractLeadInfo(transcriptText)

    if (extracted.complete && leadId) {
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
          if (callSid) {
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
        }
      } catch (e) {
        console.error("lead completion error:", e)
      }
      return { text: CLOSING[language], hangup: true }
    }
  }

  return { text: reply, hangup: GOODBYE_RE.test(reply) }
}
