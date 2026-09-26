#!/usr/bin/env node
// Regression tests for the 2026-09-26 omnichannel script surfaces.
//
// Two layers:
//  1. PURE LOGIC — lib/script-text.ts (merge rules) + lib/default-scripts.ts
//     (the shipped line sets) are compiled with the repo's OWN tsc and the
//     compiled output is exercised directly. No DB, no mocks: the exact
//     production merge/render code runs here.
//  2. INTEGRATION SEAMS — source-level assertions that every consumer is
//     actually wired to the DB-editable loader (a silent revert of any of
//     these lines back to hardcoded text fails this suite).
//
// Run: node scripts/test-script-lines.js

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

const ROOT = path.join(__dirname, "..")
const TSC = path.join(ROOT, "node_modules", ".bin", "tsc")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rag-script-lines-"))

let passed = 0
let failed = 0
function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.error(`  ❌ ${name}`)
  }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${name}${a === b ? "" : ` — got ${a}, want ${b}`}`)
}
function section(title) {
  console.log(`\n— ${title}`)
}

try {
  // ── Compile the pure modules with the repo's own tsc ──
  section("Compiling lib/script-text.ts + lib/default-scripts.ts (repo tsc)")
  execSync(
    `"${TSC}" lib/script-text.ts lib/default-scripts.ts --outDir "${TMP}" --module commonjs --target es2020 --esModuleInterop --skipLibCheck`,
    { cwd: ROOT, stdio: "pipe" }
  )
  ok(fs.existsSync(path.join(TMP, "script-text.js")), "script-text.ts compiles")
  ok(fs.existsSync(path.join(TMP, "default-scripts.js")), "default-scripts.ts compiles")
  const st = require(path.join(TMP, "script-text.js"))
  const ds = require(path.join(TMP, "default-scripts.js"))

  // ── 1. Defaults shape ──
  section("Defaults: complete line sets (nothing blank, tokens present)")
  const OPENERS = ds.DEFAULT_VOICE_OPENERS
  const openerScenarios = ["cold", "cold_named", "returning", "returning_named", "inbound", "inbound_named"]
  for (const s of openerScenarios) {
    for (const l of ["english", "hindi", "telugu"]) {
      ok(typeof OPENERS[s]?.[l] === "string" && OPENERS[s][l].length > 20, `opener ${s}.${l} non-empty`)
    }
  }
  ok(/\{name\}/.test(OPENERS.cold_named.english), "cold_named carries the {name} token")
  ok(!/\{name\}/.test(OPENERS.cold.english), "plain cold opener has no {name} token")
  ok(/[\u0C00-\u0C7F]/.test(OPENERS.cold.telugu), "telugu opener is in Telugu script (native TTS voice)")
  ok(/[\u0900-\u097F]/.test(OPENERS.cold.hindi), "hindi opener is in Devanagari (native TTS voice)")
  const CLOSINGS = ds.DEFAULT_VOICE_CLOSINGS
  for (const s of ["qualified", "sign_off"]) {
    for (const l of ["english", "hindi", "telugu"]) {
      ok(typeof CLOSINGS[s]?.[l] === "string" && CLOSINGS[s][l].length > 10, `closing ${s}.${l} non-empty`)
    }
  }
  const WA = ds.DEFAULT_WHATSAPP_FALLBACKS
  ok(/\{name\}/.test(WA.form_link) && /\{brand\}/.test(WA.form_link) && /\{link\}/.test(WA.form_link), "form_link has {name} {brand} {link}")
  ok(/\{name\}/.test(WA.call_followup) && /\{brand\}/.test(WA.call_followup), "call_followup has {name} {brand}")
  ok(/\{name\}/.test(WA.missed_call) && /\{brand\}/.test(WA.missed_call), "missed_call has {name} {brand}")
  const IG = ds.DEFAULT_INSTAGRAM_PROMPTS
  ok(/\{username\}/.test(IG.comment.system_prompt), "comment system_prompt has {username}")
  ok(/\{username\}/.test(IG.comment.first_dm), "comment first_dm has {username}")
  ok(typeof IG.dm.system_prompt === "string" && IG.dm.system_prompt.length > 30, "dm.system_prompt non-empty")
  ok(typeof IG.dm.reply_rules === "string" && IG.dm.reply_rules.length > 30, "dm.reply_rules non-empty")
  const JSON_DEFAULTS = ds.SCRIPT_JSON_DEFAULTS
  for (const k of ["voice_openers", "voice_closings", "whatsapp_fallbacks", "instagram_dm", "instagram_comment"]) {
    let parsed = null
    try { parsed = JSON.parse(JSON_DEFAULTS[k]) } catch {}
    ok(parsed && typeof parsed === "object", `SCRIPT_JSON_DEFAULTS.${k} is valid JSON`)
  }

  // ── 2. Merge rules ──
  section("Merge rules: partial/corrupt saved rows can never blank a line")
  eq(
    st.mergeWhatsappFallbacks({ form_link: "CUSTOM {link}" }, WA).form_link,
    "CUSTOM {link}",
    "saved field wins"
  )
  eq(
    st.mergeWhatsappFallbacks({ form_link: "  " }, WA).form_link,
    WA.form_link,
    "whitespace-only saved field falls back to default"
  )
  const mergedWa = st.mergeWhatsappFallbacks({ call_followup: "X {brand}" }, WA)
  eq(mergedWa.form_link, WA.form_link, "fields not in the saved row keep defaults")
  eq(st.mergeWhatsappFallbacks(null, WA), WA, "null row = pure defaults")
  eq(st.mergeWhatsappFallbacks("not-an-object", WA), WA, "garbage row = pure defaults")
  const mergedOpeners = st.mergeVoiceOpeners({ cold: { english: "CUSTOM COLD" } }, OPENERS)
  eq(mergedOpeners.cold.english, "CUSTOM COLD", "opener scenario+lang override")
  eq(mergedOpeners.cold.hindi, OPENERS.cold.hindi, "sibling languages untouched")
  eq(mergedOpeners.cold_named.english, OPENERS.cold_named.english, "sibling scenarios untouched")
  eq(
    st.mergeVoiceOpeners({ cold: { english: 42 } }, OPENERS).cold.english,
    OPENERS.cold.english,
    "wrong-typed value ignored"
  )
  const mergedIg = st.mergeInstagramPrompts({ dm: { system_prompt: "IG DM PERSONA" } }, IG)
  eq(mergedIg.dm.system_prompt, "IG DM PERSONA", "instagram dm override")
  eq(mergedIg.dm.reply_rules, IG.dm.reply_rules, "instagram dm rules default kept")
  eq(mergedIg.comment.first_dm, IG.comment.first_dm, "instagram comment untouched")

  // ── 3. Template rendering ──
  section("renderTemplate: token substitution")
  eq(
    st.renderTemplate("Hi {name}! From {brand}. Link: {link}", { name: "Ravi", brand: "RAG", link: "https://x/f/t" }),
    "Hi Ravi! From RAG. Link: https://x/f/t",
    "all tokens substituted"
  )
  eq(st.renderTemplate("Hi {name}", { brand: "RAG" }), "Hi {name}", "unknown token left visible")
  eq(st.renderTemplate("No tokens here", {}), "No tokens here", "no tokens = unchanged")
  eq(st.renderTemplate("Hi {name}", {}), "Hi {name}", "missing var left visible (not deleted)")

  // ── 4. Integration seams ──
  section("Integration seams: consumers actually read the DB-editable loader")
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

  const vc = read("lib/voice-conversation.ts")
  ok(vc.includes('getVoiceOpeners') && vc.includes('getVoiceClosings'), "voice-conversation imports the loaders")
  ok(vc.includes("from \"./script-lines\""), "voice-conversation reads lib/script-lines")
  ok(!/const GREETINGS: Record<Language, string> = \{/.test(vc), "no hardcoded GREETINGS object left")
  ok(!/const GOODBYE_REPLY: Record<Language, string> = \{/.test(vc), "no hardcoded GOODBYE_REPLY left")
  ok(!/const CLOSING: Record<Language, string> = \{/.test(vc), "no hardcoded CLOSING left")
  ok(/fillName\(openers\.cold_named/.test(vc), "named opener path uses {name} fill")

  const wa = read("lib/whatsapp.ts")
  ok(wa.includes("getWhatsappFallbacks") && wa.includes("renderTemplate"), "whatsapp fallbacks are DB-driven")
  ok(!/Thanks for speaking with Priya from \$\{brand\}/.test(wa), "no hardcoded fallback text left")
  ok(wa.includes("message.includes(link)"), "form-link template without {link} is auto-repaired")

  const ig = read("app/api/instagram/route.ts")
  ok(ig.includes("getInstagramPrompts"), "instagram route reads the loader")
  ok(!/You are Priya, senior home & business loan advisor at Right Agent Group\.\nYou are communicating with a client via Instagram Direct Message/.test(ig), "no hardcoded DM persona left")
  ok(ig.includes("first_dm.replace(/\\{username\\}/g, username)"), "first DM uses the {username} token")

  const scriptRoute = read("app/api/script/route.ts")
  ok(scriptRoute.includes("SCRIPT_JSON_DEFAULTS"), "/api/script serves JSON defaults")
  for (const k of ["voice_openers", "voice_closings", "whatsapp_fallbacks", "instagram_dm", "instagram_comment"]) {
    ok(scriptRoute.includes(`"${k}"`) || scriptRoute.includes(`'${k}'`), `/api/script allows key ${k}`)
  }
  ok(scriptRoute.includes("invalidateScriptLines()"), "edits invalidate the TTL cache instantly")

  const sl = read("lib/script-lines.ts")
  ok(sl.includes("5 * 60 * 1000"), "loader uses the 5-minute TTL")
  ok(sl.includes("DEFAULT_VOICE_OPENERS") && sl.includes("DEFAULT_INSTAGRAM_PROMPTS"), "loader merges over the defaults")

  // Server last-resort dedupe
  const pl = read("server/priya-lines.js")
  ok(/module\.exports/.test(pl) && /CLARIFY_PHRASE/.test(pl) && /FALLBACK_PHRASE/.test(pl) && /START_FALLBACK_PHRASE/.test(pl), "server/priya-lines.js exports all three line sets")
  const vbs = read("server/voicebot-server.js")
  const wac = read("server/whatsapp-calls.js")
  ok(vbs.includes('require("./priya-lines")'), "voicebot-server requires the shared lines")
  ok(wac.includes('require("./priya-lines")'), "whatsapp-calls requires the shared lines")
  ok(!/const CLARIFY_PHRASE = \{/.test(vbs), "voicebot-server has no local CLARIFY_PHRASE copy")
  ok(!/const CLARIFY_PHRASE = \{/.test(wac), "whatsapp-calls has no local CLARIFY_PHRASE copy")
  ok(vbs.includes("CLARIFY_PHRASE[") || vbs.includes("CLARIFY_PHRASE."), "voicebot-server still consumes the phrases")
} catch (e) {
  failed++
  console.error("❌ SUITE ERROR:", e.message)
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
}

console.log(`\n═══ test-script-lines: ${passed} passed, ${failed} failed ═══`)
process.exit(failed ? 1 : 0)
