// Shared LAST-RESORT spoken lines for BOTH call transports (Exotel via
// voicebot-server.js, WhatsApp WebRTC via whatsapp-calls.js).
//
// These deliberately stay CODE CONSTANTS and are NOT part of the
// dashboard-editable channel scripts (ai_scripts): they exist to carry the
// call when the app / database / bridge is unreachable — the exact scenario
// where a DB read cannot save you. Reading them from the DB would break the
// one situation they were written for.
//
// They were previously duplicated across the two transports and could drift;
// they now live exactly here, once. The wording still matches the fixed-line
// rules: native script for Telugu/Hindi so the native TTS voice speaks them
// (the TTS picks the VOICE from the script), English loanwords in Latin
// letters on purpose.

const CLARIFY_PHRASE = {
  english: "Sorry, I didn't quite catch that — could you say that again?",
  // Native script, like every other fixed line the caller hears: the TTS
  // service picks the VOICE from the script, so Roman text here would be
  // spoken by the English voice while the model's replies come out of the
  // Telugu/Hindi one — two different women inside a single call.
  telugu: "Sorry అండి, నాకు సరిగా వినిపించలేదు. మళ్ళీ ఒకసారి చెప్పగలరా?",
  hindi: "Sorry, मुझे थोड़ा clear सुनाई नहीं दिया। क्या आप दोबारा बोल सकते हैं?",
}

// Said when the PIPELINE itself fails (STT service down, turn API unreachable,
// TTS error): the caller must never sit in unexplained silence. These are
// prewarmed into the TTS cache at boot (see prewarm), so they still play even
// when the TTS service went down AFTER startup — the single worst failure a
// live call can hit is silence with no recovery.
const FALLBACK_PHRASE = {
  english: "Sorry, one moment please — I'm checking on something.",
  telugu: "క్షమించండి, ఒక నిమిషం. నేను చెక్ చేస్తున్నాను.",
  hindi: "क्षमा कीजिए, एक पल रुकिए — मैं जाँच रही हूँ।",
}

// Said when the app itself is unreachable at call START (the app's own
// /api/calls/turn picks the proper greeting by lead language; this is only
// the can't-reach-the-app emergency line, in the caller's likely language).
const START_FALLBACK_PHRASE = {
  english: "Hello! This is Priya from Right Agent Group.",
  telugu: "నమస్కారం! నేను రైట్ ఏజెంట్ గ్రూప్ నుంచి మాట్లాడుతున్నాను.",
  hindi: "नमस्ते! मैं राइट एजेंट ग्रुप से बोल रही हूँ।",
}

module.exports = { CLARIFY_PHRASE, FALLBACK_PHRASE, START_FALLBACK_PHRASE }
