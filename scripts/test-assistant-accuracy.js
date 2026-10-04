#!/usr/bin/env node
/**
 * Regression tests for the AI Operations Commander ACCURACY GUARDRAIL:
 * lib/assistant-grounding.ts + its integration in app/api/assistant/route.ts.
 *
 * Owner directive (2026-10-04): the Commander must give ONLY correct answers —
 * never assumed or invented figures. The guarantee is mechanical: every number
 * in a draft reply must trace back to the verified corpus (live dashboard
 * snapshot, search results, code-computed financial math, or the operator's
 * own message/history) before the reply is delivered. A reply with any
 * untraceable figure is withheld entirely and replaced with an honest notice.
 *
 * The validator functions are imported and executed directly (not just
 * text-matched) so the exact matching rules — Indian magnitude words, comma
 * grouping, phone space-joins, currency-attached small numbers — are locked.
 *
 * Run: node scripts/test-assistant-accuracy.js
 */
"use strict"
const fs = require("fs")
const path = require("path")
const { registerHooks } = require("node:module")

const ROOT = path.join(__dirname, "..")
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

// finance.ts-style direct TS loading (see scripts/test-maths.js for the
// origin of this hook — extensionless TS imports need the resolver retry).
let registerOK = true
try {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (e) {
        if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js")) {
          return nextResolve(specifier + ".ts", context)
        }
        throw e
      }
    },
  })
} catch {
  registerOK = false
}

let g
try {
  g = require("../lib/assistant-grounding.ts")
} catch (e) {
  console.error("cannot load TS directly:", e.message)
  process.exit(1)
}
if (!registerOK) console.log("note: resolve hook unavailable — direct-path loads used")

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name) } }

// ─────────────────── expandMagnitudes ───────────────────
console.log("── expandMagnitudes: Indian magnitude words ──")
ok("5 lakh → 500000", g.expandMagnitudes("loan of 5 lakh") === "loan of 500000")
ok("5 LAKH case-insensitive", g.expandMagnitudes("5 LAKH") === "500000")
ok("12 lacs → 1200000", g.expandMagnitudes("12 lacs") === "1200000")
ok("2.5 crore → 25000000", g.expandMagnitudes("2.5 crore") === "25000000")
ok("80k → 80000", g.expandMagnitudes("salary 80k") === "salary 80000")
ok("3 thousand → 3000", g.expandMagnitudes("3 thousand records") === "3000 records")
ok("non-magnitude untouched", g.expandMagnitudes("top 5 leads") === "top 5 leads")
ok("non-word 'cr' untouched (5 credit)", g.expandMagnitudes("5 credit cards") === "5 credit cards")

// ─────────────────── grounded replies ───────────────────
console.log("── checkReplyGrounded: figures traced to verified data ──")
const corpus = g.buildAllowedCorpus([
  "LIVE DATA SNAPSHOT:",
  "--- LEADS ---\nTotal: 342 | New today: 12\nBy status: new=180, qualified=40, lost=60",
  "--- LOAN APPLICATIONS ---\nRahul Verma — Home ₹12,00,000 (underwriting)",
  "Rahul Verma (+919876543210) — callback, score 85",
  "FINANCIAL MATH: EMI = 23,540.11 for 20 lakh home loan",
])

ok("exact totals pass", g.checkReplyGrounded("You have 342 leads in total, with 12 new today.", corpus).grounded)
ok("Indian comma grouping matches plain digits", g.checkReplyGrounded("The application is for ₹12,00,000.", corpus).grounded)
ok("₹12 lakh matches ₹12,00,000 (magnitude expansion)", g.checkReplyGrounded("Rahul's home loan of ₹12 lakh is in underwriting.", corpus).grounded)
ok("code-computed EMI passes", g.checkReplyGrounded("Your EMI is ₹23,540.11 per month.", corpus).grounded)
ok("plain digits match comma-grouped corpus", g.checkReplyGrounded("The amount is 1200000 rupees.", corpus).grounded)
ok("name + score traced", g.checkReplyGrounded("Rahul Verma has a score of 85 and status callback.", corpus).grounded)
ok("no numbers at all → grounded", g.checkReplyGrounded("I don't have verified data for that in the dashboard right now.", corpus).grounded)
ok("day/month/time small ints tolerated (non-currency)", g.checkReplyGrounded("I can call them on the 15th at 10:30 to follow up.", corpus).grounded)
ok("year tolerated (non-currency)", g.checkReplyGrounded("This pipeline view has been tracked since 2024.", corpus).grounded)

console.log("── checkReplyGrounded: phone format variants ──")
ok("10-digit without country code", g.checkReplyGrounded("Call Rahul Verma at 98765 43210.", corpus).grounded)
ok("+91 with spaced groups", g.checkReplyGrounded("Call +91 98765 43210 now.", corpus).grounded)
ok("full 12-digit form", g.checkReplyGrounded("Dial 919876543210 directly.", corpus).grounded)
ok("fabricated 10-digit phone caught", !g.checkReplyGrounded("The other number on file is 9876500011.", corpus).grounded)

console.log("── checkReplyGrounded: fabricated figures withheld ──")
const v512 = g.checkReplyGrounded("You have 512 leads in total.", corpus)
ok("fabricated total caught", !v512.grounded && v512.unverified.includes("512"))
ok("fabricated EMI caught", !g.checkReplyGrounded("Your EMI would be ₹23,999 per month.", corpus).grounded)
ok("model-computed percentage caught (66.7%)", !g.checkReplyGrounded("That is a 66.7% conversion rate.", corpus).grounded)
ok("fabricated lakh amount caught", !g.checkReplyGrounded("Rahul applied for a loan of ₹15 lakh.", corpus).grounded)
ok("currency-attached small number is NOT benign (₹25)", !g.checkReplyGrounded("There is only a ₹25 processing fee.", corpus).grounded)
ok("fabricated score caught", !g.checkReplyGrounded("His score is 91.", corpus).grounded)

// ─────────────────── hasSignificantFigures ───────────────────
console.log("── hasSignificantFigures: badge only for real figures ──")
ok("only small ints → no badge", !g.hasSignificantFigures("Here are the top 5 recent leads."))
ok("prose only → no badge", !g.hasSignificantFigures("I don't have verified data for that right now."))
ok("currency amount → badge", g.hasSignificantFigures("The application is for ₹12,00,000."))
ok("significant count → badge", g.hasSignificantFigures("You have 342 leads in total."))

// ─────────────────── delivered-text constants ───────────────────
console.log("── delivered-text constants are honest and number-free ──")
ok("fallback explains the withholding", g.UNVERIFIED_REPLY_FALLBACK.includes("withheld") && g.UNVERIFIED_REPLY_FALLBACK.includes("Rephrase"))
ok("fallback itself contains no digits (nothing assumed)", !/\d/.test(g.UNVERIFIED_REPLY_FALLBACK))
ok("badge states verification", g.VERIFIED_BADGE.includes("verified") && g.VERIFIED_BADGE.includes("live dashboard data"))
ok("badge contains no digits", !/\d/.test(g.VERIFIED_BADGE))
ok("rules forbid model arithmetic", g.ACCURACY_RULES.includes("ZERO ARITHMETIC"))
ok("rules require verified figures only", g.ACCURACY_RULES.includes("VERIFIED FIGURES ONLY"))
ok("rules forbid guessing", g.ACCURACY_RULES.includes("NO GUESSING"))
ok("rules announce the mechanical check", g.ACCURACY_RULES.includes("mechanically verified"))

// ─────────────────── route integration ───────────────────
console.log("── route integration: verify BEFORE delivery ──")
const route = read("app/api/assistant/route.ts")
ok("grounding rules injected into the model context", route.includes("[SYSTEM_PROMPT, ACCURACY_RULES, snapshot, searchResults, mathGrounding]"))
ok("verified corpus built from snapshot + search + math + user words + history", route.includes("buildAllowedCorpus(["))
ok("reply verified before delivery", route.includes("checkReplyGrounded(rawReply, groundCorpus)"))
ok("unverified reply replaced with honest fallback", route.includes("delivered = UNVERIFIED_REPLY_FALLBACK"))
ok("passing replies carry the verification badge", route.includes("VERIFIED_BADGE"))
ok("raw model deltas are never forwarded unverified", !route.includes("(delta) => controller.enqueue"))
ok("what is persisted is what was delivered", route.includes("ownedChatId, userContent, delivered]"))
ok("action proposals skip the numeric gate (admin-reviewed drafts)", route.includes("hasProposal"))

// ─────────────────── response style + markdown UI ───────────────────
console.log("── response style + markdown UI ──")
const qchat = read("components/dashboard/quick-chat.tsx")
const md = read("components/dashboard/chat-markdown.tsx")
ok("assistant replies render through the markdown renderer", qchat.includes("<ChatMarkdown content={cleanText} />"))
ok("user messages stay plain text", qchat.includes('msg.role === "assistant" ? ('))
ok("renderer never injects raw HTML (untrusted model output)", !md.includes("dangerouslySetInnerHTML={{"))
ok("renderer parses headings", md.includes("#{1,4}"))
ok("renderer parses code fences", md.includes("```"))
ok("renderer emits list items", md.includes("<li"))
ok("bold rendered as strong, not raw asterisks", md.includes("<strong"))
ok("verification badge styled as a chip", md.includes("✅"))
ok("prompt: first line answers the exact request", route.includes("ANSWER THE REQUEST GIVEN"))
ok("prompt: concise default under 120 words", route.includes("under 120 words"))
ok("prompt: no filler openers", route.includes("no filler"))
ok("withheld notice stays short and number-free", !/\d/.test(g.UNVERIFIED_REPLY_FALLBACK) && g.UNVERIFIED_REPLY_FALLBACK.length < 700)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
