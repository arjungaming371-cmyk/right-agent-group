#!/usr/bin/env node
/**
 * Regression tests for Instagram Leads Separation (2026-09-26).
 *
 *   • lib/phone.ts extractIndianMobile — the DM phone detector. The plan's
 *     one-line regex /\b[6-9]\d{9}\b/ missed "+919876543210" and "98765
 *     43210" (the most common Indian formats); the shipped detector walks
 *     digit runs instead. Locked here against the whole matrix.
 *   • lib/ig-promote.ts — PII guards locked by source inspection: advisory
 *     lock, phone_key collision check, 23505 → conflict (never a crash),
 *     NO identity merge on collision, form-link welcome, opt-in queueing.
 *   • Webhook — auto-promotion lives in the DM path ONLY; the comment path
 *     must never promote (public PII, unreliable).
 *   • /api/leads — scope lanes (crm default / social / all), the count
 *     branch honors the same scope, and PATCH cannot mass-assign the lane
 *     flags.
 *   • Schema — migration + local-setup.sql freshness (3 columns, partial
 *     indexes, IG_% backfill).
 *   • UI — lane tabs + Convert modal in leads-view, prospect pill + promote
 *     flow in instagram-view, qualification ask in the DM script default.
 *
 * Run: node scripts/test-ig-separation.js
 */
"use strict"
const fs = require("fs")
const path = require("path")
const Module = require("module")
const { execSync } = require("child_process")

const ROOT = path.join(__dirname, "..")
const BUILD = path.join(__dirname, ".ig-build")

// lib/phone.ts is dependency-free, but the emitted module still runs through
// the same alias resolution the other suites use (future-proof).
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) {
    request = path.join(BUILD, request.replace(/^@\//, "") + ".js")
  }
  return origResolve.call(this, request, ...args)
}

execSync("npx tsc -p scripts/tsconfig.ig.json", { cwd: ROOT, stdio: "pipe" })

const phone = require(path.join(BUILD, "lib/phone.js"))

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name) } }
function eq(name, actual, expected) {
  const a = typeof actual === "string" ? actual : JSON.stringify(actual)
  const e = typeof expected === "string" ? expected : JSON.stringify(expected)
  if (a === e) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name, "→ got:", a, "want:", e) }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

console.log("\n— extractIndianMobile: the formats Indians actually type —")
for (const [label, input, expected] of [
  ["bare 10 digits", "9876543210", "+919876543210"],
  ["spaced (most common)", "98765 43210", "+919876543210"],
  ["hyphenated", "98765-43210", "+919876543210"],
  ["+91 with space", "+91 98765 43210", "+919876543210"],
  ["+91 compact (no word boundary)", "+919876543210", "+919876543210"],
  ["0 trunk prefix", "09876543210", "+919876543210"],
  ["parenthesised", "(98765) 43210", "+919876543210"],
  ["inside a sentence", "my number is 98765 43210 bro", "+919876543210"],
  ["trailing punctuation", "it's 9876543210.", "+919876543210"],
  ["multiple numbers → first valid", "alt 91234 56789, main 98765 43210", "+919123456789"],
  ["telugu/hindi mixed text", "నా number 98765 43210 పంపండి", "+919876543210"],
]) {
  const got = phone.extractIndianMobile(input)
  eq(label, got ? got.phone : null, expected)
}

console.log("\n— extractIndianMobile: things that must NEVER be a phone —")
for (const [label, input] of [
  ["landline-ish starting 1", "1234567890"],
  ["14-digit concatenated run", "98765432109876"],
  ["6-digit OTP", "123456"],
  ["₹50,00,000 amount", "₹50,00,000"],
  ["₹1,00,00,000 amount", "₹1,00,00,000"],
  ["12-digit Aadhaar-style", "234567890123"],
  ["11 digits not 0-prefixed", "98765432101"],
  ["empty string", ""],
  ["plain words", "send me the rates please"],
]) {
  eq(label, phone.extractIndianMobile(input), null)
}
eq("raw text preserved for ig_phone_extracted", phone.extractIndianMobile("98765 43210").raw, "98765 43210")

console.log("\n— migration + schema freshness —")
const mig = read("migrations/2026-09-26_instagram_separation.sql")
ok("adds is_social_prospect", mig.includes("is_social_prospect BOOLEAN NOT NULL DEFAULT false"))
ok("adds promoted_to_crm_at", mig.includes("promoted_to_crm_at TIMESTAMPTZ"))
ok("adds ig_phone_extracted", mig.includes("ig_phone_extracted TEXT"))
ok("crm partial index", mig.includes("idx_leads_crm_pipeline") && mig.includes("WHERE is_social_prospect = false"))
ok("social partial index", mig.includes("idx_leads_social_pipeline") && mig.includes("WHERE is_social_prospect = true"))
ok("backfill covers BOTH IG sources", mig.includes("'Instagram DM', 'Instagram Comment'"))
ok("backfill catches legacy fabricated IG_ phones", mig.includes("phone LIKE 'IG%'"))
ok("strips fabricated phones to NULL", /SET phone = NULL[\s\S]*phone LIKE 'IG%'/.test(mig))
ok("stamps promoted_to_crm_at on already-phonened IG rows", mig.includes("promoted_to_crm_at = COALESCE(updated_at, created_at, now())"))
ok("rollback exists", fs.existsSync(path.join(ROOT, "migrations/2026-09-26_instagram_separation_rollback.sql")))
const setup = read("local-setup.sql")
ok("local-setup.sql mirrors the columns", setup.includes("is_social_prospect BOOLEAN NOT NULL DEFAULT false") && setup.includes("ig_phone_extracted TEXT"))
ok("local-setup.sql mirrors the partial indexes", setup.includes("idx_leads_crm_pipeline") && setup.includes("idx_leads_social_pipeline"))

console.log("\n— lib/ig-promote.ts: the PII-safe promotion engine —")
const promote = read("lib/ig-promote.ts")
ok("advisory lock on the phone key", promote.includes("pg_advisory_xact_lock(hashtext"))
ok("row locked FOR UPDATE", promote.includes("FOR UPDATE"))
ok("collision check via indexed phone_key", promote.includes("phone_key = $1"))
ok("regexp fallback for pre-phone_key DBs", promote.includes("regexp_replace(phone, '\\\\D', '', 'g')"))
ok("23505 unique-race lands as conflict, never a crash", promote.includes('"23505"') && promote.includes("reason: \"conflict\""))
ok("NEVER merges into an existing phone-owner lead", promote.includes("NEVER merge") || promote.includes("PII GUARD"))
ok("promotion is a flag flip in place", promote.includes("is_social_prospect = false") && promote.includes("promoted_to_crm_at = COALESCE(promoted_to_crm_at, now())"))
ok("keeps the raw typed text (ig_phone_extracted)", promote.includes("ig_phone_extracted = COALESCE($3"))
ok("validates Indian mobile range 6-9", promote.includes("/^[6-9]\\d{9}$/"))
ok("welcome sends the loan application form link", promote.includes("sendApplicationLink") && promote.includes("form_links"))
ok("form token is one-time with 14-day TTL", promote.includes("interval '14 days'"))
ok("opt-in call-queue insert is high priority", promote.includes("outbound_queue") && promote.includes("100"))
ok("side effects never throw after COMMIT", promote.includes("best-effort"))

console.log("\n— webhook: DMs promote, comments NEVER do —")
const webhook = read("app/api/instagram/route.ts")
const dmIdx = webhook.indexOf("async function handleInboundDM")
const commentIdx = webhook.indexOf("async function handleInboundComment")
ok("structure sane (DM before comment handler)", dmIdx > 0 && commentIdx > dmIdx)
const dmBody = webhook.slice(dmIdx, commentIdx)
const commentBody = webhook.slice(commentIdx)
ok("DM path calls the auto-qualifier", dmBody.includes("extractIndianMobile") && dmBody.includes("promoteInstagramLead"))
ok("DM path records a conflict note for human review", dmBody.includes("needs human review") || dmBody.includes("Auto-promotion BLOCKED"))
ok("comment path has NO promotion logic", !commentBody.includes("promoteInstagramLead") && !commentBody.includes("extractIndianMobile"))

console.log("\n— /api/leads: lanes, count alignment, PATCH guard —")
const leadsRoute = read("app/api/leads/route.ts")
ok("scope param parsed (crm default / social / all)", leadsRoute.includes('"social"') && leadsRoute.includes('"all"') && leadsRoute.includes("laneScope"))
ok("probe-once for the column (pre-migration safe)", leadsRoute.includes("hasSocialProspectColumn"))
ok("lane filter on the FLAG, not phone IS NOT NULL", leadsRoute.includes("leads.is_social_prospect = $"))
ok("count branch honors the same scope", /searchParams\.get\("count"\)[\s\S]*is_social_prospect = \$2/.test(leadsRoute))
ok("PATCH cannot mass-assign the lane flags", /delete updates\.is_social_prospect[\s\S]*delete updates\.promoted_to_crm_at[\s\S]*delete updates\.ig_phone_extracted/.test(leadsRoute))

console.log("\n— prospect list + promote endpoints —")
const conv = read("app/api/instagram/conversations/route.ts")
ok("conversations expose the lane fields", conv.includes("is_social_prospect") && conv.includes("ig_phone_extracted"))
ok("conversations degrade on pre-migration DBs (42703)", conv.includes('"42703"'))
const igLeads = read("app/api/instagram/leads/route.ts")
ok("prospects lane filters is_social_prospect = true", igLeads.includes("l.is_social_prospect = true"))
ok("prospects lane legacy fallback", igLeads.includes("LEGACY_SELECT") && igLeads.includes("phone LIKE 'IG%'"))
const promoteRoute = read("app/api/instagram/leads/[id]/promote/route.ts")
ok("promote endpoint is role-gated", promoteRoute.includes('requireModuleOrRole(req, "instagram"'))
ok("promote endpoint validates the lead id", promoteRoute.includes("isValidUUID"))
ok("conflict surfaces as 409 phone_conflict", promoteRoute.includes("409") && promoteRoute.includes("phone_conflict"))
ok("branch-scoped (no cross-branch promotion)", promoteRoute.includes("lead not found in your branch"))

console.log("\n— scripts + UI wiring —")
const cs = read("lib/channel-scripts.ts")
ok("DM script carries the qualification ask", cs.includes("Could you share your WhatsApp number"))
ok("DM script never re-asks once the number is known", cs.includes("already shows a phone number"))
const leadsView = read("components/dashboard/leads-view.tsx")
ok("CRM / Instagram Prospects lane tabs", leadsView.includes("Instagram Prospects") && leadsView.includes("scopeTab"))
ok("tab badges hit the scoped count endpoint", leadsView.includes("count=1&scope=social"))
ok("Convert modal posts to the promote endpoint", leadsView.includes("/promote") && leadsView.includes("convertProspect"))
ok("detected phone surfaces on the prospect row", leadsView.includes("Detected:"))
ok("IG origin badge on promoted CRM rows", leadsView.includes("instagram_handle") && leadsView.includes("Instagram origin"))
ok("bulk selection confined to the CRM lane", leadsView.includes('scopeTab === "crm" && selectedIds.length > 0'))
const igView = read("components/dashboard/instagram-view.tsx")
ok("Social Prospect pill in the contact panel", igView.includes("Social Prospect — not in CRM yet"))
ok("promote flow pre-fills the detected number", igView.includes("ig_phone_extracted"))
ok("promote flow handles the 409 conflict", igView.includes("409"))

console.log(`\n${"═".repeat(58)}\n${pass} passed, ${fail} failed\n${"═".repeat(58)}`)
process.exit(fail ? 1 : 0)
