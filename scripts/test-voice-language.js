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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
