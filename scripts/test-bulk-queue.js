#!/usr/bin/env node
// Regression tests for the 2026-09-26 bulk-calling queue upgrade.
//
// The decision math (auto-retry policy, IST calling-window scheduling,
// status grouping, channel normalization) lives in lib/dialer-logic.ts —
// import-free ON PURPOSE so this suite compiles that exact file with the
// repo's OWN tsc and exercises it directly. No DB, no mocks.
//
// Run: node scripts/test-bulk-queue.js

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")

const ROOT = path.join(__dirname, "..")
const TSC = path.join(ROOT, "node_modules", ".bin", "tsc")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rag-bulk-queue-"))

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
  section("Compiling lib/dialer-logic.ts (repo tsc)")
  execSync(
    `"${TSC}" lib/dialer-logic.ts --outDir "${TMP}" --module commonjs --target es2020 --esModuleInterop --skipLibCheck`,
    { cwd: ROOT, stdio: "pipe" }
  )
  ok(fs.existsSync(path.join(TMP, "dialer-logic.js")), "dialer-logic.ts compiles")
  const dl = require(path.join(TMP, "dialer-logic.js"))

  // ── 1. Auto-retry decision ──
  section("shouldAutoRetry: busy/no-answer re-queue policy")
  eq(dl.shouldAutoRetry("missed", 0, 0, 2), true, "missed + no talk + fresh row → retry")
  eq(dl.shouldAutoRetry("rejected", 0, 0, 2), true, "rejected (WhatsApp decline) → retry")
  eq(dl.shouldAutoRetry("resolved", 0, 0, 2), false, "resolved → never")
  eq(dl.shouldAutoRetry("failed", 0, 0, 2), false, "failed (bad number) → never")
  eq(dl.shouldAutoRetry("voicemail", 0, 0, 2), false, "voicemail → never")
  eq(dl.shouldAutoRetry("missed", 45, 0, 2), false, "45s of conversation → human answered, never")
  eq(dl.shouldAutoRetry("missed", 1, 0, 2), false, "even 1s of talk time → never")
  eq(dl.shouldAutoRetry("missed", 0, 2, 2), false, "retry cap reached → never")
  eq(dl.shouldAutoRetry("missed", 0, 1, 2), true, "one retry used, cap 2 → still retries")
  eq(dl.shouldAutoRetry("missed", 0, 0, 0), false, "auto-retry disabled (max 0) → never")
  eq(dl.shouldAutoRetry(null, 0, 0, 2), false, "unknown outcome → never")
  eq(dl.shouldAutoRetry("missed", 0, -3, 2), true, "negative retry_count (legacy rows) still capped correctly")

  // ── 2. IST calling-window scheduling ──
  section("nextWindowStartMs: pause/resume scheduling in IST (UTC+5:30)")
  const IST = 5.5 * 3600 * 1000
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
  // Helper: build a UTC ms from IST wall-clock parts.
  const istMs = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi, 0, 0) - IST
  // 2026-09-26 is a Saturday.
  ok(DAYS[new Date(istMs(2026, 9, 26, 12, 0)).getUTCDay()] === "sat", "fixture: 2026-09-26 is Saturday")

  // Before opening on an allowed day → same day at start hour.
  const sixAM = istMs(2026, 9, 26, 6, 0)
  eq(dl.nextWindowStartMs(sixAM, 8, ["mon", "tue", "wed", "thu", "fri", "sat"]), istMs(2026, 9, 26, 8, 0), "6:00 IST Sat → 8:00 same day")

  // Exactly at start on an allowed day → strictly AFTER now means the NEXT
  // allowed day (callers only ask this when the window is closed; Monday is
  // allowed, so Tuesday 8:00 is correct fail-forward).
  const mon8AM = istMs(2026, 9, 28, 8, 0)
  eq(dl.nextWindowStartMs(mon8AM, 8, ["mon", "tue", "wed", "thu", "fri", "sat"]), istMs(2026, 9, 29, 8, 0), "at Monday opening → strictly next window (fail-forward)")

  // After close on a weekday → next day 8:00.
  const sat1930 = istMs(2026, 9, 26, 19, 30)
  eq(dl.nextWindowStartMs(sat1930, 8, ["mon", "tue", "wed", "thu", "fri", "sat"]), istMs(2026, 9, 28, 8, 0), "19:30 Sat → Mon 8:00 (skips Sunday)")

  // After close on a weekday → next day 8:00.
  const mon1930 = istMs(2026, 9, 28, 19, 30)
  eq(dl.nextWindowStartMs(mon1930, 8, ["mon", "tue", "wed", "thu", "fri", "sat"]), istMs(2026, 9, 29, 8, 0), "19:30 Mon → Tue 8:00")

  // 7-day window rollover: only Sunday allowed, asked on Saturday → next day.
  const sunOnly = dl.nextWindowStartMs(sat1930, 8, ["sun"])
  eq(sunOnly, istMs(2026, 9, 27, 8, 0), "Sunday-only schedule: Sat 19:30 → Sun 8:00")

  // Later start hour honored (e.g. 10:00 start).
  eq(dl.nextWindowStartMs(istMs(2026, 9, 28, 8, 30), 10, ["mon", "tue", "wed", "thu", "fri", "sat"]), istMs(2026, 9, 28, 10, 0), "8:30 Mon with 10:00 start → 10:00 same day")

  // Result is always a valid future timestamp.
  const now = Date.now()
  const next = dl.nextWindowStartMs(now, 8, ["mon", "tue", "wed", "thu", "fri", "sat"])
  ok(next > now, "next window is strictly in the future")
  ok(next - now <= 8 * 24 * 3600 * 1000, "next window is within 8 days")

  // ── 3. Status grouping (the plan's vocabulary vs the REAL codes) ──
  section("statusGroup: real skip codes fold into the Skipped tab")
  eq(dl.statusGroup("pending"), "pending", "pending")
  eq(dl.statusGroup("dialing"), "dialing", "dialing")
  eq(dl.statusGroup("called"), "called", "called")
  eq(dl.statusGroup("failed"), "failed", "failed")
  eq(dl.statusGroup("cancelled"), "cancelled", "cancelled")
  eq(dl.statusGroup("skipped_dnd_suppressed"), "skipped", "skipped_dnd_suppressed → skipped tab")
  eq(dl.statusGroup("skipped_do_not_call"), "skipped", "skipped_do_not_call → skipped tab")
  eq(dl.statusGroup("skipped_outside_window"), "skipped", "skipped_outside_window → skipped tab")
  eq(dl.statusGroup("some_new_future_code"), "skipped", "unknown codes land in skipped, not the void")

  // ── 4. Channel normalization ──
  section("normalizeChannel: plan vocabulary + aliases, unknown = phone")
  eq(dl.normalizeChannel("phone"), "phone", "phone")
  eq(dl.normalizeChannel("whatsapp_voice"), "whatsapp_voice", "whatsapp_voice")
  eq(dl.normalizeChannel("whatsapp"), "whatsapp_voice", "legacy 'whatsapp' alias")
  eq(dl.normalizeChannel("auto"), "phone", "auto normalizes to phone (auto resolution happens at dial time)")
  eq(dl.normalizeChannel(""), "phone", "empty → phone")
  eq(dl.normalizeChannel(undefined), "phone", "undefined → phone")
  eq(dl.normalizeChannel("carrier-pigeon"), "phone", "nonsense → phone (safe default)")

  // ── 5. Re-queue eligibility ──
  section("isRequeueable: re-queue action vocabulary")
  eq(dl.isRequeueable("failed"), true, "failed")
  eq(dl.isRequeueable("cancelled"), true, "cancelled")
  eq(dl.isRequeueable("skipped_outside_window"), true, "skipped_outside_window")
  eq(dl.isRequeueable("called"), false, "called rows are history, not re-queueable")
  eq(dl.isRequeueable("pending"), false, "pending rows are already queued")
  eq(dl.isRequeueable("dialing"), false, "a live call cannot be re-queued")
} catch (e) {
  failed++
  console.error("❌ SUITE ERROR:", e.message)
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
}

console.log(`\n═══ test-bulk-queue: ${passed} passed, ${failed} failed ═══`)
process.exit(failed ? 1 : 0)
