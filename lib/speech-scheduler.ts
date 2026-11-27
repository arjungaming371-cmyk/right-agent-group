// Speech-to-scheduler (Outpero-style smart reschedule).
//
// Detects future-contact intent on live calls, parses relative durations,
// explicit clock times, weekdays, and day parts in English, Telugu, and Hindi,
// anchors all timestamps in IST (Asia/Kolkata), and generates human-like
// confirmations matching the exact resolved timestamp.

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

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

const WEEKDAY_LOCAL: Record<string, number> = {
  sunday: 0, ravivaar: 0, aadhivaaram: 0, ఆదివారం: 0, रविवार: 0,
  monday: 1, somvaar: 1, somavaaram: 1, సోమవారం: 1, सोमवार: 1,
  tuesday: 2, mangalvaar: 2, mangalavaaram: 2, మంగళవారం: 2, मंगलवार: 2,
  wednesday: 3, budhvaar: 3, budhavaaram: 3, బుధవారం: 3, बुधवार: 3,
  thursday: 4, guruvaar: 4, guruvaaram: 4, గురువారం: 4, गुरुवार: 4, brihaspativaar: 4,
  friday: 5, shukravaar: 5, sukravaaram: 5, శుక్రవారం: 5, शुक्रवार: 5,
  saturday: 6, shanivaar: 6, shanivaaram: 6, శనివారం: 6, शनिवार: 6,
}

// Explicit REQUEST FOR PRIYA/COMPANY TO CALL:
// Caller requests the agent to call back ("repu call cheyyandi", "call me tomorrow").
// Does NOT match caller-initiated calls ("repu call chesta", "nenu tarvata chesta").
const INTENT_RE = new RegExp(
  [
    // English: "call me at 6", "call me tomorrow", "please ring me later", "call me back"
    `\\b(?:please\\s+)?(?:call\\s+me|call\\s+us|ring\\s+me|reach\\s+me|talk\\s+to\\s+me)\\b[^.?!]{0,50}\\b(?:later|tomorrow|tonight|today|morning|afternoon|evening|night|next week|at\\s+\\d+|in\\s+\\d+|after\\s+\\d+|${WEEKDAYS.join("|")})`,
    `\\b(?:later|tomorrow|tonight|next week|after\\s+\\d+|in\\s+\\d+\\s+hours?|evening|morning|${WEEKDAYS.join("|")})\\b[^.?!]{0,40}\\b(?:please\\s+)?(?:call\\s+me|call\\s+us|ring\\s+me)\\b`,
    `\\b(?:busy|busy right now|can't talk right now|in a meeting)\\b[^.?!]{0,35}\\b(?:call\\s+me|call\\s+later|call\\s+tomorrow)\\b`,
    // Romanized Telugu: requesting the agent to call - cheyandi/cheyyandi/matladandi/matladadam
    `\\b(?:repu|tarvata|tarvatha|malli|sayanthram|udayam|evening|morning|evening lo|morning lo|${WEEKDAYS.join("|")})\\b[^.?!]{0,50}\\b(?:call\\s+cheyandi|call\\s+cheyyandi|phone\\s+cheyandi|phone\\s+cheyyandi|matladandi|matladadam|matladudam|ring\\s+cheyandi)\\b`,
    `\\b(?:call\\s+cheyandi|call\\s+cheyyandi|phone\\s+cheyandi|matladandi|matladadam|matladudam)\\b[^.?!]{0,40}\\b(?:repu|tarvata|sayanthram|udayam|evening|morning|${WEEKDAYS.join("|")})\\b`,
    `\\b(?:busy|busy ga unnanu|meeting lo unnanu)\\b[^.?!]{0,35}\\b(?:tarvata|repu)?\\s*(?:call\\s+cheyandi|call\\s+cheyyandi)\\b`,
    // Native Telugu: asking agent to call
    `(?:రేపు|తర్వాత|సాయంత్రం|మళ్ళీ)[^.?!]{0,30}(?:కాల్\\s*చేయండి|ఫోన్\\s*చేయండి|మాట్లాడండి)`,
    `(?:కాల్\\s*చేయండి|ఫోన్\\s*చేయండి|మాట్లాడండి)[^.?!]{0,25}(?:రేపు|తర్వాత|సాయంత్రం)`,
    // Hindi: asking agent to call
    `\\b(?:kal|baad me|baad mein|shaam ko|sham ko|subah|(?:\\d+|ek|do|teen|chaar|paanch)\\s+ghante\\s+baad)\\b[^.?!]{0,35}\\b(?:call\\s+kijiye|call\\s+karna|call\\s+kariyega|call\\s+karo|phone\\s+kijiye|phone\\s+karna)\\b`,
    `\\b(?:call|phone)\\s+(?:kijiye|karna|kariyega|karo)\\b[^.?!]{0,30}\\b(?:kal|shaam|sham|subah|baad me|baad mein)\\b`,
    `कल.{0,20}(?:कॉल कीजिए|कॉल करना|फोन करना)|बाद में.{0,20}(?:कॉल कीजिए|कॉल करना)`,
    `\\bcall\\s+back\\s+(?:tomorrow|later|tonight)\\b`,
    `\\bcall\\s+me\\s+in\\s+\\w+\\s+(?:hours?|hrs?|minutes?|mins?)\\b`,
  ].join("|"),
  "i"
)

// CALLER SAYS THEY WILL CALL OR CHECK LATER:
// "repu call chesta" / "nenu tarvata call chesta" / "chusi cheptanu".
// Caller-initiated -> DO NOT auto-schedule an outbound callback in Calendar.
export const CALLER_WILL_CALL_RE = new RegExp(
  [
    `\\b(?:nenu|memu|nene)?\\s*(?:repu|tarvata|tarvatha|malli|sayanthram|udayam|evening lo|morning lo|office ayyaka|free ayyaka)\\b[^.?!]{0,35}\\b(?:call\\s+chesta|call\\s+chestanu|matladathanu|matladathaa|cheptanu|cheptha|vastaanu|vastanu|osthanu|chestale|chesta\\s+le)\\b`,
    `\\b(?:nenu|memu|nene)\\s+(?:tarvata|malli|repu|chusi|office velli)?\\s*(?:call\\s+chesta|call\\s+chestanu|matladathanu|chestale|chesta\\s+le)\\b`,
    `\\b(?:nene\\s+chestale|nene\\s+call\\s+chesta)\\b`,
    `\\b(?:chusi|chuse)\\s+(?:cheptanu|cheptha|call chestanu|call chesta)\\b`,
    `(?:నేను|మేము)?\\s*(?:రేపు|తర్వాత|మళ్ళీ|సాయంత్రం)[^.?!]{0,30}(?:కాల్\\s*చేస్తా|కాల్\\s*చేస్తాను|మాట్లాడతాను|చెప్తాను|చూసి\\s*చెప్తాను|వస్తాను)`,
    `\\b(?:i|i'll|i will|let me|we will)\\s+(?:call|reach out|contact|ring|check and call)(?:\\s+you)?(?:\\s+back|\\s+later|\\s+tomorrow|\\s+tonight|\\s+next week|\\s+when[^.?!]{0,20})?\\b`,
    `\\b(?:i will|i'll)\\s+(?:check and call back|call back later|call when[^.?!]{0,20})\\b`,
    `\\b(?:main|hum)?\\s*(?:baad me|baad mein|kal|phir|khud|free hokar)\\s+(?:call\\s+karunga|call\\s+karenge|call\\s+karti hoon|call\\s+karta hoon|baat\\s+karunga)\\b`,
    `मैं.{0,20}(?:कॉल करूँगा|बात करूँगा|फोन करूँगा|कॉल करती हूँ)`,
  ].join("|"),
  "i"
)

export function detectCallerWillCall(speech: string): boolean {
  if (!speech) return false
  return CALLER_WILL_CALL_RE.test(speech)
}

// Relative durations: "in two hours", "in 2 hours", "after 3 hours", "2 ghante baad", "in 30 mins", "in half an hour"
const RELATIVE_DURATION_RE = /\b(?:in|after)\s+(\d{1,2}|an?|one|two|three|four|five|six|seven|eight|half|ek|do|teen|chaar|paanch|okka|rendu|moodu)\s+(hours?|hrs?|ghante?|minutes?|mins?|nimishalu|ghanta)\b|\b(\d{1,2}|one|two|three|four|five|six|ek|do|teen|chaar|paanch|okka|rendu|moodu)\s+(?:hours?|hrs?|ghante?|minutes?|mins?|nimishalu|ghanta)\s+(?:baad|tarvata|later)\b/i

const WORD_NUMS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5,
  ek: 1, do: 2, teen: 3, chaar: 4, paanch: 5, cheh: 6,
  okka: 1, rendu: 2, moodu: 3, naalugu: 4, aidu: 5,
}

// Explicit clock time in speech ("6pm", "6:30", "6 baje", "18:00", "evening 5", "six ki", "6 ki").
const TIME_RE = /\b(?:at\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm|baje|बजे|ki|ku|గంటలకు)?\b/i

type DayPart = { hour: number; minute: number; desc: { english: string; hindi: string; telugu: string } }

const MORNING: DayPart = {
  hour: 10, minute: 30,
  desc: { english: "tomorrow morning at 10:30 am", hindi: "कल सुबह 10:30 बजे", telugu: "రేపు ఉదయం 10:30 గంటలకు" },
}
const EVENING: DayPart = {
  hour: 17, minute: 30,
  desc: { english: "this evening at 5:30 pm", hindi: "आज शाम को 5:30 बजे", telugu: "ఈ సాయంత్రం 5:30 గంటలకు" },
}
const EVENING_TOMORROW: DayPart = {
  hour: 17, minute: 30,
  desc: { english: "tomorrow evening at 5:30 pm", hindi: "कल शाम को 5:30 बजे", telugu: "రేపు సాయంత్రం 5:30 గంటలకు" },
}
const VAGUE_LATER: DayPart = {
  hour: 10, minute: 30,
  desc: { english: "tomorrow at 10:30 am", hindi: "कल 10:30 बजे", telugu: "రేపు ఉదయం 10:30 గంటలకు" },
}

function inIST(dayOffset: number, hour: number, minute: number): Date {
  const nowUtcMs = Date.now()
  const istNowMs = nowUtcMs + 5.5 * 60 * 60 * 1000
  const istDate = new Date(istNowMs)
  const y = istDate.getUTCFullYear()
  const m = istDate.getUTCMonth()
  const d = istDate.getUTCDate()
  const target = Date.UTC(y, m, d + dayOffset, hour, minute, 0)
  return new Date(target - 5.5 * 60 * 60 * 1000)
}

function nextWeekdayOffset(name: string, isNextWeek: boolean): number {
  const lower = name.toLowerCase()
  let targetIdx = WEEKDAYS.indexOf(lower)
  if (targetIdx === -1 && WEEKDAY_LOCAL[lower] !== undefined) {
    targetIdx = WEEKDAY_LOCAL[lower]
  }
  if (targetIdx === -1) return 1
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
  const todayIdx = istNow.getUTCDay()
  let diff = (targetIdx - todayIdx + 7) % 7
  if (diff === 0 || isNextWeek) diff += 7
  return diff
}

/** Parse a reschedule match into a concrete callback time. */
export function parseRescheduleTime(speech: string): { when: Date; desc: RescheduleMatch["desc"] } | null {
  const s = (speech || "").toLowerCase()
  const has = (...words: string[]) => words.some((w) => s.includes(w))

  // 1. RELATIVE DURATIONS ("in two hours", "in 2 hours", "after 30 minutes", "2 ghante baad")
  const rel = speech.match(RELATIVE_DURATION_RE)
  if (rel) {
    const rawVal = (rel[1] || rel[3] || "").toLowerCase()
    const val = WORD_NUMS[rawVal] !== undefined ? WORD_NUMS[rawVal] : parseFloat(rawVal)
    const unit = (rel[2] || "").toLowerCase()
    const isMinute = unit.startsWith("min")
    const durationMinutes = isMinute ? val : val * 60

    if (!isNaN(durationMinutes) && durationMinutes > 0) {
      const when = new Date(Date.now() + durationMinutes * 60 * 1000)
      const numLabel = val === 0.5 ? "half" : val.toString()
      const unitLabel = isMinute ? (val === 1 ? "minute" : "minutes") : (val === 1 ? "hour" : "hours")
      return {
        when,
        desc: {
          english: `in ${numLabel} ${unitLabel}`,
          hindi: `${numLabel} ${isMinute ? "मिनट" : "घंटे"} बाद`,
          telugu: `${numLabel} ${isMinute ? "నిమిషాల" : "గంటల"} తర్వాత`,
        },
      }
    }
  }

  const tomorrow = has("repu", "tomorrow", "kal ", "कल", "రేపు")
  const evening = has("evening", "shaam", "sham", "sayanthram", "సాయంత్రం", "शाम")
  const morning = has("morning", "subah", "udayam", "ఉదయం", "सुबह")
  const tonight = has("tonight", "raat", "రాత్రి", "रात")
  const isNext = s.includes("next") || s.includes("varam tarvata") || s.includes("agla")

  // Check weekday
  let matchedWeekday: string | null = null
  for (const w of WEEKDAYS) {
    if (s.includes(w)) {
      matchedWeekday = w
      break
    }
  }
  if (!matchedWeekday) {
    for (const [k] of Object.entries(WEEKDAY_LOCAL)) {
      if (s.includes(k)) {
        matchedWeekday = k
        break
      }
    }
  }

  // 2. EXPLICIT CLOCK TIME ("6pm", "6:30", "at 6", "6 baje", "six ki", "6 ki")
  const t = speech.match(TIME_RE)
  if (t) {
    const rawH = t[1].toLowerCase()
    let hour = WORD_NUMS[rawH] !== undefined ? Math.floor(WORD_NUMS[rawH]) : parseInt(rawH, 10)
    const minute = t[2] ? parseInt(t[2], 10) : 0
    const ap = (t[3] || "").toLowerCase()

    if (!isNaN(hour) && hour >= 0 && hour <= 24) {
      if (ap === "pm" && hour < 12) hour += 12
      if (ap === "am" && hour === 12) hour = 0
      if (!ap || ap === "baje" || ap === "बजे" || ap === "ki" || ap === "ku" || ap === "గంటలకు") {
        if (hour <= 12 && (evening || tonight)) {
          hour += 12
        } else if (hour <= 12 && !morning && !ap.includes("am")) {
          // Normal business hours convention in India:
          // 1, 2, 3, 4, 5, 6 without morning context are PM hours (13:00 - 18:00)
          // 9, 10, 11 are AM hours (09:00 - 11:00)
          if (hour >= 1 && hour <= 6) hour += 12
        }
      }

      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        let dayOffset = 0
        if (matchedWeekday) {
          dayOffset = nextWeekdayOffset(matchedWeekday, isNext)
        } else if (tomorrow) {
          dayOffset = 1
        } else {
          // If time already passed today in IST, schedule for tomorrow
          const testTime = inIST(0, hour, minute)
          if (testTime.getTime() <= Date.now() + 10 * 60 * 1000) {
            dayOffset = 1
          }
        }

        const when = inIST(dayOffset, hour, minute)
        const h12 = hour % 12 === 0 ? 12 : hour % 12
        const apDesc = hour < 12 ? "am" : "pm"
        const mmDesc = minute ? `:${String(minute).padStart(2, "0")}` : ":00"
        const isEvening = hour >= 16 || (hour >= 12 && ap === "pm")
        const isMorning = hour < 12

        let dayDescEn = dayOffset === 0 ? "today" : dayOffset === 1 ? "tomorrow" : `on ${matchedWeekday ? matchedWeekday.charAt(0).toUpperCase() + matchedWeekday.slice(1) : "next week"}`
        let dayDescHi = dayOffset === 0 ? "आज" : dayOffset === 1 ? "कल" : `${matchedWeekday || "अगले हफ्ते"}`
        let dayDescTe = dayOffset === 0 ? "ఈ రోజు" : dayOffset === 1 ? "రేపు" : `${matchedWeekday || "వచ్చే వారం"}`

        return {
          when,
          desc: {
            english: `${dayDescEn} at ${h12}${mmDesc} ${apDesc}`,
            hindi: `${dayDescHi} ${isMorning ? "सुबह" : isEvening ? "शाम" : "दोपहर"} ${h12}${mmDesc} बजे`,
            telugu: `${dayDescTe} ${isMorning ? "ఉదయం" : isEvening ? "సాయంత్రం" : "మధ్యాహ్నం"} ${h12}${mmDesc} గంటలకు`,
          },
        }
      }
    }
  }

  // 3. WEEKDAYS WITHOUT EXPLICIT TIME
  if (matchedWeekday) {
    const diff = nextWeekdayOffset(matchedWeekday, isNext)
    const when = inIST(diff, 10, 30)
    const capitalized = matchedWeekday.charAt(0).toUpperCase() + matchedWeekday.slice(1)
    return {
      when,
      desc: {
        english: `on ${capitalized} at 10:30 am`,
        hindi: `${matchedWeekday} को सुबह 10:30 बजे`,
        telugu: `${matchedWeekday} ఉదయం 10:30 గంటలకు`,
      },
    }
  }

  // 4. DAY PARTS (without specific clock time)
  if (tonight) {
    return {
      when: inIST(0, 19, 30),
      desc: { english: "tonight at 7:30 pm", hindi: "आज रात 7:30 बजे", telugu: "ఈ రాత్రి 7:30 గంటలకు" }
    }
  }
  if (evening && tomorrow) {
    return {
      when: inIST(1, EVENING_TOMORROW.hour, EVENING_TOMORROW.minute),
      desc: EVENING_TOMORROW.desc
    }
  }
  if (evening) {
    return {
      when: inIST(0, EVENING.hour, EVENING.minute),
      desc: EVENING.desc
    }
  }
  if (morning) {
    const off = tomorrow ? 1 : 0
    return {
      when: inIST(off, MORNING.hour, MORNING.minute),
      desc: off === 1 ? MORNING.desc : { english: "this morning at 10:30 am", hindi: "आज सुबह 10:30 बजे", telugu: "ఈ ఉదయం 10:30 గంటలకు" }
    }
  }
  if (tomorrow) {
    return {
      when: inIST(1, VAGUE_LATER.hour, VAGUE_LATER.minute),
      desc: VAGUE_LATER.desc
    }
  }
  if (isNext) {
    return {
      when: inIST(7, 10, 30),
      desc: { english: "next week at 10:30 am", hindi: "अगले हफ्ते 10:30 बजे", telugu: "వచ్చే వారం ఉదయం 10:30 గంటలకు" },
    }
  }

  // 5. Vague "later/tarvata/baad me" default: tomorrow morning 10:30 AM
  return {
    when: inIST(1, VAGUE_LATER.hour, VAGUE_LATER.minute),
    desc: VAGUE_LATER.desc
  }
}

/** True when the caller is requesting FUTURE contact (not a plain goodbye). */
export function detectRescheduleIntent(speech: string): boolean {
  if (!speech) return false
  return INTENT_RE.test(speech)
}

/**
 * Build everything the call path needs: the parsed time, the note to store,
 * and the spoken confirmation per language.
 */
export function buildReschedule(
  speech: string,
  language: "english" | "hindi" | "telugu"
): RescheduleMatch | null {
  if (!detectRescheduleIntent(speech)) return null
  const parsed = parseRescheduleTime(speech)
  if (!parsed) return null
  const confirmations: Record<string, string> = {
    english: `Sure sir, I will call you ${parsed.desc.english}. Thank you so much!`,
    hindi: `ठीक है sir, मैं ${parsed.desc.hindi} आपको call कर लूँगी। धन्यवाद sir!`,
    telugu: `సరే sir, నేను ${parsed.desc.telugu} మీకు call చేస్తాను. ధన్యవాదాలు sir!`,
  }
  return {
    whenIso: parsed.when.toISOString(),
    desc: parsed.desc,
    note: `Auto-scheduled from call: "${speech.slice(0, 120)}" — ${parsed.desc.english}`,
    confirm: confirmations[language] || confirmations.english,
  }
}
