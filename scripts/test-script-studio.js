#!/usr/bin/env node
// Regression tests for the 2026-10-09 Outpero-style Script Studio
// (per-lead {merge_field} campaign personalization).
//
// The merge-field engine (extraction, preview vs dial-time rendering,
// dial-time sanitizing, custom-field validation, lead briefs, the
// Outpero-style campaign script builder) lives in lib/script-studio.ts —
// import-free ON PURPOSE so this suite compiles that exact file with the
// repo's OWN tsc and exercises it directly. No DB, no mocks.
//
// Run: node scripts/test-script-studio.js

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

const ROOT = path.join(__dirname, "..")
const TSC = path.join(ROOT, "node_modules", ".bin", "tsc")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rag-script-studio-"))

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
  section("Compiling lib/script-studio.ts (repo tsc)")
  execSync(
    `"${TSC}" lib/script-studio.ts --outDir "${TMP}" --module commonjs --target es2020 --esModuleInterop --skipLibCheck`,
    { cwd: ROOT, stdio: "pipe" }
  )
  ok(fs.existsSync(path.join(TMP, "script-studio.js")), "script-studio.ts compiles")
  const ss = require(path.join(TMP, "script-studio.js"))

  // ── 1. Field extraction ──
  section("extractMergeFields: {token} discovery")
  eq(ss.extractMergeFields("Hi {name}, re: {product_interest} — {name} again"), ["name", "product_interest"], "unique, first-appearance order")
  eq(ss.extractMergeFields("no tokens here"), [], "no tokens → empty")
  eq(ss.extractMergeFields("brace {with space} stays"), [], "only [a-zA-Z0-9_] tokens match")
  eq(ss.hasMergeFields("Hello {name}!"), true, "hasMergeFields true")
  eq(ss.hasMergeFields("Hello plain script"), false, "hasMergeFields false")

  // ── 2. Preview rendering ──
  section("renderMergeFields: preview semantics (missing → empty, unknown → visible)")
  const known = [...ss.CANONICAL_FIELDS, "city"]
  const vars = { name: "Suresh", city: "Kukatpally" }
  const r1 = ss.renderMergeFields("Hi {name} from {city}, about {product_interest} and {budget}", vars, known)
  eq(r1.text, "Hi Suresh from Kukatpally, about  and {budget}", "known filled, missing emptied, unknown untouched")
  eq(r1.missing, ["product_interest"], "missing = known but empty")
  eq(r1.unknown, ["budget"], "unknown = not in the known universe")
  const r2 = ss.renderMergeFields("{name} / {product_interest}", vars)
  eq(r2.unknown, ["product_interest"], "without `known`, absent keys count as unknown (sample-lead preview)")

  // ── 3. Dial-time safety ──
  section("renderForDial / sanitizeRenderedScript: Priya never reads braces aloud")
  eq(ss.renderForDial("Hi {name} from {city}", vars), "Hi Suresh from Kukatpally", "all tokens resolve")
  eq(ss.renderForDial("Hi {name}, {typo_field} ok", vars), "Hi Suresh, ok", "leftover tokens stripped at dial time")
  eq(ss.sanitizeRenderedScript("word , word ;word.x  y"), "word, word; word. x y", "punctuation/spacing tidied")
  eq(ss.sanitizeRenderedScript("a {oops} b"), "a b", "stray token removed, no double space")
  eq(ss.sanitizeRenderedScript("() empty parens"), "empty parens", "empty parens removed")

  // ── 4. Field variables ──
  section("buildFieldVars: canonical columns + custom sheet data")
  const v = ss.buildFieldVars(
    { name: "Ramesh", phone: "+919876543210", language: "telugu", product_interest: "Home Loan", loan_amount: 4000000, notes: "balance transfer" },
    { "Pin Code": "500072", budget: "40 lakhs" }
  )
  eq(v.name, "Ramesh", "canonical name")
  eq(v.loan_amount, "₹40,00,000", "loan_amount formatted en-IN")
  eq(v.pin_code, "500072", "custom key slugified (Pin Code → pin_code)")
  eq(v.budget, "40 lakhs", "custom value kept")
  eq(v.status, "", "absent canonical → empty string (never undefined)")
  const bigCustom = {}
  for (let i = 0; i < 30; i++) bigCustom[`f${i}`] = `v${i}`
  eq(Object.keys(ss.buildFieldVars(null, bigCustom)).length, 10 + 15, "custom fields capped at 15")

  // ── 5. Custom field validation ──
  section("sanitizeCustomFields: untrusted upload payloads")
  eq(ss.sanitizeCustomFields({ City: "Hyd", "Loan Amt!": "5L", skip: "", n: 42, bad: null }), { city: "Hyd", loan_amt: "5L", n: "42" }, "slugify, drop empties, coerce scalars")
  eq(ss.sanitizeCustomFields("not an object"), null, "non-object → null")
  eq(ss.sanitizeCustomFields([]), null, "array → null")
  eq(ss.sanitizeCustomFields({ a: "  " }), null, "whitespace-only → null")

  // ── 6. Lead brief ──
  section("buildLeadBrief: 'perfect notes' fact sheet")
  eq(ss.buildLeadBrief({ city: "Hyd", budget: "40 lakhs", empty: "" }), "city: Hyd · budget: 40 lakhs", "k:v joined, empties skipped")
  eq(ss.buildLeadBrief(null), "", "null → empty")

  // ── 7. Dial-time instructions ──
  section("renderInstructionsForLead: the one call-site helper")
  const lead = { name: "Suresh", product_interest: "Home Loan" }
  eq(
    ss.renderInstructionsForLead("Hi {name}, about your {product_interest}", lead, { city: "Hyd" }),
    "Hi Suresh, about your Home Loan\n\nLEAD DATA ON FILE (use it, never re-ask): city: Hyd",
    "template rendered + brief appended"
  )
  eq(
    ss.renderInstructionsForLead("plain agenda, no fields", lead, { city: "Hyd" }),
    "plain agenda, no fields\n\nLEAD DATA ON FILE (use it, never re-ask): city: Hyd",
    "plain agenda still gets the brief"
  )
  eq(ss.renderInstructionsForLead("plain, no custom", lead, null), "plain, no custom", "no custom → no brief block")
  eq(ss.renderInstructionsForLead(null, lead, { city: "Hyd" }), "LEAD DATA ON FILE (use it, never re-ask): city: Hyd", "no template → brief only")
  eq(ss.renderInstructionsForLead("  ", lead, null), null, "nothing at all → null")

  // ── 8. Outpero-style campaign script builder ──
  section("buildCampaignScript: Swara-HR brief in Tenglish / Hinglish / English")
  for (const lang of ["telugu", "hindi", "english"]) {
    const script = ss.buildCampaignScript({
      product: "Home Loan", offer: "balance transfer at a lower EMI",
      tone: "friendly", capture: ["Full name", "Area"], language: lang,
    })
    ok(script.includes("OPENING"), `${lang}: has OPENING`)
    ok(script.includes("DISCOVERY"), `${lang}: has DISCOVERY`)
    ok(script.includes("PITCH"), `${lang}: has PITCH`)
    ok(script.includes("DETAILS TO CAPTURE"), `${lang}: has DETAILS TO CAPTURE`)
    ok(script.includes("READBACK"), `${lang}: has READBACK`)
    ok(script.includes("CLOSE"), `${lang}: has CLOSE`)
    ok(script.includes("HARD RULES"), `${lang}: has HARD RULES`)
    ok(script.includes("{name}"), `${lang}: uses the {name} merge field`)
    ok(script.includes("balance transfer at a lower EMI"), `${lang}: carries the offer`)
    ok(script.includes("2) Area"), `${lang}: capture list numbered`)
    ok(script.toLowerCase().includes("no otp"), `${lang}: safety rules present`)
  }
  const te = ss.buildCampaignScript({ product: "Home Loan", offer: "x", language: "telugu" })
  ok(!/[\u0C00-\u0C7F]/.test(te), "telugu brief is Roman-letter Tenglish (no Telugu script)")
  const hi = ss.buildCampaignScript({ product: "Home Loan", offer: "x", language: "hindi" })
  ok(!/[\u0900-\u097F]/.test(hi), "hindi brief is Roman-letter Hinglish (no Devanagari)")
  const defCap = ss.buildCampaignScript({ product: "Home Loan", offer: "x", language: "english" })
  ok(defCap.includes("5) WhatsApp number"), "default capture list applied when none given")

  // ── 9. Sample lead for the studio preview ──
  section("sampleVars: realistic preview data")
  const sample = ss.sampleVars()
  eq(sample.name, "Suresh", "sample lead name")
  eq(sample.city, "Kukatpally, Hyderabad", "sample custom city")
  eq(ss.renderMergeFields("{name} lives in {city}", sample).text, "Suresh lives in Kukatpally, Hyderabad", "sample renders cleanly")
} catch (e) {
  failed++
  console.error(`\n💥 Suite crashed: ${e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n") : e}`)
}

console.log(`\n${"=".repeat(50)}`)
console.log(`Result: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
