// priya-lines.js — THE single copy of the fixed last-resort lines.
//
// 2026-09-26 omnichannel pass: voicebot-server.js (Exotel path) and
// whatsapp-calls.js (WhatsApp WebRTC path) each carried byte-identical
// copies of these three line sets, and they had already drifted once in
// tone. One module now owns them; both consumers require() it.
//
// WHAT THESE ARE NOT: the DB-editable script surfaces. The dashboard's
// Script Manager (ai_scripts 'voice_openers'/'voice_closings' via
// lib/script-lines.ts) owns every line Priya speaks on a healthy call —
// those flow through the turn API (/api/calls/turn). The constants here are
// ONLY spoken when the pipeline itself is degraded:
//
//   CLARIFY_PHRASE        STT flagged its own transcript unreliable → ask to
//                         repeat instead of answering noise.
//   FALLBACK_PHRASE       STT/turn/TTS pipeline error mid-call → never leave
//                         the caller in unexplained silence.
//   START_FALLBACK_PHRASE the app is unreachable at call START (the app's
//                         own /api/calls/turn picks the proper greeting by
//                         lead language; this is the can't-reach-the-app
//                         emergency line).
//
// That is exactly why these stay CODE constants here and NOT DB reads: the
// scenario in which they are needed is precisely the scenario where the DB
// (or this app) is down. Making them DB-driven would trade the last line of
// defense for an edit box. They are prewarmed into the TTS cache at boot so
// they still play even if TTS dies after startup.
//
// Script rules are the same as every other spoken line: native
// Telugu/Devanagari with English loanwords in Latin letters, so the TTS
// voice stays consistent with the model's own replies.

module.exports = {
  CLARIFY_PHRASE: {
    english: "Sorry, I didn't quite catch that — could you say that again?",
    telugu: "Sorry అండి, నాకు సరిగా వినిపించలేదు. మళ్ళీ ఒకసారి చెప్పగలరా?",
    hindi: "Sorry, मुझे थोड़ा clear सुनाई नहीं दिया। क्या आप दोबारा बोल सकते हैं?",
  },

  FALLBACK_PHRASE: {
    english: "Sorry, one moment please — I'm checking on something.",
    telugu: "క్షమించండి, ఒక నిమిషం. నేను చెక్ చేస్తున్నాను.",
    hindi: "क्षमा कीजिए, एक पल रुकिए — मैं जाँच रही हूँ।",
  },

  START_FALLBACK_PHRASE: {
    english: "Hello! This is Priya from Right Agent Group.",
    telugu: "నమస్కారం! నేను రైట్ ఏజెంట్ గ్రూప్ నుంచి మాట్లాడుతున్నాను.",
    hindi: "नमस्ते! मैं राइट एजेंट ग्रुप से बोल रही हूँ।",
  },
}
