#!/usr/bin/env node
// Regression contracts for the 2026-10-01 FULL frontend↔backend review.
//
// Every connection in the dashboard was audited client-side vs server-side
// (method, path, payload fields, response shapes, error envelopes). The real
// bugs found are pinned here as static contracts on BOTH sides of each
// connection, so a future edit that re-introduces the mismatch fails fast.
// No DB, no network — pure source contracts (repo test-suite convention).
//
// Run: node scripts/test-api-contracts.js

const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
let passed = 0
let failed = 0

function read(rel) {
  // CRLF-normalized (same habit as test-call-quality)
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
}
function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.error(`  ❌ ${name}`)
  }
}
function has(src, needle, name) {
  ok(src.includes(needle), name)
}
function section(title) {
  console.log(`\n— ${title}`)
}

// ── 1. lib/db.ts — lead_id must survive the leads() embed hoist ────────────
section("lib/db.ts: embed hoist restricted to the aliases the query created")
{
  const db = read("lib/db.ts")
  has(
    db,
    "if (k.startsWith(\"lead_\") && (this.joinLeadCols as readonly string[]).includes(base))",
    "hoist only fires for lead_<joinLeadCols> aliases"
  )
  ok(
    !/for \(const k in row\) \{\s*\n\s*if \(k\.startsWith\("lead_"\)\) leads\[/.test(db),
    "no blanket lead_-prefix hoist (used to steal base-table lead_id into leads.id)"
  )
}

// ── 2. Queue radar — aggregate outcomes translated with outcomeGroup ───────
section("queue-view.tsx: radar reads the outcomeGroup vocabulary, not raw DB keys")
{
  const qv = read("components/dashboard/queue-view.tsx")
  has(qv, "const outcomeChips = useMemo(", "aggregate chips memo exists")
  has(qv, 'const key = k === "dialed" ? "dialed" : outcomeGroup(k)', "raw outcomes translated via outcomeGroup (resolved→answered, missed→no_answer)")
  ok(!/outcomes\.answered/.test(qv), "no read of outcomes.answered (server never sends that key)")
  ok(!/outcomes\.no_answer/.test(qv), "no read of outcomes.no_answer (server never sends that key)")
  const proc = read("app/api/outbound/process/route.ts")
  has(proc, "COALESCE(outcome, 'dialed') AS outcome", "server groups by RAW outcome (resolved/missed/rejected/failed/dialed) — client is the translation point")
}

// ── 3. Ops Assistant — history roles + error envelope ──────────────────────
section("app/api/assistant: 'model' role accepted; 400 uses {error}")
{
  const asr = read("app/api/assistant/route.ts")
  has(asr, 'm.role === "assistant" || m.role === "model" ? "assistant" : "user"', "sanitizeHistory maps QuickChat's 'model' turns to assistant")
  has(asr, '{ error: "Please send a valid message." }, { status: 400 }', "400 envelope normalized to {error}")
}

// ── 4. Instagram comment reply — latest INBOUND comment ────────────────────
section("instagram-view.tsx: comment reply targets the newest inbound comment")
{
  const ig = read("components/dashboard/instagram-view.tsx")
  has(
    ig,
    '[...messages].reverse().find((m) => m.direction === "inbound" && m.comment_id)?.comment_id',
    "last inbound comment wins (messages arrive oldest-first; outbound replies also carry comment_id)"
  )
  ok(
    !/commentId: activeConv\?\.last_type === "comment" \? messages\.find\(/.test(ig),
    "old oldest-comment .find() removed"
  )
}

// ── 5. WhatsApp forward — attributed to the target lead ────────────────────
section("whatsapp-view.tsx: forward sends leadId")
{
  const wa = read("components/dashboard/whatsapp-view.tsx")
  has(wa, "body.leadId = target.id", "forward includes leadId (orphan lead_id=NULL row fixed)")
}

// ── 6. Branch create — credentials no longer dropped ───────────────────────
section("app/api/branches POST: create persists the 5 credential fields")
{
  const br = read("app/api/branches/route.ts")
  for (const col of ["exotel_sid", "exotel_api_key", "exotel_api_token", "exotel_flow_app_id", "whatsapp_token"]) {
    has(br, `body?.${col} ? String(body.${col}).trim() : null`, `create reads ${col}`)
  }
  has(br, "exotel_sid, exotel_api_key, exotel_api_token, exotel_flow_app_id,", "INSERT column list carries the credential columns")
  const bv = read("components/dashboard/branches-view.tsx")
  has(
    bv,
    'for (const secret of ["exotel_api_key", "exotel_api_token", "whatsapp_token", "instagram_token"])',
    "blank write-only secrets are stripped client-side (PATCH no longer wipes stored secrets)"
  )
}

// ── 7. API key tester — Exotel is a real provider ──────────────────────────
section("app/api/security/api-keys/test: exotel case")
{
  const t = read("app/api/security/api-keys/test/route.ts")
  has(t, 'if (provider === "exotel")', "exotel branch exists")
  has(t, "EXOTEL_API_KEY", "checks EXOTEL_API_KEY presence")
  has(t, "/v1/Accounts/", "real account ping against the Exotel REST API")
  ok(t.indexOf('provider === "exotel"') < t.indexOf('"Unknown provider"'), "exotel handled before the Unknown-provider fallthrough")
}

// ── 8. Command palette — real loan column names ────────────────────────────
section("command-palette.tsx: searches pan_number / aadhaar_number")
{
  const cp = read("components/ui/command-palette.tsx")
  has(cp, "a.pan_number, a.aadhaar_number", "loan search uses the actual row columns")
  ok(!/a\.pan\b/.test(cp) && !/a\.aadhaar\b/.test(cp), "phantom a.pan / a.aadhaar reads removed")
}

// ── 9. System status — honest tooltips ─────────────────────────────────────
section("system-status.tsx: no invented fields; real unread count")
{
  const ss = read("components/dashboard/system-status.tsx")
  ok(!ss.includes("activeCalls"), "phantom activeCalls read removed (GET /api/system/status never sent it)")
  has(ss, 'fetch("/api/whatsapp/unread")', "unread wired to the endpoint that actually returns {count}")
  ok(!/whatsappData\?\.unread/.test(ss), "no read of whatsappData.unread (GET /api/whatsapp/status never sent it)")
}

// ── 10. Bulk console — control actions work outside the calling window ─────
section("app/api/outbound/process POST: stop/reset-failed run BEFORE the window guard")
{
  const proc = read("app/api/outbound/process/route.ts")
  const stop = proc.indexOf('if (body.action === "stop")')
  const reset = proc.indexOf('if (body.action === "reset-failed")')
  const paused = proc.indexOf("isWithinCallingWindow()")
  ok(stop > -1 && reset > -1 && paused > -1, "all three blocks present")
  ok(stop < paused && reset < paused, "stop + reset-failed are window-independent (paused guard only gates DIALING)")
}

// ── 11. Upload console — paused responses surfaced honestly ────────────────
section("upload-view.tsx: {paused:true} handled in dial/start handlers")
{
  const uv = read("components/dashboard/upload-view.tsx")
  ok(uv.split("data.paused").length - 1 >= 2, "batch dial + campaign start both handle paused (no more 'Dialed undefined/undefined')")
}

// ── 12. Public loan form — used-link screen reachable + email required ─────
section("app/form/[token]: used checked before valid; required.email enforced")
{
  const fp = read("app/form/[token]/page.tsx")
  ok(fp.indexOf("if (data.used)") < fp.indexOf("if (!data.valid)"), "consumed link shows 'Already submitted', not 'Link not valid'")
  has(fp, 'config.required_fields?.email && !form.email?.trim()', "Required-email toggle is actually validated")
}

// ── 13. Voice assistant — action execution gated like the server ───────────
section("voice-assistant.tsx: Approve/Execute only for admin/developer")
{
  const va = read("components/dashboard/voice-assistant.tsx")
  has(va, 'const canExecuteActions = role === "admin" || role === "developer"', "client gate mirrors POST /api/assistant/action allowlist")
  ok(va.split("canExecuteActions ?").length - 1 >= 2, "both proposal buttons gated")
}

// ── 14. Voice Studio — no duplicate catalog cards / React keys ──────────────
section("voice-studio-view.tsx: catalog deduped by provider:voiceId")
{
  if (fs.existsSync(path.join(ROOT, "components/dashboard/voice-studio-view.tsx"))) {
    const vs = read("components/dashboard/voice-studio-view.tsx")
    has(vs, "const seen = new Set<string>()", "dedupe pass exists")
    has(vs, "if (seen.has(k)) continue", "duplicate preset/account voices collapse (custom wins)")
  } else {
    ok(true, "voice studio view intentionally removed per platform config")
  }
}

// ── 15. Calendar — timezone-safe month window ──────────────────────────────
section("calendar-view.tsx: month bounds sent as UTC instants of LOCAL month")
{
  const cal = read("components/dashboard/calendar-view.tsx")
  has(cal, "new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1).toISOString()", "from = local month start as ISO instant")
  has(cal, "new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1).toISOString()", "to = next local month start as ISO instant")
}

// ── 16. Silent failures now surface ────────────────────────────────────────
section("res.ok discipline: developer logs + loan status + branch mutations")
{
  has(read("components/dashboard/developer-logs-view.tsx"), "if (!res.ok) return", "developer logs: 401/500 no longer renders as 'No activity yet'")
  has(read("components/dashboard/loan-apps-view.tsx"), "if (!r.ok) {\n        const d = await r.json().catch(() => ({}))\n        toast.error(d.error || \"Could not update the loan status\")", "loan PATCH failures toast instead of silently reverting")
  const bv = read("components/dashboard/branches-view.tsx")
  ok(bv.split("Could not delete").length >= 2, "branch delete surfaces the server's 409 blocker message")
  ok(bv.split("Network error — try again").length >= 2, "branch status toggle surfaces failures")
}

// ── 17. Call Queue talking points — "What should Priya talk about?" ────────
// The agenda must survive EVERY hop: queue entry (CSV confirm / Add Single /
// campaign start) → outbound_queue.talking_points → claimPendingRows RETURNING
// → dialQueueRow → placeOutboundCall({instructions}) → voice_calls.instructions
// → /api/calls/turn → buildTurnInstructions framing. The bulk path used to
// drop the field entirely (single dials kept it, campaigns lost it).
section("call-queue talking points: the agenda rides queue rows into Priya's brain")
{
  // Schema: migration + rollback + local-setup mirror.
  const mig = read("migrations/2026-10-01_queue_talking_points.sql")
  has(mig, "ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS talking_points TEXT;", "migration adds outbound_queue.talking_points")
  has(read("migrations/2026-10-01_queue_talking_points_rollback.sql"), "ALTER TABLE outbound_queue DROP COLUMN IF EXISTS talking_points;", "rollback drops the column")
  has(read("local-setup.sql"), "ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS talking_points TEXT;", "local-setup mirrors the column")

  // Queue entry — batch mode stamps the campaign agenda on every row.
  const ob = read("app/api/outbound/route.ts")
  has(ob, "function campaignTalkingPoints(v: unknown): string | null", "sanitize helper: 1000-char cap, null when blank")
  has(ob, "const campaignPoints = campaignTalkingPoints(body.talking_points)", "batch mode reads the campaign-level agenda")
  has(ob, "talking_points: campaignTalkingPoints((contact as Record<string, unknown>).talking_points) ?? campaignPoints,", "per-contact agenda wins over the campaign-level text")
  has(ob, "talking_points: talkingPoints,", "single mode stamps the queue row")
  has(ob, "instructions: talkingPoints,", "single mode persists voice_calls.instructions (what /api/calls/turn reads)")

  // Runner — claim → dial → start-stamp.
  const pr = read("app/api/outbound/process/route.ts")
  ok(
    (pr.match(/retry_count, talking_points`/g) || []).length === 2,
    "BOTH claim queries RETURNING include talking_points (primary + reaper fallback)"
  )
  has(pr, "instructions: item.talking_points ?? null,", "dialQueueRow forwards the row's agenda to placeOutboundCall")
  has(pr, "const campaignPoints = sanitizeText(body.talking_points, 1000)", "start action reads + caps the campaign agenda")
  has(pr, "UPDATE outbound_queue SET talking_points = $2\n          WHERE status = 'pending' AND ($1::uuid IS NULL OR branch_id = $1)", "start stamps every pending row in scope BEFORE the runner claims them")
  ok(pr.indexOf("const campaignPoints = sanitizeText(body.talking_points, 1000)") < pr.indexOf("await dialer.start("), "stamping happens BEFORE dialer.start() (claimed rows must already carry the agenda)")
  ok(
    pr.indexOf("console.error(\"talking_points stamp failed") > -1,
    "stamp failure degrades to agenda-less dialing instead of blocking the campaign"
  )

  // The dial leg persists instructions for BOTH channels (WhatsApp + phone).
  const od = read("lib/outbound-dial.ts")
  ok(
    (od.match(/instructions: opts\.instructions \?\? null,/g) || []).length === 2,
    "placeOutboundCall persists instructions on BOTH channel inserts (whatsapp + phone)"
  )

  // Brain — the raw agenda is framed, never read like Priya's own thought.
  const vc = read("lib/voice-conversation.ts")
  has(vc, "WHAT THIS CALL IS ABOUT", "buildTurnInstructions frames the agenda explicitly")
  has(vc, "never recite them word-for-word", "anti-robotic-recital rule present")
  ok(!/let merged = instructions \|\| ""/.test(vc), "no raw unlabeled instructions left (used to read like Priya's own thought)")

  // Call Queue UI — the textarea exists and start/dial-now both send it.
  const qv = read("components/dashboard/queue-view.tsx")
  ok((qv.match(/What should Priya talk about\?/g) || []).length >= 1, "Call Queue shows the agenda box")
  has(qv, "talking_points: talkPoints.trim() || undefined", "Start Campaign sends the agenda")
  has(qv, "instructions: item.talking_points || undefined", "Dial now keeps the row's agenda")
  has(qv, "talking_points?: string | null", "QueueItem type carries the field for per-row display")
  has(qv, "Talk: {item.talking_points}", "queue table shows the agenda under the phone")

  // Upload console — same agenda on CSV confirm, single add and bulk start.
  const uv = read("components/dashboard/upload-view.tsx")
  ok((uv.match(/What should Priya talk about\? <span/g) || []).length === 3, "all three entry surfaces show the agenda box (CSV modal, single form, bulk panel)")
  has(uv, "talking_points: previewTalkPoints.trim() || undefined", "CSV confirm sends the agenda")
  has(uv, "talking_points: queueTalkPoints.trim() || undefined", "Add Single sends the agenda")
  has(uv, "talking_points: bulkTalkPoints.trim() || undefined", "Call Entire Queue sends the agenda")
  has(uv, "Talk: {r.talking_points}", "upload queue table shows the agenda")
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
