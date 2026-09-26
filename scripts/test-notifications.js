#!/usr/bin/env node
/** Tests for the notifications fixes. Run: node scripts/test-notifications.js */
"use strict"
const { execSync } = require("child_process")
const path = require("path")

const ROOT = path.join(__dirname, "..")
// lib/notifications.ts imports "./db" which uses the "@/lib/logger" alias —
// bare tsc can't see that, so compile through a tiny tsconfig that extends
// the root one (it carries the paths mapping).
execSync(
  "npx tsc -p scripts/tsconfig.notif.json",
  { cwd: ROOT, stdio: "pipe" }
)
const mod0dir = path.join(__dirname, ".notif-build")
// tsc resolves "@/lib/*" via tsconfig paths at compile time but does NOT
// rewrite the emitted require() calls — hook the resolver so the compiled
// db.js/logger.js can load at runtime.
const Module = require("module")
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith("@/")) {
    request = path.join(mod0dir, request.replace(/^@\//, ""))
  }
  return origResolve.call(this, request, ...args)
}
const mod = require("./.notif-build/lib/notifications.js")

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name) } }

console.log("── isValidNotificationId (PATCH guard) ──")
ok("accepts canonical uuid", mod.isValidNotificationId("1b7d9f6a-3c2e-4a1b-9f0d-8e7c6b5a4321") === true)
ok("accepts uppercase uuid", mod.isValidNotificationId("1B7D9F6A-3C2E-4A1B-9F0D-8E7C6B5A4321") === true)
ok("rejects empty string", mod.isValidNotificationId("") === false)
ok("rejects short string", mod.isValidNotificationId("abc") === false)
ok("rejects sql-ish junk", mod.isValidNotificationId("'; DROP TABLE notifications; --") === false)
ok("rejects non-string", mod.isValidNotificationId(123) === false)
ok("rejects undefined", mod.isValidNotificationId(undefined) === false)

console.log("── exports exist ──")
ok("createNotification exported", typeof mod.createNotification === "function")
ok("createLoginNotificationOncePerDay exported", typeof mod.createLoginNotificationOncePerDay === "function")
ok("pruneNotifications exported", typeof mod.pruneNotifications === "function")

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
