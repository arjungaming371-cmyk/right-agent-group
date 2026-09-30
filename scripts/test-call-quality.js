#!/usr/bin/env node
// Regression tests for the 2026-09-30 call-quality overhaul ("train the
// calling agent"): script/KB adherence, no re-asking answered questions,
// consistent tone/language through the whole call.
//
// lib/call-facts.ts is import-free by contract, so it compiles standalone
// with the repo's own tsc (same pattern as test-knowledge-base.js).
// Static contract checks pin the wiring in lib/llm.ts, lib/voice-conversation.ts,
// lib/knowledge-base.ts and app/api/calls/turn/route.ts.
//
// No DB, no mocks, no network.
//
// Run: node scripts/test-call-quality.js

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

const ROOT = path.join(__dirname, "..")
const TSC = path.join(ROOT, "node_modules", ".bin", "tsc")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rag-call-q-"))

let passed = 0
let failed = 0
function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

// ---------------------------------------------------------------------------
// Compile lib/call-facts.ts standalone
// ---------------------------------------------------------------------------
execSync(`"${TSC}" lib/call-facts.ts --outDir "${TMP}" --module commonjs --target es2020 --lib es2020 --esModuleInterop --skipLibCheck --noEmitOnError false`, {
  cwd: ROOT,
  stdio: "pipe",
})
const { resolveSpokenLanguage, normalizeCallLanguage, extractCallFacts, formatInCallFactsBlock } = require(path.join(TMP, "call-facts.js"))

// A stand-in detector with the same contract as lib/llm.ts detectLanguage
// (native script → that language; listed Tenglish keywords → that language;
// otherwise english). The real detectLanguage is exercised in production.
function fakeDetect(text) {
  if (/[\u0C00-\u0C7F]/.test(text)) return "telugu"
  if (/[\u0900-\u097F]/.test(text)) return "hindi"
  const lower = text.toLowerCase()
  if (/\b(kavali|naaku|cheppandi|namaskaram|garu|ledu|enti|enta|ekkada)\b/.test(lower)) return "telugu"
  if (/\b(chahiye|hai|nahi|haan|naam|kya|mujhe|theek)\b/.test(lower)) return "hindi"
  return "english"
}

// ---------------------------------------------------------------------------
section("1. resolveSpokenLanguage — explicit requests switch immediately")
let r = resolveSpokenLanguage("telugu lo matladu sir", "english", fakeDetect)
ok(r.language === "telugu" && r.explicit === true, `explicit telugu request switches (${r.language}, explicit=${r.explicit})`)
r = resolveSpokenLanguage("please speak english", "telugu", fakeDetect)
ok(r.language === "english" && r.explicit === true, `explicit english request switches (${r.language}, explicit=${r.explicit})`)
r = resolveSpokenLanguage("hindi mein boliye", "telugu", fakeDetect)
ok(r.language === "hindi" && r.explicit === true, `explicit hindi request switches (${r.language}, explicit=${r.explicit})`)

section("2. resolveSpokenLanguage — strong evidence switches, not explicit")
r = resolveSpokenLanguage("మీకు ఏమి కావాలి", "english", fakeDetect)
ok(r.language === "telugu" && r.explicit === false, "native Telugu script switches (auto)")
r = resolveSpokenLanguage("naaku loan kavali sir", "english", fakeDetect)
ok(r.language === "telugu" && r.explicit === false, "Tenglish keyword evidence switches (auto)")
r = resolveSpokenLanguage("actually sir I am busy right now can you call tomorrow evening", "telugu", fakeDetect)
ok(r.language === "english" && r.explicit === false, "full English sentence switches (auto, 11 words + function words)")

section("3. resolveSpokenLanguage — THE OLD BUG: Tenglish answers no longer flip the call")
// "naa peru Suresh" — 3 Roman words, no Tenglish keyword in old detect →
// old rule flipped the WHOLE call to English (different TTS voice mid-call).
r = resolveSpokenLanguage("naa peru Suresh", "telugu", fakeDetect)
ok(r.language === "telugu", `"naa peru Suresh" stays telugu (was flipped to english by the old 3-word rule)`)
r = resolveSpokenLanguage("ok sir", "telugu", fakeDetect)
ok(r.language === "telugu", `"ok sir" stays telugu`)
r = resolveSpokenLanguage("haan theek hai", "hindi", fakeDetect)
ok(r.language === "hindi", `"haan theek hai" stays hindi`)
r = resolveSpokenLanguage("sare thank you sir", "telugu", fakeDetect)
ok(r.language === "telugu", `"sare thank you sir" stays telugu`)
r = resolveSpokenLanguage("16 lakhs kavali", "telugu", fakeDetect)
ok(r.language === "telugu", `"16 lakhs kavali" stays telugu (keyword evidence)`)

section("4. normalizeCallLanguage")
ok(normalizeCallLanguage("hindi") === "hindi", "hindi passes through")
ok(normalizeCallLanguage(undefined) === "telugu", "undefined falls back to telugu")
ok(normalizeCallLanguage("tamil") === "telugu", "unknown language falls back to telugu")

// ---------------------------------------------------------------------------
section("5. extractCallFacts — self-intro phrases")
let facts = extractCallFacts([{ role: "model", content: "Namaskaram sir! How can I help you?" }, { role: "user", content: "my name is Suresh Babu" }], "ok")
ok(facts.name === "Suresh Babu", `name captured from "my name is" (${facts.name})`)
facts = extractCallFacts([{ role: "user", content: "naa peru Ravi Kumar sir" }], "yes")
ok(facts.name === "Ravi Kumar", `Telugu self-intro name captured (${facts.name})`)
ok(!!facts.name, "name fact present")

section("6. extractCallFacts — Q→A pairing (short answers right after Priya's question)")
facts = extractCallFacts(
  [
    { role: "model", content: "What is your full name, sir?" },
    { role: "user", content: "Suresh" },
    { role: "model", content: "Thank you sir. Which area are you in, sir?" },
    { role: "user", content: "Kukatpally" },
  ],
  "ok sir"
)
ok(facts.name === "Suresh", `name captured from Q→A (${facts.name})`)
ok(facts.area === "Kukatpally", `area captured from Q→A (${facts.area})`)

section("7. extractCallFacts — loan amount/type with intent filter")
facts = extractCallFacts([{ role: "user", content: "naaku 25 lakhs loan kavali sir" }], "home loan")
ok(facts.loanAmount === "25 lakhs", `loan amount captured (${facts.loanAmount})`)
ok(facts.loanType === "home loan", `loan type captured from speech (${facts.loanType})`)
facts = extractCallFacts([{ role: "user", content: "my salary is 40 thousand sir" }], "ok")
ok(!facts.loanAmount, `"salary 40 thousand" NOT mistaken for a loan amount`)
facts = extractCallFacts([{ role: "user", content: "I need illu loan sir" }], "ok")
ok(facts.loanType === "home loan", `"illu loan" mapped to home loan (${facts.loanType})`)

section("8. extractCallFacts — WhatsApp same-number confirmation")
facts = extractCallFacts(
  [
    { role: "model", content: "Is your WhatsApp number the same as this call, or different?" },
    { role: "user", content: "same sir" },
  ],
  "ok"
)
ok(facts.whatsappSame === true, `"same sir" after WhatsApp question → whatsappSame`)
facts = extractCallFacts([{ role: "model", content: "Is your WhatsApp number the same?" }, { role: "user", content: "no, different number 9908838090" }], "ok")
ok(!facts.whatsappSame, `"no, different" does NOT set whatsappSame`)

section("9. extractCallFacts — no false positives from politeness/Priya's own words")
facts = extractCallFacts(
  [
    { role: "model", content: "I am Priya from Right Agent Group, calling about loan options." },
    { role: "user", content: "ok sir thank you" },
  ],
  "haan tell me"
)
ok(!facts.name, "Priya's own intro never becomes a customer fact")
ok(!facts.area, "no area fact from pitch text")
ok(Object.keys(facts).length === 0, `polite fillers produce zero facts (${JSON.stringify(facts)})`)
facts = extractCallFacts([{ role: "user", content: "i am busy right now sir" }], "ok")
ok(!facts.name, `"i am busy" is not captured as a name`)
facts = extractCallFacts([{ role: "user", content: "this is fraud?" }], "ok")
ok(!facts.name, `"this is fraud?" is not captured as a name`)

section("10. formatInCallFactsBlock")
ok(formatInCallFactsBlock({}) === "", "empty facts → empty block (no prompt dilution)")
const block = formatInCallFactsBlock({ name: "Suresh", area: "Kukatpally", whatsappSame: true })
ok(block.includes("ANSWERED ALREADY IN THIS CALL"), "block carries the DO-NOT-RE-ASK header")
ok(block.includes("- name: Suresh"), "block lists the name")
ok(block.includes("NEVER ask"), "block bans re-asking")

// ---------------------------------------------------------------------------
// Static wiring contracts
// ---------------------------------------------------------------------------
section("11. lib/llm.ts wiring — tone lock + script-first governance")
const llm = fs.readFileSync(path.join(ROOT, "lib", "llm.ts"), "utf8")
ok(llm.includes("LLM_TEMPERATURE_CALL"), "CALL_TEMPERATURE is env-overridable (LLM_TEMPERATURE_CALL)")
ok((llm.match(/temperature: channel === "call" \? CALL_TEMPERATURE/g) || []).length === 2, "BOTH chat paths (blocking + stream) pass CALL_TEMPERATURE on the call channel")
ok(!llm.includes("overrides the generic GOAL step order"), "old 'overrides the GOAL' header is GONE (script stays in charge)")
ok((llm.match(/TURN CONTEXT — live data for THIS reply/g) || []).length === 2, "new TURN CONTEXT header present in both chat paths")

section("12. lib/voice-conversation.ts wiring — in-call fact memory + KB retry")
const vc = fs.readFileSync(path.join(ROOT, "lib", "voice-conversation.ts"), "utf8")
ok(vc.includes("extractCallFacts") && vc.includes("formatInCallFactsBlock"), "in-call fact memory injected every turn")
ok(vc.includes("IN-CALL FACT MEMORY"), "in-call fact block is commented/documented")
ok(vc.includes("retry ONCE with Priya's last question"), "KB retry with conversation context documented")
ok(vc.includes("kbContext = await searchKnowledgeBase(`${lastPriyaTurn.content} ${speech}`"), "KB retry searches speech + Priya's last question")
ok(!vc.includes("ALWAYS proactively ask if they have any doubts"), "forced doubts-question-after-every-reply rule removed")
ok(vc.includes("AT MOST ONCE per reply"), "doubt-check capped at once per reply")

section("13. lib/knowledge-base.ts — grounding mandate")
const kb = fs.readFileSync(path.join(ROOT, "lib", "knowledge-base.ts"), "utf8")
ok(kb.includes("NEVER approximate, extrapolate, or invent one"), "formatHits forbids inventing figures outside the KB hits")

section("14. app/api/calls/turn/route.ts — language switch persistence guard")
const route = fs.readFileSync(path.join(ROOT, "app", "api", "calls", "turn", "route.ts"), "utf8")
ok(route.includes('from "@/lib/call-facts"'), "route imports the shared call-facts module")
ok(!route.includes("function resolveSpokenLanguage"), "local (untested) language-switch logic removed from the route")
ok(route.includes("if (explicitSwitch && call?.lead_id)"), "lead language persist gated on EXPLICIT switch only")
ok(!route.includes("resolveSpokenLanguage(speech, current)"), "old 2-arg call signature gone")

// ---------------------------------------------------------------------------
// "SAME FOR WHATSAPP CALLS" — the WhatsApp calling bridge shares ONE brain
// with the Exotel voicebot (/api/calls/turn → handleTurn/handleTurnStream).
// These contracts pin that every call-quality guarantee reaches WhatsApp
// calls too, and that WhatsApp-specific context (chat-derived facts) is not
// lost before the Lead Brain idle-scan distills it.
// ---------------------------------------------------------------------------
section("15. server/whatsapp-calls.js wiring — WhatsApp calls ride the same fixed brain")
const wa = fs.readFileSync(path.join(ROOT, "server", "whatsapp-calls.js"), "utf8")
ok(wa.includes("/api/calls/turn"), "WhatsApp bridge calls the SAME turn API as the Exotel voicebot")
ok(wa.includes('event: "start"') && wa.includes('event: "turn"'), "start + turn events go through the shared brain")
ok(wa.includes('source: "whatsapp_call"'), "WhatsApp calls tagged with source=whatsapp_call (lead + analytics)")
ok(wa.includes("callTurnApiStream"), "WhatsApp turns use the streaming path (same instant-sentence pipeline)")
ok((wa.match(/if \(ev\.language\) this\.language = ev\.language/g) || []).length >= 2, "session language follows the brain's per-turn language (no stale TTS voice)")
ok(wa.includes("voiceProviders.transcribe(pcmToWav16k(pcm16k), this.language)"), "STT hint per utterance (mid-call language switching works)")

section("16. WhatsApp-call context in the shared brain — grounding + tone + facts")
ok(vc.includes('isWhatsAppCall ? "whatsapp" : "phone"'), "BOTH turn paths pass the WhatsApp channel fact to buildTurnInstructions")
ok((vc.match(/isWhatsAppCall \? "whatsapp" : "phone"/g) || []).length === 2, "handleTurn AND handleTurnStream are WhatsApp-aware")
ok(vc.includes("THIS CALL IS HAPPENING ON THE CUSTOMER'S WHATSAPP"), "WhatsApp grounding line: never re-ask the WhatsApp number on a WhatsApp call")
ok(vc.includes('callSid?.startsWith("wacall-")'), "channel fact derived from wacall- sids in both turn paths")
ok(llm.includes("CALL_TEMPERATURE"), "tone lock (temperature) applies to the call channel — shared by WhatsApp calls")

section("17. lib/lead-brain.ts — unanalyzed WhatsApp chat reaches the call (no re-asking fresh chat facts)")
const lb = fs.readFileSync(path.join(ROOT, "lib", "lead-brain.ts"), "utf8").replace(/\r\n/g, "\n")
ok(lb.includes("RECENT WHATSAPP CHAT"), "unanalyzed WhatsApp chat fallback block present in buildLeadBrief")
ok(lb.includes("never re-ask it, never restart from scratch"), "chat block carries an explicit do-not-re-ask mandate")
ok(lb.includes("$2::timestamptz IS NULL OR created_at > $2::timestamptz"), "chat fallback gated on last_analysis_at (no double injection after the idle-scan runs)")
ok(lb.includes("lm.last_analysis_at"), "brief SELECT now reads last_analysis_at from lead_memory")
ok(lb.includes("unanalyzedChatBrief) {"), "DO/DON'T no-re-ask line also fires on fresh chat context alone")
ok(lb.includes('WHERE lead_id = $1\n          AND content IS NOT NULL'), "empty/media-only chat messages filtered out")

console.log(`\n========================================`)
console.log(`  RESULT: ${passed} passed, ${failed} failed`)
console.log(`========================================`)
process.exit(failed > 0 ? 1 : 0)
