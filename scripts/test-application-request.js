#!/usr/bin/env node
/**
 * Regression tests for the CHAT-REQUESTED LOAN APPLICATION LINK:
 * lib/application-request.ts + the auto-send wiring in app/api/whatsapp
 * (WhatsApp text chat) and app/api/instagram (Instagram DM).
 *
 * Owner directive (2026-10-04): the application link must ALSO go out on
 * WhatsApp chat and Instagram DM when the customer asks for it — closing the
 * gap the 2026-10-04 audit found (calls and IG promotion already auto-sent;
 * the two chat channels did not).
 *
 * The detector is imported and executed directly so the trigger semantics —
 * explicit request only, status questions never re-send, Hinglish/Tenglish
 * covered — are locked, not just grepped.
 *
 * Run: node scripts/test-application-request.js
 */
"use strict"
const fs = require("fs")
const path = require("path")
const { registerHooks } = require("node:module")

const ROOT = path.join(__dirname, "..")
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

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

let det, wa
try {
  det = require("../lib/application-request.ts")
} catch (e) {
  console.error("cannot load TS directly:", e.message)
  process.exit(1)
}
if (!registerOK) console.log("note: resolve hook unavailable — direct-path loads used")

// lib/whatsapp.ts sits in the ./db import chain (db.ts uses a TS parameter
// property that Node's strip-only mode cannot run), so — same as
// test-channel-scripts — compile it with tsc and require the emitted JS.
const Module = require("module")
const { execSync } = require("child_process")
const BUILD = path.join(__dirname, ".appreq-build")
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) {
    request = path.join(BUILD, request.replace(/^@\//, "") + ".js")
  }
  return origResolve.call(this, request, ...args)
}
execSync("npx tsc -p scripts/tsconfig.app-request.json", { cwd: ROOT, stdio: "pipe" })
wa = require(path.join(BUILD, "lib/whatsapp.js"))

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name) } }

const waRoute = read("app/api/whatsapp/route.ts")
const igRoute = read("app/api/instagram/route.ts")
const whatsappLib = read("lib/whatsapp.ts")
const channelScripts = read("lib/channel-scripts.ts")
const notifications = read("lib/notifications.ts")
const bell = read("components/dashboard/notification-bell.tsx")

// ─────────────────── detector: explicit requests fire ───────────────────
console.log("── detectApplicationRequest: explicit requests (EN / Hinglish / Tenglish) ──")
const POSITIVE = [
  // English
  "Can you send me the loan application?",
  "Please share the form",
  "I want to apply for a home loan",
  "How do I apply?",
  "send the application",
  "where can I fill the form",
  "share the form link",
  "I need the application link",
  "form link please",
  // Hinglish
  "form bhejo",
  "application bhej do sir",
  "application chahiye",
  "apply karna hai",
  "kaise apply karein",
  // Tenglish
  "form pampandi",
  "application pampandi",
  "ela apply cheyyali",
  "form kavali sir",
]
for (const t of POSITIVE) ok(`fires: "${t}"`, det.detectApplicationRequest(t))

console.log("── detectApplicationRequest: NOT an explicit request ──")
const NEGATIVE = [
  "What is the interest rate?",
  "documents list bhejo",                    // intent verb, wrong subject
  "send me the location",                    // intent verb, no application subject
  "my application status",                   // existing-application conversation
  "application status update chahiye",
  "I already applied last week",
  "my application was submitted yesterday",
  "approved or not sir",
  "what documents for home loan",
  "where is my application",                 // asking about it, not requesting a form
  "hello",
  "EMI calcuate chayandi 5 lakhs",
]
for (const t of NEGATIVE) ok(`quiet: "${t}"`, !det.detectApplicationRequest(t))

ok("empty/null-safe", det.detectApplicationRequest("") === false)

// ─────────────────── lib/whatsapp.ts helpers ───────────────────
console.log("── whatsapp.ts: chat-requested link helpers ──")
ok("createOneTimeFormToken exported", typeof wa.createOneTimeFormToken === "function")
ok("formLinkMessage exported", typeof wa.formLinkMessage === "function")
ok("sendApplicationLinkText exported", typeof wa.sendApplicationLinkText === "function")
ok("recentFormLinkSent exported", typeof wa.recentFormLinkSent === "function")
const token = "11111111-2222-3333-4444-555555555555"
const msg = wa.formLinkMessage("Rahul", token, "Right Agent Group")
ok("form link text carries the one-time URL", msg.includes(`/form/${token}`))
ok("form link text keeps the no-OTP compliance line", msg.includes("We never ask for OTP, PIN, or any payment."))
ok("form link text greets the customer by name", msg.includes("Rahul"))
ok("dedupe query only counts delivered/pending links, not failures", whatsappLib.includes("outcome IN ('sent', 'pending')") && whatsappLib.includes("summary ILIKE '%form link%'"))

// ─────────────────── WhatsApp chat wiring ───────────────────
console.log("── app/api/whatsapp: chat auto-send wiring ──")
ok("imports the detector + helpers", waRoute.includes('from "@/lib/application-request"') && waRoute.includes("createOneTimeFormToken, recentFormLinkSent, sendApplicationLinkText"))
ok("fires only on explicit request + dedupe check", waRoute.includes("detectApplicationRequest(text) && !(await recentFormLinkSent(lead.id))"))
ok("sends the in-window free-form link message", waRoute.includes("sendApplicationLinkText(from, lead.name"))
ok("marks the lead form-sent-not-filled", waRoute.includes('form_completed: false'))
ok("logs the send in Communication Log", waRoute.includes("Loan application form link sent on WhatsApp — requested in chat"))
ok("failed send alerts the operator to share manually", waRoute.includes("Chat-requested form link FAILED — share manually"))
ok("kill switch gates the auto send (messages pause checked earlier in the handler)", waRoute.indexOf('isAiPaused("messages", waBranch?.id || null)') !== -1 && waRoute.indexOf("AUTO APPLICATION LINK") > waRoute.indexOf('isAiPaused("messages", waBranch?.id || null)'))
ok("AI is told to confirm the send is already done", waRoute.includes("confirm it is DONE") && waRoute.includes("delivers it automatically with your reply"))

// ─────────────────── Instagram DM wiring ───────────────────
console.log("── app/api/instagram: DM auto-send wiring ──")
ok("imports the detector + WA senders", igRoute.includes('from "@/lib/application-request"') && igRoute.includes("sendApplicationLink,") && igRoute.includes("formLinkMessage,"))
ok("fires only on explicit request + dedupe check", igRoute.includes("leadId && detectApplicationRequest(text)") && igRoute.includes("recentFormLinkSent(leadId)"))
ok("number on file → real link goes on WhatsApp", igRoute.includes("sendApplicationLink(phoneOnFile, leadRow.name"))
ok("WhatsApp template failure → URL dropped in the DM instead", igRoute.includes("WhatsApp template failed") && igRoute.includes("sendInstagramText(senderId, dmText, igBranch)"))
ok("no number yet → link delivered straight in the DM", igRoute.includes("form link sent in the Instagram DM (no number on file yet"))
ok("DM link messages are recorded in the thread", igRoute.includes("INSERT INTO instagram_messages") && igRoute.split("instagram_messages").length >= 3)
ok("kill switch gates the DM auto send", igRoute.indexOf('isAiPaused("messages", branchId)') !== -1 && igRoute.indexOf("AUTO APPLICATION LINK") > igRoute.indexOf('isAiPaused("messages", branchId)'))
ok("failed sends alert the operator", igRoute.includes("DM-requested form link FAILED — share manually"))

// ─────────────────── persona + notification type ───────────────────
console.log("── persona copy + notification plumbing ──")
ok("IG DM persona: asks→done wording matches the auto-send", channelScripts.includes("tell them it is DONE") && channelScripts.includes("right here in this chat when we don't have their number yet"))
ok("instagram_message notification type registered", notifications.includes('"instagram_message"'))
ok("notification bell renders the IG type (icon + color)", bell.includes("instagram_message") && bell.includes("Instagram"))

// ─────────────────── report ───────────────────
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
