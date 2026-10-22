// Speech-to-scheduler (Outpero-style smart reschedule).
//
// "రేపు చెప్తాను sir" / "call me at 6pm" / "कल शाम को call करना" used to hit
// the CUSTOMER_BYE_RE and just end the call — the promise lived only in the
// transcript, and a redial happened ONLY if an operator manually read the
// log and set a callback. Now the intent is detected on the live call, the
// time (if spoken) is parsed, the callback lands on leads.callback_at (the
// dashboard Calendar view reads it), and Priya CONFIRMS it before hanging
// up — same "every detail logged" promise Outpero makes.
//
// Kept deliberately regex-based (no LLM call): this runs on the live-call
// path before the turn, and a missed vague promise costs nothing (the Lead
// Brain still captures best_time_to_call), while a wrong overwrite of a
// manually-set callback would be worse. Only an explicit future-contact
// phrase triggers it — plain goodbyes ("sare bye", "thank you") never match.

export type RescheduleMatch = {
  /** ISO string of the parsed callback time (already in the future). */
  whenIso: string
  /** Human description for the spoken confirmation, per language. */
  desc: { english: string; hindi: string; telugu: string }
  /** What the caller actually said (stored on the callback note). */
  note: string
  /** The spoken confirmation Priya says before hanging up. */
  confirm: string
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

// Explicit REQUEST FOR PRIYA/COMPANY TO CALL:
// Caller requests the agent to call back ("repu call cheyyandi", "call me tomorrow").
// Does NOT match caller-initiated calls ("repu call chesta", "nenu tarvata chesta").
const INTENT_RE = new RegExp(
  [
    // English: "call me at 6", "call me tomorrow", "please ring me later", "call me back"
    `\\b(?:please\\s+)?(?:call\\s+me|call\\s+us|ring\\s+me|reach\\s+me|talk\\s+to\\s+me)\\b[^.?!]{0,40}\\b(?:later|tomorrow|tonight|today|morning|afternoon|evening|night|next week|${WEEKDAYS.join("|")})\\b`,
    `\\b(?:later|tomorrow|tonight|next week|${WEEKDAYS.join("|")})\\b[^.?!]{0,40}\\b(?:please\\s+)?(?:call\\s+me|call\\s+us|ring\\s+me)\\b`,
    `\\b(?:busy|busy right now|can't talk right now|in a meeting)\\b[^.?!]{0,35}\\b(?:call\\s+me|call\\s+later|call\\s+tomorrow)\\b`,
    // Romanized Telugu: requesting the agent to call - cheyandi/cheyyandi/matladandi
    `\\b(?:repu|tarvata|tarvatha|malli|sayanthram|udayam|evening lo|morning lo)\\b[^.?!]{0,30}\\b(?:call\\s+cheyandi|call\\s+cheyyandi|phone\\s+cheyandi|phone\\s+cheyyandi|matladandi|ring\\s+cheyandi)\\b`,
    `\\b(?:call\\s+cheyandi|call\\s+cheyyandi|phone\\s+cheyandi|matladandi)\\b[^.?!]{0,20}\\b(?:repu|tarvata|sayanthram|udayam)\\b`,
    `\\b(?:busy|busy ga unnanu|meeting lo unnanu)\\b[^.?!]{0,35}\\b(?:tarvata|repu)?\\s*(?:call\\s+cheyandi|call\\s+cheyyandi)\\b`,
    // Native Telugu: asking agent to call
    `(?:రేపు|తర్వాత|సాయంత్రం|మళ్ళీ)[^.?!]{0,25}(?:కాల్\\s*చేయండి|ఫోన్\\s*చేయండి|మాట్లాడండి)`,
    `(?:కాల్\\s*చేయండి|ఫోన్\\s*చేయండి|మాట్లాడండి)[^.?!]{0,20}(?:రేపు|తర్వాత|సాయంత్రం)`,
    // Hindi: asking agent to call
    `\\b(?:kal|baad me|baad mein|shaam ko|subah)\\b[^.?!]{0,30}\\b(?:call\\s+kijiye|call\\s+karna|call\\s+kariyega|phone\\s+kijiye|phone\\s+karna)\\b`,
    `\\b(?:call|phone)\\s+(?:kijiye|karna|kariyega)\\b[^.?!]{0,25}\\b(?:kal|shaam|subah|baad me)\\b`,
    `कल.{0,15}(?:कॉल कीजिए|कॉल करना|फोन करना)|बाद में.{0,15}(?:कॉल कीजिए|कॉल करना)`,
  ].join("|"),
  "i"
)

// CALLER SAYS THEY WILL CALL OR CHECK LATER:
// "repu call chesta" / "nenu tarvata call chesta" / "chusi cheptanu".
// Caller-initiated -> DO NOT auto-schedule an outbound callback in Calendar.
export const CALLER_WILL_CALL_RE = new RegExp(
  [
    `\\b(?:nenu|memu)?\\s*(?:repu|tarvata|tarvatha|malli|sayanthram|udayam|evening lo|morning lo)\\b[^.?!]{0,30}\\b(?:call\\s+chesta|call\\s+chestanu|matladathanu|matladathaa|cheptanu|cheptha|vastaanu|vastanu|osthanu)\\b`,
    `\\b(?:nenu|memu)\\s+(?:tarvata|malli|repu)?\\s*(?:call\\s+chesta|call\\s+chestanu|matladathanu)\\b`,
    `\\b(?:chusi|chuse)\\s+(?:cheptanu|cheptha)\\b`,
    `(?:నేను|మేము)?\\s*(?:రేపు|తర్వాత|మళ్ళీ|సాయంత్రం)[^.?!]{0,25}(?:కాల్\\s*చేస్తా|కాల్\\s*చేస్తాను|మాట్లాడతాను|చెప్తాను|చూసి\\s*చెప్తాను|వస్తాను)`,
    `\\b(?:i|i'll|i will|let me|we will)\\s+(?:call|reach out|contact|ring|check and call)\\s+(?:you\\s+)?(?:back|later|tomorrow|tonight|next week)?\\b`,
    `\\b(?:main|hum)\\s+(?:baad me|kal|phir)\\s+(?:call\\s+karunga|call\\s+karenge|baat\\s+karunga)\\b`,
    `मैं.{0,15}(?:कॉल करूँगा|बात करूँगा|फोन करूँगा)`,
  ].join("|"),
  "i"
)

export function detectCallerWillCall(speech: string): boolean {
  if (!speech || speech.length > 300) return false
  return CALLER_WILL_CALL_RE.test(speech)
}

// Explicit clock time in the speech ("6pm", "6:30", "6 baje", "18:00", "evening 5").
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje|बजे)?/i

type DayPart = { hour: number; minute: number; desc: { english: string; hindi: string; telugu: string } }

const MORNING: DayPart = {
  hour: 10, minute: 30,
  desc: { english: "tomorrow morning", hindi: "कल सुबह", telugu: "రేపు ఉదయం" },
}
const EVENING: DayPart = {
  hour: 17, minute: 30,
  desc: { english: "this evening", hindi: "आज शाम को", telugu: "ఈ సాయంత్రం" },
}
const EVENING_TOMORROW: DayPart = {
  hour: 17, minute: 30,
  desc: { english: "tomorrow evening", hindi: "कल शाम को", telugu: "రేపు సాయంత్రం" },
}
const VAGUE_LATER: DayPart = {
  hour: 10, minute: 30,
  desc: { english: "tomorrow", hindi: "कल", telugu: "రేపు" },
}

function inIST(dayOffset: number, hour: number, minute: number): Date {
  // The business runs on IST (Asia/Kolkata) regardless of server TZ: build
  // the wall-clock time from an IST-anchored "now", then convert to real UTC.
  const nowUtcMs = Date.now()
  const istNowMs = nowUtcMs + 5.5 * 60 * 60 * 1000
  const istDate = new Date(istNowMs)
  const y = istDate.getUTCFullYear()
  const m = istDate.getUTCMonth()
  const d = istDate.getUTCDate()
  const target = Date.UTC(y, m, d + dayOffset, hour, minute, 0)
  return new Date(target - 5.5 * 60 * 60 * 1000)
}

function nextWeekday(name: string): Date {
  const targetIdx = WEEKDAYS.indexOf(name.toLowerCase())
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
  const todayIdx = istNow.getUTCDay()
  let diff = (targetIdx - todayIdx + 7) % 7
  if (diff === 0) diff = 7
  return inIST(diff, 10, 30)
}

/** Parse a reschedule match into a concrete callback time. */
export function parseRescheduleTime(speech: string): { when: Date; desc: RescheduleMatch["desc"] } | null {
  const s = (speech || "").toLowerCase()
  const has = (...words: string[]) => words.some((w) => s.includes(w))
  const tomorrow = has("repu", "tomorrow", "kal ", "कल", "రేపు")
  const evening = has("evening", "shaam", "sayanthram", "సాయంత్రం", "शाम")
  const morning = has("morning", "subah", "udayam", "ఉదయం", "सुबह")
  const tonight = has("tonight", "raat", "రాత్రి", "रात")
  const weekday = WEEKDAYS.find((w) => s.includes(w))
  const nextWeek = s.includes("next week") || s.includes("varam tarvata")

  // Explicit clock time wins ("call me at 6pm", "6 baje", "at 6:30").
  const t = speech.match(TIME_RE)
  if (t) {
    let hour = parseInt(t[1], 10)
    const minute = t[2] ? parseInt(t[2], 10) : 0
    const ap = (t[3] || "").toLowerCase()
    if (ap === "pm" && hour < 12) hour += 12
    if (ap === "am" && hour === 12) hour = 0
    if (!ap) {
      // Bare "6" with evening context → evening; else assume it is a clock
      // hour in 24h if > 12, else morning.
      if (hour <= 12 && (evening || tonight)) hour += 12
    }
    if (hour >= 0 && hour <= 23 && minute <= 59) {
      // "at 6" — if that time already passed today, push to tomorrow.
      const dayOffset = tomorrow ? 1 : 0
      let when = inIST(dayOffset, hour, minute)
      if (!tomorrow && when.getTime() <= Date.now()) when = inIST(1, hour, minute)
      const h12 = hour % 12 === 0 ? 12 : hour % 12
      const apDesc = hour < 12 ? "am" : "pm"
      const mmDesc = minute ? `:${String(minute).padStart(2, "0")}` : ""
      const isEvening = hour >= 16 || (hour >= 12 && ap === "pm")
      return {
        when,
        desc: {
          english: `${tomorrow ? "tomorrow" : "today"} at ${h12}${mmDesc} ${apDesc}`,
          hindi: `${tomorrow ? "कल" : "आज"} ${h12}${mmDesc} ${hour < 12 ? "सुबह" : isEvening ? "शाम" : "दिन"} को`,
          telugu: `${tomorrow ? "రేపు" : "ఈ రోజు"} ${h12}${mmDesc} ${hour < 12 ? "ఉదయం" : isEvening ? "సాయంత్రం" : "మధ్యాహ్నం"} కి`,
        },
      }
    }
  }

  if (weekday) {
    const when = nextWeekday(weekday)
    return {
      when,
      desc: {
        english: `on ${weekday}`,
        hindi: `${weekday} को`,
        telugu: `${weekday} నాడు`,
      },
    }
  }
  if (nextWeek) {
    return {
      when: inIST(7, 10, 30),
      desc: { english: "next week", hindi: "अगले हफ्ते", telugu: "వచ్చే వారం" },
    }
  }
  if (tonight) {
    return { when: inIST(0, 19, 30), desc: { english: "tonight", hindi: "आज रात", telugu: "ఈ రాత్రి" } }
  }
  if (evening && tomorrow) return { when: inIST(1, EVENING_TOMORROW.hour, EVENING_TOMORROW.minute), desc: EVENING_TOMORROW.desc }
  if (evening) return { when: inIST(0, EVENING.hour, EVENING.minute), desc: EVENING.desc }
  if (morning) {
    const off = tomorrow ? 1 : 0
    return { when: inIST(off, MORNING.hour, MORNING.minute), desc: MORNING.desc }
  }
  if (tomorrow) return { when: inIST(1, VAGUE_LATER.hour, VAGUE_LATER.minute), desc: VAGUE_LATER.desc }
  // Vague "later/tarvata" with no day at all → tomorrow morning default.
  return { when: inIST(1, VAGUE_LATER.hour, VAGUE_LATER.minute), desc: VAGUE_LATER.desc }
}

/** True when the caller is promising FUTURE contact (not a plain goodbye). */
export function detectRescheduleIntent(speech: string): boolean {
  if (!speech || speech.length > 300) return false
  return INTENT_RE.test(speech)
}

/**
 * Build everything the call path needs: the parsed time, the note to store,
 * and the spoken confirmation per language. Returns null when no concrete
 * intent — the caller then falls through to the normal turn/bye handling.
 */
export function buildReschedule(
  speech: string,
  language: "english" | "hindi" | "telugu"
): RescheduleMatch | null {
  if (!detectRescheduleIntent(speech)) return null
  const parsed = parseRescheduleTime(speech)
  if (!parsed) return null
  const confirmations: Record<string, string> = {
    english: `Sure sir, I'll call you ${parsed.desc.english}. Thank you so much!`,
    hindi: `ठीक है sir, मैं ${parsed.desc.hindi} आपको call कर लूँगी. धन्यवाद sir!`,
    telugu: `సరే sir, నేను ${parsed.desc.telugu} మీకు call చేస్తాను. ధన్యవాదాలు sir!`,
  }
  return {
    whenIso: parsed.when.toISOString(),
    desc: parsed.desc,
    note: `Auto-scheduled from call: "${speech.slice(0, 120)}" — ${parsed.desc.english}`,
    confirm: confirmations[language] || confirmations.english,
  }
}
