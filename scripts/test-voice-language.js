#!/usr/bin/env node
/**
 * Regression tests for the 2026-09-26 voice-language fixes:
 *   1. replyTokenBudget — the daff323 edit flattened ALL calls to 150 tokens,
 *      amputating native-script (Telugu/Devanagari) replies mid-word; TTS then
 *      spoke the fragment. Budget must be script-aware again (150 Roman / 400
 *      native on calls, 450 on WhatsApp).
 *   2. detectLanguage — the expanded Telugu/Hindi romanized keyword sets must
 *      keep routing the common spoken phrases to the right language.
 *   3. safeRecordingPath — RECORDING_NAME_RE must accept the same widened
 *      callSid charset (`+ = : @`) as the upload route's CALL_SID_RE, so an
 *      uploaded recording never 404s in the dashboard player, while still
 *      rejecting slashes / traversal.
 *
 * Run: node scripts/test-voice-language.js
 */
"use strict"
const { execSync } = require("child_process")
const path = require("path")

const ROOT = path.join(__dirname, "..")
// lib/llm.ts + lib/recordings.ts compile through a tiny tsconfig that extends
// the root one (it carries the "@/lib/*" paths mapping).
execSync("npx tsc -p scripts/tsconfig.voicelang.json", { cwd: ROOT, stdio: "pipe" })
const buildDir = path.join(__dirname, ".voicelang-build")
// tsc resolves "@/lib/*" via tsconfig paths at compile time but does NOT
// rewrite the emitted require() calls — hook the resolver so dynamically
// imported db.js/branches.js can load at runtime.
const Module = require("module")
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) {
    request = path.join(buildDir, request.replace(/^@\//, ""))
  }
  return origResolve.call(this, request, ...args)
}
const llm = require("./.voicelang-build/lib/llm.js")
const recordings = require("./.voicelang-build/lib/recordings.js")

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name) } }

console.log("── replyTokenBudget (script-aware call ceiling) ──")
ok("english call → 150 (Roman stays tight)", llm.replyTokenBudget("english", "call") === 150)
ok("telugu call → 400 (native script needs headroom)", llm.replyTokenBudget("telugu", "call") === 400)
ok("hindi call → 400 (native script needs headroom)", llm.replyTokenBudget("hindi", "call") === 400)
ok("english whatsapp → 450", llm.replyTokenBudget("english", "whatsapp") === 450)
ok("telugu whatsapp → 450", llm.replyTokenBudget("telugu", "whatsapp") === 450)
ok("hindi whatsapp → 450", llm.replyTokenBudget("hindi", "whatsapp") === 450)

console.log("── detectLanguage (romanized keyword routing) ──")
ok("plain english stays english", llm.detectLanguage("I need a home loan please") === "english")
ok("clear telugu request → telugu", llm.detectLanguage("loan kavali sir") === "telugu")
ok("naku + kavali → telugu", llm.detectLanguage("naku home loan kavali") === "telugu")
ok("cheppandi → telugu (new keyword)", llm.detectLanguage("details cheppandi sir") === "telugu")
ok("telugu script → telugu", llm.detectLanguage("నాకు loan కావాలి") === "telugu")
ok("mujhe + chahiye → hindi", llm.detectLanguage("mujhe loan chahiye") === "hindi")
ok("theek hai → hindi (new keyword)", llm.detectLanguage("theek hai sir") === "hindi")
ok("devanagari → hindi", llm.detectLanguage("नमस्ते, मुझे जानकारी चाहिए") === "hindi")
ok("no keyword → english fallback", llm.detectLanguage("What is the EMI for 20 lakhs?") === "english")
ok("empty string → english", llm.detectLanguage("") === "english")

console.log("── safeRecordingPath (upload/serve allowlist sync) ──")
const dir = recordings.recordingsDir()
function inside(p) { return !!p && p.startsWith(path.resolve(dir) + path.sep) }
ok("plain name resolves inside dir", inside(recordings.safeRecordingPath("wacall-abc123.mp3")))
ok("base64 padding '=' in callSid accepted (was 404-before-fix)", inside(recordings.safeRecordingPath("wacall-abc=.mp3")))
ok("full widened charset + = : @ accepted", inside(recordings.safeRecordingPath("wacall-a+b=c:d@e_.mp3")))
ok(".wav extension accepted with widened charset", inside(recordings.safeRecordingPath("wacall-x=y.wav")))
ok("200-char callSid at the limit accepted", inside(recordings.safeRecordingPath("wacall-" + "a".repeat(200) + ".mp3")))
ok("201-char callSid over the limit rejected", recordings.safeRecordingPath("wacall-" + "a".repeat(201) + ".mp3") === null)
ok("slash in name rejected (traversal)", recordings.safeRecordingPath("wacall-../evil.mp3") === null)
ok("backslash in name rejected", recordings.safeRecordingPath("wacall-a\\b.mp3") === null)
ok("wrong extension rejected", recordings.safeRecordingPath("wacall-abc.txt") === null)
ok("missing wacall- prefix rejected", recordings.safeRecordingPath("call-abc.mp3") === null)
ok("non-string input rejected", recordings.safeRecordingPath(null) === null)

console.log("── default script GOAL (WhatsApp-call number question ban) ──")
// The base script's step 3 used to command "Is your WhatsApp number the same
// as this call, or different?" unconditionally — Priya asked it on EVERY
// WhatsApp call, where the call itself IS on the customer's WhatsApp. The
// fixed script bans it on WhatsApp calls and keeps it phone-only.
// default-scripts.ts is a direct dependency of llm.ts and lands in the same
// build output — require it directly for the script-wording assertions.
const defaultScripts = require("./.voicelang-build/lib/default-scripts.js")
const baseScript = defaultScripts.DEFAULT_SCRIPTS.english || ""
ok("script bans the number question on WhatsApp calls", baseScript.includes("on a WHATSAPP call NEVER ask"))
ok("script keeps the question phone-only", baseScript.includes("Only on a PHONE call ask once"))
ok("script names the wrong-question phrasing explicitly", baseScript.includes('"is this your WhatsApp number" or "same or different"'))

console.log("── default script GOAL step 2 (no re-ask contradiction) ──")
// TRAINING FIX (2026-09-26): step 2 used to say "never assume or skip it even
// if they already gave other details" — read literally, that commanded asking
// for the AREA even after the customer had already given it, fighting the
// script's own REAL MEMORY rule. One of the root causes of repeated
// questions. The fixed wording keeps "ask explicitly, never guess" while
// making already-given areas DONE.
ok("step 2 no longer commands asking for known details", !baseScript.includes("even if they already gave other details"))
ok("step 2 still forbids guessing the area", baseScript.includes("never GUESS it from other details"))
ok("step 2 marks already-given areas DONE", baseScript.includes("that step is DONE"))

console.log("── default script SPEAK TO A HUMAN (operator contract) ──")
ok("operator rule covers agent/operator roles", baseScript.includes("an agent, an operator"))
ok("operator rule forbids asking anything new", baseScript.includes("ask NOTHING new in that reply"))
ok("operator rule works on both channels", baseScript.includes("phone calls and on WhatsApp chats"))

console.log("── CALL/WHATSAPP brevity anti-repeat training (lib/llm.ts source lock) ──")
// WHATSAPP_BREVITY is private to llm.ts; a source-text lock is the honest
// regression check (deleting the line fails this test).
const llmSource = require("fs").readFileSync(path.join(ROOT, "lib", "llm.ts"), "utf8")
ok("calls keep the KNOW WHAT YOU ARE SPEAKING block", llmSource.includes("KNOW WHAT YOU ARE SPEAKING (CRITICAL"))
ok("WhatsApp brevity now carries the anti-repeat rule", llmSource.includes("KNOW WHAT YOU ARE SPEAKING: scan the conversation"))

console.log("── operator / human-request detection (lib/frustration.ts) ──")
const frustration = require("./.voicelang-build/lib/frustration.js")
// mode=translit STT makes ALL caller speech Roman — these were invisible
// before the 2026-09-26 widening.
ok("romanized Telugu: manager tho matladali", frustration.detectHumanRequest("naaku manager tho matladali sir") === true)
ok("romanized Telugu: officer tho", frustration.detectHumanRequest("officer tho matladandi please") === true)
ok("romanized Telugu: connect cheyandi", frustration.detectHumanRequest("manager ni connect cheyandi") === true)
ok("romanized Telugu: customer care ki", frustration.detectHumanRequest("naku customer care ki call cheyandi") === true)
ok("romanized Hindi: manager se baat", frustration.detectHumanRequest("mujhe manager se baat karni hai") === true)
ok("romanized Hindi: insaan se baat", frustration.detectHumanRequest("kisi insaan se baat karao") === true)
ok("romanized Hindi: baat karwao", frustration.detectHumanRequest("officer se baat karwao") === true)
ok("English: talk to an agent", frustration.detectHumanRequest("Can I talk to an agent?") === true)
ok("English: speak to a real person", frustration.detectHumanRequest("I want to speak to a real person") === true)
ok("English: supervisor", frustration.detectHumanRequest("let me speak to your supervisor") === true)
ok("English: escalate", frustration.detectHumanRequest("please escalate my case") === true)
ok("native Telugu script still detected", frustration.detectHumanRequest("మేనేజర్ తో మాట్లాడాలి") === true)
ok("native Hindi script still detected", frustration.detectHumanRequest("मैनेजर से बात कराओ") === true)
// False-positive guards: ordinary mentions must NOT flag.
ok("no flag: story mentioning own manager", frustration.detectHumanRequest("my manager asked me to submit documents") === false)
ok("no flag: 'manager nicely' (\\b guard)", frustration.detectHumanRequest("the manager nicely explained everything") === false)
ok("no flag: 'customer care service' mention", frustration.detectHumanRequest("your customer care service is good") === false)
ok("no flag: normal loan talk", frustration.detectHumanRequest("I need a home loan for 40 lakhs") === false)

console.log("── operator reply contracts (exported, wording locked) ──")
ok("OPERATOR_REPLY_INSTRUCTION exported", typeof frustration.OPERATOR_REPLY_INSTRUCTION === "string" && frustration.OPERATOR_REPLY_INSTRUCTION.length > 100)
ok("call contract forbids pitching/asking", frustration.OPERATOR_REPLY_INSTRUCTION.includes("Do NOT keep pitching") && frustration.OPERATOR_REPLY_INSTRUCTION.includes("do NOT ask any new question"))
ok("OPERATOR_CHAT_INSTRUCTION exported (WhatsApp wording)", typeof frustration.OPERATOR_CHAT_INSTRUCTION === "string" && frustration.OPERATOR_CHAT_INSTRUCTION.includes("same WhatsApp chat"))
ok("flagHumanRequestedWhatsApp exported", typeof frustration.flagHumanRequestedWhatsApp === "function")

console.log("── voice-providers: TTS locale safety net + text hygiene ──")
const vp = require(path.join(ROOT, "server", "voice-providers.js"))
// A Roman-Tenglish sentence matching NONE of the old ~20-word list, with the
// declared language stale after a mid-call switch — the widened keyword net
// is what keeps it out of the English voice.
const VP_LOCALES = { english: "en-IN", hindi: "hi-IN", telugu: "te-IN" }
ok("Tenglish sentence → Telugu voice even when declared english", vp.resolveTtsLocale("Sir meeru documents ready cheyandi, maa officer malli call chestaru", "english", VP_LOCALES) === "te-IN")
ok("Hinglish sentence → Hindi voice even when declared telugu", vp.resolveTtsLocale("theek hai sir, main bata deta hoon", "telugu", VP_LOCALES) === "hi-IN")
ok("plain English reply stays on the English voice", vp.resolveTtsLocale("I can help you with a home loan, sir", "english", VP_LOCALES) === "en-IN")
ok("native Telugu script wins immediately", vp.resolveTtsLocale("మీరు documents ready చేయండి", "english", VP_LOCALES) === "te-IN")
ok("English sentence never hijacked by dropped short words", vp.resolveTtsLocale("Send me the ID and I will check", "english", VP_LOCALES) === "en-IN")

ok("normalizeForTts: % → percent", vp.normalizeForTts("Rates start at 7.25% sir").includes("7.25 percent"))
ok("normalizeForTts: ₹ → rupees", vp.normalizeForTts("EMI ₹15,000 avuthundi").includes("rupees"))
ok("normalizeForTts: & → and", vp.normalizeForTts("ID & address proof").includes("ID and address"))
ok("normalizeForTts: markdown ** stripped", vp.normalizeForTts("**Home Loan** best rate") === "Home Loan best rate")
ok("normalizeForTts: 20L → 20 lakh", vp.normalizeForTts("20L loan kavali").includes("20 lakh"))
ok("normalizeForTts: 10k → 10 thousand", vp.normalizeForTts("EMI 10k avuthundi").includes("10 thousand"))
ok("normalizeForTts: emoji stripped", vp.normalizeForTts("Sure sir 👍 will send") === "Sure sir will send")
ok("normalizeForTts: clean sentence untouched", vp.normalizeForTts("Thank you sir, have a great day") === "Thank you sir, have a great day")
ok("normalizeForTts: empty passthrough", vp.normalizeForTts("") === "")

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
