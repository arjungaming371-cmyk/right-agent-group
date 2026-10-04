// Detects an EXPLICIT request for the loan application / application form /
// application link in a customer chat message — the trigger for the
// auto-send in the WhatsApp chat path (app/api/whatsapp) and the Instagram
// DM path (app/api/instagram).
//
// Deliberately CONSERVATIVE: a false positive sends an unwanted message
// (noise, possible confusion), while a false negative just means Priya keeps
// answering in text and the customer can ask again. So:
//   - bare "form"/"application" mentions do NOT fire ("what documents for
//     a home loan?" must not auto-send anything)
//   - an intent verb (send/share/give/want/need/how-to-apply…) or an
//     explicit noun phrase ("loan application", "form link", "apply link")
//     is required
//   - questions about an EXISTING application ("application status",
//     "already submitted") are negative-guarded — the Lead Brain handles
//     those conversations and must never re-ask anyone to fill a form
//
// Language coverage follows the house channels: English, Hinglish (Hindi in
// Roman script) and Tenglish (Telugu in Roman script).

const INTENT = new RegExp(
  [
    // English
    "\\bsend\\b", "\\bsending\\b", "\\bshared?\\b", "\\bgive\\b", "\\bgot\\b",
    "\\bwant\\b", "\\bneed\\b", "\\bget\\b", "\\bplease\\b", "\\bkindly\\b",
    "\\bhow (do|can|to)\\b", "\\bwhere (do|can|to)\\b", "\\bcan (i|u|you)\\b",
    // Hinglish (Roman Hindi)
    "\\bbhej\\b", "\\bbhejo\\b", "\\bbhejna\\b", "\\bbhejiye\\b", "\\bbhej do\\b", "\\bbhejdo\\b",
    "\\bchahiye\\b", "\\bchahiya\\b", "\\bdo\\b", "\\bdijiye\\b", "\\bdede\\b", "\\bdena\\b",
    "\\bkaise\\b", "\\bkese\\b", "\\bkarna hai\\b", "\\bkarni hai\\b", "\\bmil sakta\\b", "\\bmilega\\b",
    // Tenglish (Roman Telugu)
    "\\bpampu\\b", "\\bpampandi\\b", "\\bpamputara\\b", "\\bpampinchu\\b", "\\bpampinchandi\\b",
    "\\bkavali\\b", "\\bkavala\\b", "\\bela\\b", "\\bcheppu\\b", "\\bivvandi\\b", "\\bistara\\b",
  ].join("|"),
  "i"
)

// The subject must be the APPLICATION/FORM itself — a bare "link" is too
// ambiguous (location link, maps link, payment link…).
const SUBJECT = new RegExp(
  [
    "\\bapplication\\b", "\\bapplicaion\\b", "\\baplication\\b", // common misspellings
    "\\bform\\b", "\\bforms\\b",
    "\\bapply\\b", "\\baply\\b",
    "\\bregister\\b", "\\bregistration\\b",
  ].join("|"),
  "i"
)

// Strong noun phrases that alone are an explicit request even without a
// caught intent verb.
const STRONG = /\b(loan application|application form|form link|apply link|application link|registration link|google form|apply now|how to apply)\b/i

// Questions/conversations about an EXISTING application — never auto-send.
const NEGATIVE = /\b(status|update|approved?|approval|rejected?|submitted|already (filled|sent|applied|got|submitted)|kab aayega|kab hua|em aindi|vachinda|refund|cancel)\b/i

export function detectApplicationRequest(text: string): boolean {
  const t = String(text || "")
  if (!t) return false
  if (NEGATIVE.test(t)) return false
  if (STRONG.test(t)) return true
  return INTENT.test(t) && SUBJECT.test(t)
}
