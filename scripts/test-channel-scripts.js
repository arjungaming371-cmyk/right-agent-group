#!/usr/bin/env node
/**
 * Regression tests for the editable channel scripts (lib/channel-scripts.ts).
 *
 * Every fixed line Priya says/sends OUTSIDE the main conversation script is
 * now dashboard-editable via ai_scripts rows:
 *   instagram_dm / instagram_comment / voice_openers / voice_closings /
 *   whatsapp_fallbacks
 * lib/channel-scripts.ts loads them with a 5-minute stale-while-revalidate
 * cache and merges each row per-field over code defaults, so a missing,
 * partial, or CORRUPT row can never break the call stack.
 *
 * Covered here:
 *   • renderTemplate — {token} substitution, unknown tokens untouched
 *   • per-language / per-family merge (partial rows keep defaults elsewhere)
 *   • corrupt JSON / wrong types → clean fallback to defaults
 *   • mergeChannelRows end-to-end over raw ai_scripts-shaped rows
 *   • snapshot getters + test hooks (override → read → reset)
 *   • refreshChannelScriptsIfStale never throws even with no database
 *   • server/fallback-speech.js — one shared source, three languages each,
 *     and NO duplicated copies left in voicebot-server.js / whatsapp-calls.js
 *   • source drift-locks: call/chat/instagram paths consume the snapshot
 *
 * Run: node scripts/test-channel-scripts.js
 */
"use strict"
const fs = require("fs")
const path = require("path")
const Module = require("module")
const { execSync } = require("child_process")

const ROOT = path.join(__dirname, "..")
const BUILD = path.join(__dirname, ".channel-build")

// lib/channel-scripts.ts imports ./db which imports "@/lib/logger" — the
// emitted JS keeps the literal "@/..." specifier, so resolve it to the
// compiled build output.
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) {
    request = path.join(BUILD, request.replace(/^@\//, "") + ".js")
  }
  return origResolve.call(this, request, ...args)
}

execSync("npx tsc -p scripts/tsconfig.channel.json", { cwd: ROOT, stdio: "pipe" })

const cs = require(path.join(BUILD, "lib/channel-scripts.js"))
const fallbackSpeech = require(path.join(ROOT, "server/fallback-speech.js"))

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name) } }
function eq(name, actual, expected) {
  const a = typeof actual === "string" ? actual : JSON.stringify(actual)
  const e = typeof expected === "string" ? expected : JSON.stringify(expected)
  if (a === e) { pass++; console.log("  ✓", name) } else { fail++; console.log(`  ✗ ${name}\n      got:  ${a}\n      want: ${e}`) }
}

const LANGS = ["english", "hindi", "telugu"]

// Let the module-boot refresh settle (no DB here — it must fail silently).
;(async () => {
  await new Promise((r) => setTimeout(r, 200))

  console.log("\n— renderTemplate —")
  eq("replaces all placeholders",
     cs.renderTemplate("Hi {name} from {brand}: {link}", { name: "Ravi", brand: "RAG", link: "http://x/1" }),
     "Hi Ravi from RAG: http://x/1")
  eq("unknown token left untouched",
     cs.renderTemplate("Hi {name} {unknown}", { name: "A" }),
     "Hi A {unknown}")
  eq("repeated placeholder replaced everywhere",
     cs.renderTemplate("{name}? {name}!", { name: "Sir" }),
     "Sir? Sir!")
  eq("no vars → template byte-identical",
     cs.renderTemplate("Hi {name}!", {}),
     "Hi {name}!")
  eq("empty template fine", cs.renderTemplate("", { name: "x" }), "")
  eq("hasOwnProperty trap safe",
     cs.renderTemplate("{constructor}", {}),
     "{constructor}")

  console.log("\n— parseLangRecord (per-language merge) —")
  const def = { english: "EN", hindi: "HI", telugu: "TE" }
  eq("full override", cs.parseLangRecord({ english: "en2", hindi: "hi2", telugu: "te2" }, def),
     { english: "en2", hindi: "hi2", telugu: "te2" })
  eq("partial (telugu only) keeps defaults", cs.parseLangRecord({ telugu: "te2" }, def),
     { english: "EN", hindi: "HI", telugu: "te2" })
  eq("empty string falls back", cs.parseLangRecord({ english: "  " }, def), def)
  eq("non-string falls back", cs.parseLangRecord({ hindi: 42 }, def), def)
  eq("non-object → all defaults", cs.parseLangRecord("junk", def), def)
  eq("null → all defaults", cs.parseLangRecord(null, def), def)
  eq("unknown language key ignored", cs.parseLangRecord({ spanish: "es" }, def), def)

  console.log("\n— parseVoiceOpeners / parseVoiceClosings —")
  const o = cs.parseVoiceOpeners(
    { cold: { telugu: "TE-COLD" }, whatsappCallbackWithName: { english: "CB {name}" } },
    cs.DEFAULT_VOICE_OPENERS
  )
  eq("partial family: cold.telugu overridden", o.cold.telugu, "TE-COLD")
  eq("partial family: cold.english default kept", o.cold.english, cs.DEFAULT_VOICE_OPENERS.cold.english)
  eq("untouched family byte-identical", o.returning, cs.DEFAULT_VOICE_OPENERS.returning)
  eq("WithName family override", o.whatsappCallbackWithName.english, "CB {name}")
  ok("all 8 families present", ["cold","coldWithName","returning","returningWithName","inbound","inboundWithName","whatsappCallback","whatsappCallbackWithName"].every(k => o[k] && LANGS.every(l => typeof o[k][l] === "string" && o[k][l])))
  eq("openers non-object → all defaults", cs.parseVoiceOpeners(7, cs.DEFAULT_VOICE_OPENERS), cs.DEFAULT_VOICE_OPENERS)

  const c = cs.parseVoiceClosings({ qualified: { hindi: "HQ-HI" }, junk: { english: "x" } }, cs.DEFAULT_VOICE_CLOSINGS)
  eq("closings partial family override", c.qualified.hindi, "HQ-HI")
  eq("closings unknown family ignored", c.goodbye, cs.DEFAULT_VOICE_CLOSINGS.goodbye)
  eq("closings retry default kept", c.retry.english, cs.DEFAULT_VOICE_CLOSINGS.retry.english)

  console.log("\n— parseWhatsAppFallbacks / parseInstagramComment —")
  const w = cs.parseWhatsAppFallbacks({ formLink: "custom {link}" }, cs.DEFAULT_WHATSAPP_FALLBACKS)
  eq("fallback string override", w.formLink, "custom {link}")
  eq("fallback untouched default", w.callFollowup, cs.DEFAULT_WHATSAPP_FALLBACKS.callFollowup)
  eq("fallbacks non-object → defaults", cs.parseWhatsAppFallbacks("x", cs.DEFAULT_WHATSAPP_FALLBACKS), cs.DEFAULT_WHATSAPP_FALLBACKS)
  const ig = cs.parseInstagramComment({ publicReply: "reply {username}" }, cs.DEFAULT_INSTAGRAM_COMMENT)
  eq("ig publicReply override", ig.publicReply, "reply {username}")
  eq("ig privateDm default kept", ig.privateDm, cs.DEFAULT_INSTAGRAM_COMMENT.privateDm)

  console.log("\n— mergeChannelRows over raw ai_scripts rows —")
  const allDefaults = cs.mergeChannelRows([])
  eq("no rows → default openers", allDefaults.voiceOpeners, cs.DEFAULT_VOICE_OPENERS)
  eq("no rows → default DM prompt", allDefaults.instagramDm, cs.DEFAULT_INSTAGRAM_DM)

  const snap = cs.mergeChannelRows([
    { language: "instagram_dm", content: "DM PROMPT {brief}" },
    { language: "voice_openers", content: JSON.stringify({ cold: { english: "OVERRIDE" } }) },
    { language: "whatsapp_fallbacks", content: JSON.stringify({ missedCall: "MISS {name}" }) },
    { language: "base", content: "should be ignored (not a channel key)" },
  ])
  eq("instagram_dm text applied", snap.instagramDm, "DM PROMPT {brief}")
  eq("voice_openers JSON applied", snap.voiceOpeners.cold.english, "OVERRIDE")
  eq("voice_openers other language default", snap.voiceOpeners.cold.hindi, cs.DEFAULT_VOICE_OPENERS.cold.hindi)
  eq("whatsapp_fallbacks applied", snap.whatsappFallbacks.missedCall, "MISS {name}")
  eq("non-channel row ignored", snap.voiceClosings, cs.DEFAULT_VOICE_CLOSINGS)

  const corrupt = cs.mergeChannelRows([
    { language: "voice_openers", content: "{not json" },
    { language: "voice_closings", content: "[1,2,3]" },
    { language: "whatsapp_fallbacks", content: "\"just a string\"" },
    { language: "instagram_comment", content: null },
  ])
  eq("corrupt JSON openers → defaults", corrupt.voiceOpeners, cs.DEFAULT_VOICE_OPENERS)
  eq("JSON array closings → defaults", corrupt.voiceClosings, cs.DEFAULT_VOICE_CLOSINGS)
  eq("JSON string fallbacks → defaults", corrupt.whatsappFallbacks, cs.DEFAULT_WHATSAPP_FALLBACKS)
  eq("null comment → defaults", corrupt.instagramComment, cs.DEFAULT_INSTAGRAM_COMMENT)

  console.log("\n— snapshot getters + test hooks —")
  cs.__resetChannelScriptsForTests()
  eq("reset → defaults openers", cs.getVoiceOpenersSnapshot(), cs.DEFAULT_VOICE_OPENERS)
  cs.__setChannelScriptsSnapshotForTests({
    instagramDm: "X {brief}",
    instagramComment: { publicReply: "P {username}", privateDm: "D {username}" },
    voiceOpeners: { ...cs.DEFAULT_VOICE_OPENERS, cold: { english: "SNAP", hindi: "SNAP-H", telugu: "SNAP-T" } },
    voiceClosings: { ...cs.DEFAULT_VOICE_CLOSINGS, goodbye: { english: "BYE", hindi: "BYE-H", telugu: "BYE-T" } },
    whatsappFallbacks: { formLink: "F {name} {brand} {link}", callFollowup: "C {name}", missedCall: "M {name}" },
  })
  eq("getter returns injected openers", cs.getVoiceOpenersSnapshot().cold.english, "SNAP")
  eq("getter returns injected closings", cs.getVoiceClosingsSnapshot().goodbye.english, "BYE")
  eq("getter returns injected DM", cs.getInstagramDmTemplate(), "X {brief}")
  eq("getter returns injected comment", cs.getInstagramCommentTemplates().publicReply, "P {username}")
  eq("getter returns injected fallbacks", cs.getWhatsAppFallbackTemplates().formLink, "F {name} {brand} {link}")
  cs.__resetChannelScriptsForTests()
  eq("reset again → default closings", cs.getVoiceClosingsSnapshot(), cs.DEFAULT_VOICE_CLOSINGS)

  console.log("\n— refreshChannelScriptsIfStale (no database) —")
  let threw = null
  try { await cs.refreshChannelScriptsIfStale() } catch (e) { threw = e }
  ok("never throws without a reachable DB", threw === null)
  ok("snapshot still serves defaults after failed refresh", cs.getVoiceOpenersSnapshot() && typeof cs.getVoiceOpenersSnapshot().cold === "object")

  console.log("\n— CHANNEL_SCRIPT_KEYS shape —")
  eq("exactly the 5 documented keys",
     [...cs.CHANNEL_SCRIPT_KEYS].sort(),
     ["instagram_comment", "instagram_dm", "voice_closings", "voice_openers", "whatsapp_fallbacks"])

  console.log("\n— server/fallback-speech.js (shared last-resort lines) —")
  for (const [name, set] of Object.entries(fallbackSpeech)) {
    ok(`${name} has all 3 languages`, LANGS.every(l => typeof set[l] === "string" && set[l].trim().length > 0))
    ok(`${name} lines differ per language`, new Set(LANGS.map(l => set[l])).size === 3)
  }
  ok("CLARIFY english keeps the catch line", fallbackSpeech.CLARIFY_PHRASE.english.includes("didn't quite catch"))
  ok("native script kept in telugu clarify", /[ఀ-౿]/.test(fallbackSpeech.CLARIFY_PHRASE.telugu))
  ok("native script kept in hindi start fallback", /[ऀ-ॿ]/.test(fallbackSpeech.START_FALLBACK_PHRASE.hindi))

  console.log("\n— drift-locks: no duplicated copies left behind —")
  const vs = fs.readFileSync(path.join(ROOT, "server/voicebot-server.js"), "utf8")
  const wc = fs.readFileSync(path.join(ROOT, "server/whatsapp-calls.js"), "utf8")
  ok("voicebot-server.js requires fallback-speech", vs.includes('require("./fallback-speech")'))
  ok("whatsapp-calls.js requires fallback-speech", wc.includes('require("./fallback-speech")'))
  ok("voicebot-server.js no longer defines its own CLARIFY_PHRASE", !/const CLARIFY_PHRASE\s*=/.test(vs))
  ok("whatsapp-calls.js no longer defines its own CLARIFY_PHRASE", !/const CLARIFY_PHRASE\s*=/.test(wc))
  ok("whatsapp-calls.js no longer defines its own START_FALLBACK_PHRASE", !/const START_FALLBACK_PHRASE\s*=/.test(wc))

  const vc = fs.readFileSync(path.join(ROOT, "lib/voice-conversation.ts"), "utf8")
  ok("voice-conversation uses the snapshot for openers", vc.includes("getVoiceOpenersSnapshot()") && vc.includes("greetingFor(language"))
  ok("voice-conversation uses the snapshot for closings", vc.includes("getVoiceClosingsSnapshot().qualified") && vc.includes("getVoiceClosingsSnapshot().goodbye"))
  ok("voice-conversation refreshes scripts at call start", vc.includes("refreshChannelScriptsIfStale"))
  ok("old hardcoded personalized greeters removed", !vc.includes("personalizedGreeting(") && !vc.includes("personalizedWaCallbackGreeting("))
  ok("old CLOSING/RETRY/RATE_LIMIT consts removed", !/const CLOSING[:\s]/.test(vc) && !/const RATE_LIMIT_REPLY[:\s]/.test(vc) && !/const GOODBYE_REPLY[:\s]/.test(vc))

  const wa = fs.readFileSync(path.join(ROOT, "lib/whatsapp.ts"), "utf8")
  ok("whatsapp.ts renders fallbacks from the snapshot", wa.includes("renderTemplate(t.formLink") && wa.includes("renderTemplate(t.callFollowup") && wa.includes("renderTemplate(t.missedCall"))
  ok("old hardcoded fallback template literals removed", !wa.includes("`Hi ${name || \"there\"}! Thanks for speaking"))

  const igSrc = fs.readFileSync(path.join(ROOT, "app/api/instagram/route.ts"), "utf8")
  ok("instagram DM prompt from snapshot", igSrc.includes("renderTemplate(getInstagramDmTemplate()"))
  ok("instagram comment prompts from snapshot", igSrc.includes("renderTemplate(igTemplates.publicReply") && igSrc.includes("renderTemplate(igTemplates.privateDm"))
  ok("old hardcoded instagram prompts removed", !igSrc.includes("senior home & business loan advisor at Right Agent Group.\n"))

  const route = fs.readFileSync(path.join(ROOT, "app/api/script/route.ts"), "utf8")
  ok("script API serves channel defaults", route.includes("CHANNEL_DEFAULTS") && route.includes("CHANNEL_SCRIPT_KEYS"))
  ok("script API accepts channel keys on POST", route.includes("EDITABLE_KEYS"))
  ok("script API resets channel rows via DELETE", route.includes("DELETE FROM ai_scripts"))

  // default templates must keep the exact compliance line
  ok("formLink default keeps the no-OTP compliance line", cs.DEFAULT_WHATSAPP_FALLBACKS.formLink.includes("We never ask for OTP, PIN, or any payment."))
  ok("callFollowup default keeps the no-OTP compliance line", cs.DEFAULT_WHATSAPP_FALLBACKS.callFollowup.includes("We never ask for OTP, PIN, or any payment."))
  ok("missedCall default keeps the no-OTP compliance line", cs.DEFAULT_WHATSAPP_FALLBACKS.missedCall.includes("We never ask for OTP, PIN, or any payment."))

  console.log(`\n${"=".repeat(46)}\nRESULT: ${pass} passed, ${fail} failed\n${"=".repeat(46)}`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1) })
