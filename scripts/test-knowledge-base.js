#!/usr/bin/env node
// Regression tests for the 2026-09-30 knowledge-base compliance upgrade.
//
// The KB grounds Priya's live answers, so the call script's HARD RULES
// (lib/default-scripts.ts) are enforced as machine checks in
// lib/kb-rules.ts — this suite exercises that exact file (compiled with the
// repo's OWN tsc, import-free) plus the CSV parser, the shipped seed CSV,
// and static contracts on every ingest route + AI channel.
//
// No DB, no mocks, no network.
//
// Run: node scripts/test-knowledge-base.js

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

const ROOT = path.join(__dirname, "..")
const TSC = path.join(ROOT, "node_modules", ".bin", "tsc")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rag-kb-"))

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
function section(title) {
  console.log(`\n— ${title}`)
}

try {
  // ── 0. Compile the pure libs ──
  section("Compiling lib/kb-rules.ts + lib/csv-parse.ts (repo tsc)")
  for (const f of ["kb-rules.ts", "csv-parse.ts"]) {
    execSync(`"${TSC}" lib/${f} --outDir "${TMP}" --module commonjs --target es2020 --esModuleInterop --skipLibCheck`, {
      cwd: ROOT, stdio: "pipe",
    })
  }
  const rules = require(path.join(TMP, "kb-rules.js"))
  const csv = require(path.join(TMP, "csv-parse.js"))
  ok(typeof rules.validateKbEntries === "function", "kb-rules compiles, validateKbEntries exported")
  ok(typeof rules.diffKbPlan === "function", "diffKbPlan exported")
  ok(typeof rules.normalizeKbTitle === "function", "normalizeKbTitle exported")
  ok(typeof csv.parseCsvToEntries === "function", "csv-parse compiles, parseCsvToEntries exported")

  const V = (entries, opts) => rules.validateKbEntries(entries, opts)
  const entry = (title, content) => ({ title, content })

  // ── 1. Validator — approval guarantees (script HARD RULE) ──
  section("Approval-guarantee rule (script: NEVER guarantee approval)")
  ok(V([entry("Fast loans", "Get guaranteed approval on your home loan today")]).violations.some((v) => v.rule === "approval-guarantee"),
    '"guaranteed approval" blocked')
  ok(V([entry("Offer", "We provide 100% approval for salaried customers")]).violations.some((v) => v.rule === "approval-guarantee"),
    '"100% approval" blocked')
  ok(V([entry("Offer", "Sirf aapke liye pakka approval milega")]).violations.some((v) => v.rule === "approval-guarantee"),
    'Tenglish "pakka approval" blocked')
  ok(V([entry("Trust", "Your loan is assured to be sanctioned quickly")]).violations.some((v) => v.rule === "approval-guarantee"),
    '"assured to be sanctioned" blocked')
  ok(V([entry("Honest policy", "We never guarantee approval — we say very good chances at most")]).violations.length === 0,
    'negated "we never guarantee approval" allowed')
  ok(V([entry("Insurance plans", "Money Back Income Plans and Endowment Plans available. SBI Life and LIC Life give returns up to 15% per annum")]).violations.length === 0,
    "operator insurance wording (Money Back / returns up to) NOT flagged")

  // ── 2. Validator — OTP / payment solicitation (script HARD RULE) ──
  section("Sensitive-data & payment solicitation rule")
  ok(V([entry("Verify", "Please share your OTP to complete verification")]).violations.some((v) => v.rule === "sensitive-solicitation"),
    '"share your OTP" blocked')
  ok(V([entry("Verify", "Enter your card number and PIN here")]).violations.some((v) => v.rule === "sensitive-solicitation"),
    "card number / PIN solicitation blocked")
  ok(V([entry("Payment", "Pay 5000 now to lock your rate")]).violations.some((v) => v.rule === "sensitive-solicitation"),
    '"Pay 5000 now" blocked')
  ok(V([entry("Payment", "Send money to quickloan@ybl instantly")]).violations.some((v) => v.rule === "sensitive-solicitation"),
    "UPI handle in content blocked")
  ok(V([entry("Fraud safety", "We never ask for OTP or PIN or any payment on a call")]).violations.length === 0,
    'negated "we never ask for OTP" allowed (fraud-safety entries)')

  // ── 3. Validator — contact coordinates (script: never invent phone/email) ──
  section("Contact-coordinate rule (canonical company details only)")
  ok(V([entry("Call us", "Reach our team on 9848012345 any time")]).violations.some((v) => v.rule === "foreign-phone"),
    "non-canonical phone blocked")
  ok(V([entry("Call us", "Reach our team on +91 8333997227 or WhatsApp +91 8333993223")]).violations.length === 0,
    "canonical call + WhatsApp numbers pass")
  ok(V([entry("Support", "Write to help@rightagent.com for support")]).violations.some((v) => v.rule === "foreign-email"),
    "lookalike email (rightagent.com) blocked")
  ok(V([entry("Support", "Email info@rightagentgroup.com for details")]).violations.length === 0,
    "canonical email passes")
  ok(V([entry("Branch", "Come to our new office near Ameerpet, pincode 560001")]).violations.some((v) => v.rule === "address-drift"),
    "foreign pincode blocked")
  ok(V([entry("Office", "Our office address is 4-143 Mallikarjuna Complex, Gandimaisamma X Road, Hyderabad 500043")]).violations.length === 0,
    "canonical office address passes")
  ok(V([entry("Branch", "We have an office and the address is easy to find")]).warnings.some((w) => w.rule === "address-unanchored"),
    "office mention without canonical anchor warns")
  ok(V([entry("Call us", "Our other-city branch number is 9848012345")], { contactAsWarning: true }).violations.length === 0 &&
     V([entry("Call us", "Our other-city branch number is 9848012345")], { contactAsWarning: true }).warnings.some((w) => w.rule === "foreign-phone"),
    "contactAsWarning downgrades foreign phone to warning (PDF/URL imports)")

  // ── 4. Validator — length warning + basic sanity ──
  section("Length warning (retrieval clips at 800 chars) + sanity")
  ok(V([entry("Long", "x".repeat(801))]).warnings.some((w) => w.rule === "over-length"), "801-char entry warns")
  ok(V([entry("Edge", "x".repeat(800))]).warnings.length === 0, "800-char entry is exactly at the limit, no warning")
  ok(V([entry("", "content here")]).violations.some((v) => v.rule === "missing-title"), "empty title blocked")
  ok(V([entry("Title only", "   ")]).violations.some((v) => v.rule === "missing-content"), "empty content blocked")
  ok(V([entry("Clean", "A perfectly normal, compliant entry about home loans.")]).ok, "clean entry validates ok")

  // ── 5. diffKbPlan / normalizeKbTitle (seed planning) ──
  section("diffKbPlan: idempotent seed planning")
  const existing = [
    { id: 1, title: "Office Address and Contact Details", content: "old content", category: "Contact" },
    { id: 2, title: "Loan products we offer", content: "same text", category: "Loans" },
  ]
  const incoming = [
    { title: "Office address and contact details", content: "new content", category: "Contact" },
    { title: "Loan products we offer", content: "same text", category: "Loans" },
    { title: "Brand new entry", content: "fresh", category: "Compliance" },
  ]
  const plan = rules.diffKbPlan(existing, incoming)
  ok(plan.inserts.length === 1 && plan.inserts[0].title === "Brand new entry", "missing title planned as insert")
  ok(plan.updates.length === 1 && plan.updates[0].id === 1, "changed content planned as update (matched case-insensitively)")
  ok(plan.unchanged === 1, "identical row counted unchanged")
  const rerun = rules.diffKbPlan(
    [
      { id: 1, title: "Office Address and Contact Details", content: "new content", category: "Contact" },
      { id: 2, title: "Loan products we offer", content: "same text", category: "Loans" },
      { id: 3, title: "Brand new entry", content: "fresh", category: "Compliance" },
    ],
    incoming
  )
  ok(rerun.inserts.length === 0 && rerun.updates.length === 0 && rerun.unchanged === 3, "re-run after seed is a no-op (idempotent)")

  // ── 6. CSV parser ──
  section("CSV parser: quote-aware upgrade")
  eq3(csv.parseCsvToEntries("title,content,category\nA,B,C"), [{ title: "A", content: "B", category: "C" }], "basic 3-column row")
  eq3(csv.parseCsvToEntries('title,content\n"T","a, b with comma"'), [{ title: "T", content: "a, b with comma" }], "quoted comma stays in one field")
  eq3(csv.parseCsvToEntries('title,content\n"T","say ""hi"" now"'), [{ title: "T", content: 'say "hi" now' }], "doubled quotes unescape")
  eq3(csv.parseCsvToEntries("question,answer\nQ1,A1"), [{ title: "Q1", content: "A1" }], "flexible headers (question/answer)")
  eq3(csv.parseCsvToEntries("TITLE,CONTENT,CATEGORY\r\nA,B,C\r\n"), [{ title: "A", content: "B", category: "C" }], "CRLF + case-insensitive headers")
  eq3(csv.parseCsvToEntries("title,content\nA,B\n,x\nC,"), [{ title: "A", content: "B" }], "rows missing title or content skipped")
  eq3(csv.parseCsvToEntries('title,content\nA,"line1\nline2"'), [{ title: "A", content: "line1\nline2" }], "quoted newline stays one row")
  ok(csv.parseCsvToEntries("no correct headers here\na,b") .length === 0, "CSV without title/content headers yields nothing")
  function eq3(actual, expected, name) {
    ok(JSON.stringify(actual) === JSON.stringify(expected), `${name}${JSON.stringify(actual) === JSON.stringify(expected) ? "" : ` — got ${JSON.stringify(actual)}`}`)
  }

  // ── 7. The shipped seed CSV itself ──
  section("Shipped kb-right-agent-group.csv follows the script's strict rules")
  const csvText = fs.readFileSync(path.join(ROOT, "kb-right-agent-group.csv"), "utf8")
  const shipped = csv.parseCsvToEntries(csvText)
  ok(shipped.length >= 13, `curated KB has 13 entries (got ${shipped.length})`)
  const normTitles = shipped.map((e) => rules.normalizeKbTitle(e.title))
  ok(new Set(normTitles).size === shipped.length, "all entry titles unique (idempotent seed matching works)")
  const shipV = V(shipped)
  ok(shipV.violations.length === 0, `zero compliance violations in shipped CSV${shipV.violations[0] ? ` — first: [${shipV.violations[0].rule}] ${shipV.violations[0].message}` : ""}`)
  ok(shipV.warnings.length === 0, `zero warnings in shipped CSV${shipV.warnings[0] ? ` — first: [${shipV.warnings[0].rule}] ${shipV.warnings[0].message}` : ""}`)
  ok(shipped.every((e) => e.content.length <= rules.KB_MAX_SNIPPET), "every entry fits the retrieval snippet (no cut-off facts)")
  ok(shipped.every((e) => (e.category || "").trim().length > 0), "every entry categorized")
  const allPhones = shipped.flatMap((e) => rules.extractPhones(`${e.title}\n${e.content}`))
  ok(allPhones.length > 0 && allPhones.every((p) => rules.KB_CANON.phoneLast10.includes(p)), "every phone in the KB is a canonical company number")
  const allEmails = shipped.flatMap((e) => rules.extractEmails(`${e.title}\n${e.content}`))
  ok(allEmails.length > 0 && allEmails.every((e) => e === rules.KB_CANON.email), "every email in the KB is the canonical company email")
  const titlesLower = normTitles.join(" | ")
  ok(titlesLower.includes("documents required"), "KB covers documents required (script promises this answer)")
  ok(titlesLower.includes("grievance"), "KB covers grievance redressal (script directs complaints to the office)")
  ok(titlesLower.includes("fraud safety"), "KB covers fraud/OTP safety (script's fraud answer is grounded)")
  ok(titlesLower.includes("do not call"), "KB covers do-not-call policy (script's DND handling is grounded)")
  ok(csvText.includes("7.25"), "rates entry intact (SBI 7.25 anchor)")

  // ── 8. Ingest routes enforce the gate ──
  section("All ingest routes enforce the compliance gate")
  const readRepo = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")
  const kbRoute = readRepo("app/api/knowledge-base/route.ts")
  ok(kbRoute.includes('from "@/lib/kb-rules"'), "manual POST route imports the validator")
  ok((kbRoute.match(/validateKbEntries/g) || []).length >= 2, "manual route validates BOTH create (POST) and edit (PATCH)")
  ok((kbRoute.match(/status: 422/g) || []).length >= 2, "manual route returns 422 on POST and PATCH violations")
  const csvRoute = readRepo("app/api/knowledge-base/upload-csv/route.ts")
  ok(csvRoute.includes("validateKbEntries") && csvRoute.includes("status: 422"), "CSV upload enforces strict rules with 422")
  const pdfRoute = readRepo("app/api/knowledge-base/upload-pdf/route.ts")
  ok(pdfRoute.includes("validateKbEntries") && pdfRoute.includes("contactAsWarning: true") && pdfRoute.includes("status: 422"),
    "PDF upload enforces with third-party contact relaxation")
  const urlRoute = readRepo("app/api/knowledge-base/fetch-url/route.ts")
  ok(urlRoute.includes("validateKbEntries") && urlRoute.includes("contactAsWarning: true") && urlRoute.includes("status: 422"),
    "URL fetch enforces with third-party contact relaxation")
  const kbIngest = readRepo("lib/kb-ingest.ts")
  ok(kbIngest.includes('from "./csv-parse"'), "kb-ingest re-exports the pure CSV parser (backward-compatible)")

  // ── 9. Channels ground answers in the KB; script anchors to knowledge context ──
  section("Script ↔ KB grounding contracts (calls + WhatsApp + Instagram)")
  ok(readRepo("lib/voice-conversation.ts").includes('searchKnowledgeBase'), "voice calls inject KB context")
  ok(readRepo("app/api/whatsapp/route.ts").includes("searchKnowledgeBase"), "WhatsApp injects KB context")
  ok(readRepo("app/api/instagram/route.ts").includes("searchKnowledgeBase"), "Instagram injects KB context")
  const script = readRepo("lib/default-scripts.ts")
  ok(script.includes("NEVER invent rates or figures not given in your knowledge context"), "script HARD RULE anchors figures to the KB")
  ok(script.includes("When KNOWLEDGE CONTEXT is provided with the answer"), "script instructs direct answering from KB context")
  ok(script.includes("Never invent a separate complaint email or phone number"), "script forbids invented complaint coordinates (validator R3)")
  const kbLib = readRepo("lib/knowledge-base.ts")
  const snippetMatch = kbLib.match(/const MAX_SNIPPET = (\d+)/)
  ok(snippetMatch && Number(snippetMatch[1]) === rules.KB_MAX_SNIPPET,
    `retrieval clip length stays in lockstep with validator (MAX_SNIPPET=${snippetMatch ? snippetMatch[1] : "?"} vs KB_MAX_SNIPPET=${rules.KB_MAX_SNIPPET})`)
  ok(kbLib.includes("never mention"), "KB context injection keeps its do-not-reveal instruction")

  // ── 10. Seed script contracts ──
  section("Seed script (npm run seed:kb)")
  const seed = readRepo("scripts/seed-knowledge-base.js")
  ok(seed.includes("require.main === module"), "seed is importable by tests (main guard)")
  ok(seed.includes("validateKbEntries") && seed.includes("diffKbPlan") && seed.includes("normalizeKbTitle"), "seed validates compliance + plans idempotently")
  ok(seed.includes('"BEGIN"') && seed.includes('"COMMIT"') && seed.includes('"ROLLBACK"'), "seed writes are transactional")
  ok(seed.includes("--dry-run"), "seed supports dry-run planning")
  ok(seed.includes('"kb-rules.ts"') && seed.includes('"csv-parse.ts"'), "seed compiles the exact pure libs this suite tests")
  const pkg = JSON.parse(readRepo("package.json"))
  ok(pkg.scripts["seed:kb"] === "node scripts/seed-knowledge-base.js", "package.json exposes seed:kb")
  ok(readRepo("DEPLOYMENT-GUIDE.md").includes("npm run seed:kb"), "DEPLOYMENT-GUIDE documents the seed step")

  // ── Summary ──
  console.log(`\n════════════════════════════════`)
  console.log(`  ${passed} passed, ${failed} failed`)
  console.log(`════════════════════════════════`)
  if (failed > 0) process.exit(1)
} catch (e) {
  console.error(`\n❌ Suite crashed: ${e.stack || e.message}`)
  process.exit(1)
}
