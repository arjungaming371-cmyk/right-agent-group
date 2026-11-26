// Voice Intent & Semantic Understanding Engine (Phase 5 & 6)
// Provides fast, deterministic, multilingual categorization for live voice calling
// Distinguishes backchannels, product corrections, objections, hold requests,
// repeats, soft vs firm refusals, and inquiries without adding per-turn LLM latency.

export type VoiceIntentType =
  | "dnd_optout"
  | "negative_disconnect"
  | "explicit_disconnect"
  | "reschedule_request"
  | "caller_will_call"
  | "backchannel_listening"
  | "repeat_request"
  | "wait_hold_request"
  | "product_correction"
  | "objection"
  | "continuation_question"
  | "general_inquiry"
  | "unspecified"

export type ObjectionType =
  | "high_interest_rate"
  | "processing_fee"
  | "existing_loan"
  | "documentation_difficulty"
  | "trust_identity"
  | "timing_busy"
  | "family_consultation"
  | "general_reluctance"

export interface VoiceSemanticAnalysis {
  intent: VoiceIntentType
  objectionType?: ObjectionType
  productCorrection?: {
    original?: string
    corrected: string
  }
  confidence: number
  isInterruptionWorthy: boolean // Should this cut off Priya or is it just a passive backchannel?
  rawSpeech: string
}

// 1. Passive backchannels / acknowledgments while Priya is speaking
// These indicate the caller is listening ("uh-huh", "haan", "hmm", "avunu"), NOT interrupting!
const BACKCHANNEL_RE = new RegExp(
  '^(?:' +
  'hmm|hm|hmmm|haan|ha|haa|haah|aah|oh|ok|okay|k|ya|yeah|yes|yep|sure|sare|avunu|avunandi|' +
  'theek hai|sahi hai|accha|achha|understood|cheppandi|vinabadutondi|vinipistondi|' +
  'హమ్|అవును|సరే|చెప్పండి|వింటున్నాను|హా|हां|अच्छा|ठीक है|हूँ' +
  ')[.!? ]*$',
  'i'
)

// 2. Request to repeat / didn't hear
const REPEAT_REQUEST_RE = new RegExp(
  '(?:\\b(?:' +
  'malli\\s+(?:cheppandi|cheppara|cheppu|matladandi)|once\\s+again|repeat\\s+(?:cheyandi|please|that|kariye)?|' +
  'phir\\s+se\\s+(?:bolo|boliye|kaho|batao)|can\\s+you\\s+repeat|pardon|sorry\\s+what|didn\'t\\s+hear|' +
  'vinapadaledu|vinipinchaledu|clear\\s+ga\\s+ledu|voice\\s+break\\s+avtundi' +
  ')\\b|' +
  'మళ్ళీ చెప్పండి|వాయిస్ బ్రేక్ అవుతుంది|వినిపించలేదు|మళ్లీ చెప్పండి|' +
  'फिर से बोलिए|आवाज़ नहीं आ रही|दोबारा कहिए|सुनाई नहीं दिया' +
  ')',
  'i'
)

// 3. Request to wait / hold on
const WAIT_HOLD_REQUEST_RE = new RegExp(
  '(?:\\b(?:' +
  'wait|aagandi|oka\\s+(?:second|nimisham|minute)|one\\s+(?:second|minute|sec|min)|' +
  'hold\\s+(?:on|on a second)?|just\\s+a\\s+(?:sec|second|minute)|ek\\s+(?:minute|second)|' +
  'ruko|rukiye|thoda\\s+wait\\s+karo|line\\s+pe\\s+raho' +
  ')\\b|' +
  'ఆగండి|ఒక్క నిమిషం|ఒక్క సెకండ్|లైన్ లో ఉండండి|' +
  'रुकिए|एक मिनट|थोड़ा रुकिए|लाइन पर रहिए' +
  ')',
  'i'
)

// 4. Product correction (Caller correcting the loan type)
// e.g. "No, I need home loan, not personal", "personal vaddu, gold loan", "business loan kaadu, car loan"
const PRODUCT_CORRECTION_PATTERNS: Array<{ regex: RegExp; corrected: string }> = [
  { regex: /\b(?:not|no|vaddu|vaddandi|nahi|kaadu)\s+.*?\b(?:home|housing|house|gruha)\b|\b(?:home|housing|house|gruha)\s+(?:loan|kavali|chustunna|chustunnam|matladali)\b/i, corrected: "home_loan" },
  { regex: /\b(?:not|no|vaddu|vaddandi|nahi|kaadu)\s+.*?\b(?:personal|salary)\b|\b(?:personal|salaried)\s+(?:loan|kavali|chustunna)\b/i, corrected: "personal_loan" },
  { regex: /\b(?:not|no|vaddu|vaddandi|nahi|kaadu)\s+.*?\b(?:business|vyaparam|vyapar)\b|\b(?:business|msme|commercial)\s+(?:loan|kavali)\b/i, corrected: "business_loan" },
  { regex: /\b(?:not|no|vaddu|vaddandi|nahi|kaadu)\s+.*?\b(?:gold|bangaram|sona)\b|\b(?:gold|bangaram|sona)\s+(?:loan|kavali)\b/i, corrected: "gold_loan" },
  { regex: /\b(?:not|no|vaddu|vaddandi|nahi|kaadu)\s+.*?\b(?:lap|property|mortgage)\b|\b(?:property|mortgage|lap)\s+(?:loan|kavali)\b/i, corrected: "lap" },
  { regex: /\b(?:not|no|vaddu|vaddandi|nahi|kaadu)\s+.*?\b(?:education|chaduvu|studies)\b|\b(?:education|student|study)\s+(?:loan|kavali)\b/i, corrected: "education_loan" },
  { regex: /\b(?:not|no|vaddu|vaddandi|nahi|kaadu)\s+.*?\b(?:car|vehicle|bike|vahanam)\b|\b(?:car|vehicle|auto|vahanam)\s+(?:loan|kavali)\b/i, corrected: "vehicle_loan" },
]

// 5. Categorized Objections
const OBJECTION_DETECTORS: Array<{ type: ObjectionType; regex: RegExp }> = [
  {
    type: "high_interest_rate",
    regex: /\b(?:interest|rate|vaddi|byaj)\s*(?:chaala|too|bhot|bahut|high|ekkuva|jyada|zyada|heavy)\b|\b(?:too\s+high\s+interest|interest\s+is\s+too\s+much)\b|వడ్డీ ఎక్కువ|బడ్డీ ఎక్కువ|బ्याज ज्यादा|रेट ज्यादा/i
  },
  {
    type: "processing_fee",
    regex: /\b(?:processing\s*fees?|charges?|charges\s+vaddu|extra\s+charges|fees\s+too\s+high|charges\s+ekkuva)\b|फीस ज्यादा|ఛార్జీలు ఎక్కువ/i
  },
  {
    type: "existing_loan",
    regex: /\b(?:already|ippatike|pahle\s+se)\s+.*?\b(?:loans?|emi|running|unnayi|chal\s+raha)\b|\b(?:already\s+have\s+loans?|running\s+emis?)\b|ఇప్పటికే లోన్ ఉంది|पहले से लोन है/i
  },
  {
    type: "documentation_difficulty",
    regex: /\b(?:no\s+documents?|documents?\s+levu|slips?\s+levu|itr\s+ledu|salary\s+slip\s+nahi|papers\s+nahi)\b|డాక్యుమెంట్స్ లేవు|పేపర్స్ లేవు|डॉक्यूमेंट्स नहीं हैं|कागजात नहीं हैं/i
  },
  {
    type: "trust_identity",
    regex: /\b(?:fraud|fake|scam|who\s+are\s+you|genuine\s+aa|trust|meeru\s+evaru|company\s+evaru)\b|నిజమా|ఫ్రాడ్|మీరు ఎవరు|आप कौन हैं|फ्रॉड तो नहीं|कंपनी का नाम/i
  },
  {
    type: "timing_busy",
    regex: /\b(?:busy|in\s+a\s+meeting|driving|hospital|office|basti|kaam\s+me|panilo\s+unnanu|urgent\s+work)\b|డ్రైవింగ్|బిజీగా ఉన్నాను|काम में हूँ|व्यस्त हूँ/i
  },
  {
    type: "family_consultation",
    regex: /\b(?:ask|consult|matladi|chepali|wife|husband|father|parents|family|intlo|matladali)\b|కనుక్కొని|అడిగి చెప్తాను|घर में पूछकर|बात करके/i
  },
  {
    type: "general_reluctance",
    regex: /\b(?:not\s+interested|vaddu|vaddandi|nahi\s+chahiye|avsaram\s+ledu|don't\s+need)\b|వద్దు|అవసరం లేదు|नहीं चाहिए|रुचि नहीं है/i
  }
]

/**
 * Perform fast, structured semantic analysis of speech on the live voice turn.
 * Zero external API calls, executes in < 1 ms.
 */
export function analyzeVoiceSpeech(speech: string): VoiceSemanticAnalysis {
  const trimmed = (speech || "").trim()

  // 1. Check for passive backchannels (Caller is just acknowledging, do NOT interrupt Priya!)
  if (BACKCHANNEL_RE.test(trimmed)) {
    return {
      intent: "backchannel_listening",
      confidence: 0.98,
      isInterruptionWorthy: false,
      rawSpeech: trimmed,
    }
  }

  // 2. Check for repeat request
  if (REPEAT_REQUEST_RE.test(trimmed)) {
    return {
      intent: "repeat_request",
      confidence: 0.95,
      isInterruptionWorthy: true,
      rawSpeech: trimmed,
    }
  }

  // 3. Check for wait/hold request
  if (WAIT_HOLD_REQUEST_RE.test(trimmed)) {
    return {
      intent: "wait_hold_request",
      confidence: 0.95,
      isInterruptionWorthy: true,
      rawSpeech: trimmed,
    }
  }

  // 4. Check for product correction
  for (const item of PRODUCT_CORRECTION_PATTERNS) {
    if (item.regex.test(trimmed) && (/\b(?:no|not|vaddu|nahi|kaadu|chustunna|kavali)\b/i.test(trimmed) || /వద్దు|కాదు|కావాలి|नहीं/.test(trimmed))) {
      return {
        intent: "product_correction",
        productCorrection: { corrected: item.corrected },
        confidence: 0.92,
        isInterruptionWorthy: true,
        rawSpeech: trimmed,
      }
    }
  }

  // 5. Check for objection detection
  for (const obj of OBJECTION_DETECTORS) {
    if (obj.regex.test(trimmed)) {
      return {
        intent: "objection",
        objectionType: obj.type,
        confidence: 0.90,
        isInterruptionWorthy: true,
        rawSpeech: trimmed,
      }
    }
  }

  // Fallback: general speech that is interruption-worthy if long enough
  return {
    intent: trimmed.length >= 10 ? "general_inquiry" : "unspecified",
    confidence: 0.70,
    isInterruptionWorthy: trimmed.length >= 8,
    rawSpeech: trimmed,
  }
}
