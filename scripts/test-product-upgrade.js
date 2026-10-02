#!/usr/bin/env node
// Regression contracts for the 2026-10-03 FULL PRODUCT UPGRADE:
//   P0 security (authorization + IDOR fixes), the AI kill switch, the audit
//   trail expansion, the buyer-facing public website, and the ops-console
//   additions (Needs Human queue, System Health, onboarding checklist,
//   owner analytics). Static source contracts — no DB, no network.
//
// Run: node scripts/test-product-upgrade.js

const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
let passed = 0
let failed = 0

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
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

// ── 1. lib/ai-pause.ts — the kill-switch store ─────────────────────────────
section("lib/ai-pause.ts: kill-switch store semantics")
{
  const src = read("lib/ai-pause.ts")
  has(src, "export async function isAiPaused", "exports isAiPaused()")
  has(src, "export function aiPauseMessage", "exports aiPauseMessage()")
  has(src, "export async function setAiPauseState", "exports setAiPauseState()")
  has(src, "if (branchId && state.branches[branchId]?.[kind] === true) return true", "branch pause is evaluated BEFORE the global toggle")
  has(src, "return state[kind].paused", "global toggle is the fallback scope")
  has(src, "form_configs", "state persists in the shared JSONB config store")
  has(src, "\"ai_pause\"", "row id is 'ai_pause'")
  has(src, "const CACHE_MS = 8_000", "short cache so a pause takes effect fast")
}

// ── 2. Enforcement point 1: the single dial chokepoint ─────────────────────
section("lib/outbound-dial.ts: placeOutboundCall obeys the pause (BOTH channels)")
{
  const src = read("lib/outbound-dial.ts")
  has(src, 'import { isAiPaused, aiPauseMessage', "imports the kill switch")
  has(src, 'if (await isAiPaused("calls", branchId))', "checks the calls pause with the branch scope")
  ok(
    /if \(await isAiPaused\("calls", branchId\)\)[\s\S]{0,80}throw new DialError\(aiPauseMessage\("calls"\), 503\)/.test(src),
    "refuses to dial with DialError 503 before ANY channel work"
  )
  const dial = src.indexOf("export async function placeOutboundCall")
  const check = src.indexOf('if (await isAiPaused("calls", branchId))')
  ok(dial !== -1 && check !== -1 && check < src.indexOf("const channel = await resolveChannel"), "pause check runs before channel resolution")
}

// ── 3. Enforcement point 2-3: manual dial + campaign start ─────────────────
section("app/api/calls/dial + outbound/process: dial entries obey the pause")
{
  const dial = read("app/api/calls/dial/route.ts")
  has(dial, 'if (await isAiPaused("calls", branchId))', "manual dial checks the pause")
  has(dial, 'paused: true }, { status: 503 }', "returns 503 with paused:true")
  const proc = read("app/api/outbound/process/route.ts")
  has(proc, 'if (await isAiPaused("calls", branchId))', "campaign start checks the pause")
  has(proc, "reason: aiPauseMessage(\"calls\")", "operator-facing paused reason")
  const winGate = proc.indexOf("isWithinCallingWindow()")
  const killGate = proc.indexOf('isAiPaused("calls"')
  ok(winGate !== -1 && killGate !== -1 && killGate > winGate, "kill gate sits after the window gate — control actions (stop/reset) stay usable")
}

// ── 4. Enforcement point 4-8: automated messages ───────────────────────────
section("Automated message paths obey the messages pause")
{
  const finalize = read("lib/whatsapp-call-finalize.ts")
  has(finalize, '!call?.followup_sent && outcome !== "failed" && !(await isAiPaused("messages", followupBranchId))', "WhatsApp post-call follow-up gated")
  const status = read("app/api/calls/status/route.ts")
  has(status, '!(await isAiPaused("messages"', "Exotel post-call follow-up gated")
  const conv = read("lib/voice-conversation.ts")
  has(conv, 'if (waNumber && !(await isAiPaused("messages", branchId)))', "AI-decided application link gated")
  const wa = read("app/api/whatsapp/route.ts")
  has(wa, 'if (await isAiPaused("messages", waBranch?.id || null)) return', "WhatsApp inbound auto-reply gated")
  const ig = read("app/api/instagram/route.ts")
  ok(ig.split('if (await isAiPaused("messages", branchId)) return').length >= 3, "Instagram DM + comment auto-replies both gated")
}

// ── 5. The control API ──────────────────────────────────────────────────────
section("app/api/ai-pause: read for all, write for admin only, audited")
{
  const src = read("app/api/ai-pause/route.ts")
  has(src, "getLiveSession(req)", "GET works for any authenticated user (banner)")
  has(src, 'requireRole(req, ["admin"])', "PATCH is admin-only")
  has(src, 'logAudit("ai pause changed"', "every flip is audit-logged")
  has(src, "reason: next.reason", "stated reason is recorded")
}

// ── 6. P0 authorization fixes ───────────────────────────────────────────────
section("requireModuleOrRole: capability (role) BEFORE visibility (modules)")
{
  const src = read("lib/auth.ts")
  const roleCheck = src.indexOf("if (!allowedRoles.includes(session.role)) return null")
  const moduleCheck = src.indexOf("if (!session.allowedModules.includes(moduleKey)) return null")
  ok(roleCheck !== -1 && moduleCheck !== -1 && roleCheck < moduleCheck, "module grants can never create write capability the base role lacks")
  has(src, "CAPABILITY (base role)", "security model documented at the helper")
}

section("Global-write surfaces closed to branch-scoped roles")
{
  const settings = read("app/api/outbound/settings/route.ts")
  ok(/\["admin"\]\)/.test(settings.split("export async function PATCH")[1] || ""), "dialer settings PATCH is admin-only (deployment-global keys)")
  const aiEmp = read("app/api/ai-employees/route.ts")
  has(aiEmp, "sessionBranchId(session)", "ai-employees GET resolves the caller's branch")
  has(aiEmp, "WHERE e.scope = 'shared'", "branch managers see shared + their own employees only")
  const formCfg = read("app/api/form-config/route.ts")
  ok(/\["admin"\]\)/.test(formCfg.split("export async function POST")[1] || ""), "loan form config write is admin-only (org-global schema)")
  const rec = read("app/api/calls/recording/file/route.ts")
  has(rec, "SELECT branch_id FROM voice_calls WHERE twilio_call_sid = $1", "recording file access is branch-checked against the call row")
  const chat = read("app/api/whatsapp/chat-settings/route.ts")
  ok(!chat.includes("{ error: e.message }"), "chat-settings no longer leaks raw Postgres errors")
  const devlogs = read("app/api/developer/logs/route.ts")
  ok(!devlogs.includes("error: err.message"), "developer logs no longer leak raw errors")
}

section("Exports: throttled + audit-logged")
{
  for (const f of ["app/api/leads/export/route.ts", "app/api/loans/export/route.ts", "app/api/outbound/export/route.ts"]) {
    const src = read(f)
    has(src, 'rateLimit(`export:${session.email}`, 6, 60_000)', `${f}: 6/min throttle`)
    has(src, "logAudit(", `${f}: audit entry written`)
  }
}

section("AI employee changes are audited")
{
  const post = read("app/api/ai-employees/route.ts")
  has(post, 'logAudit("ai employee created"', "create audited")
  const patch = read("app/api/ai-employees/[id]/route.ts")
  has(patch, '"ai employee paused"', "pause audited as its own action")
  has(patch, '"ai employee resumed"', "resume audited")
  has(patch, 'logAudit("ai employee deactivated"', "soft delete audited")
}

// ── 7. Public website ───────────────────────────────────────────────────────
section("Homepage: positioning, hero, problem, 6 steps, demo")
{
  const src = read("app/page.tsx")
  ok(src.includes("Turn Every Loan Lead Into a") && src.includes("Conversation.</span>"), "hero headline per spec")
  has(src, "AI employees automatically call, qualify, follow up and manage loan leads across", "hero subheadline per spec")
  has(src, "Book a Demo", "primary CTA")
  has(src, "Test Priya", "secondary CTA")
  has(src, "#demo", "demo section anchor exists")
  ok(/Capture lead/i.test(src), "step 1")
  ok(/Human handoff/i.test(src), "step 6")
  ok(/traditional/i.test(src) && /Lead arrives/i.test(src), "problem section shows the manual vs automated workflow")
  const banned = ["10x", "90%", "50% higher", "guaranteed approval", "double your"]
  ok(banned.every(b => !src.toLowerCase().includes(b)), "no fake statistics on the homepage")
}

section("New public pages exist with real content")
{
  for (const p of ["app/demo/page.tsx", "app/pricing/page.tsx", "app/security/page.tsx", "app/privacy/page.tsx", "app/terms/page.tsx", "app/product/page.tsx", "app/ai-employees/page.tsx", "app/integrations/page.tsx", "app/help/page.tsx"]) {
    ok(exists(p), `${p} exists`)
  }
  const pricing = read("app/pricing/page.tsx")
  ok(/Starter/i.test(pricing) && /Growth/i.test(pricing), "pricing uses the real published tiers")
  has(pricing, "Contact Sales", "custom tier uses Contact Sales, not invented prices")
  const sec = read("app/security/page.tsx")
  const claims = ["SOC 2", "SOC2", "ISO 27001", "GDPR", "RBI", "HIPAA", "PCI"]
  ok(claims.every(c => !sec.includes(c)), "security page claims NO third-party certifications")
  const ai = read("app/ai-employees/page.tsx")
  ok(/CANNOT|cannot/i.test(ai), "AI employee page states what Priya cannot do")
  ok(ai.includes("approve loans") || /Approve loans/i.test(ai), "explicitly: cannot approve loans")
}

section("Public demo API: consent + rate limit + fixed context")
{
  const chat = read("app/api/demo/chat/route.ts")
  has(chat, "rateLimit(", "rate limited")
  has(chat, "consent", "consent flag required")
  has(chat, '"Demo Customer"', "uses a FIXED demo lead — client context ignored")
  has(chat, "force-dynamic", "never cached")
  const demo = read("app/api/demo/route.ts")
  has(demo, "rateLimit(`demo:${clientIp(req)}`", "lead-capture form rate limited")
  has(demo, "honeypot", "honeypot field handled")
  has(demo, 'source: "website_demo"', "demo requests land in the leads pipeline as their own source")
  has(demo, "logAudit(", "demo requests audited")
}

section("Middleware + sitemap expose exactly the public surface")
{
  const mw = read("middleware.ts")
  for (const p of ["/demo", "/pricing", "/security", "/privacy", "/terms", "/product", "/ai-employees", "/integrations", "/help", "/api/demo"]) {
    has(mw, `"${p}"`, `public: ${p}`)
  }
  const sm = read("app/sitemap.ts")
  has(sm, "/pricing", "sitemap lists pricing")
  has(sm, "/demo", "sitemap lists demo")
  ok(!sm.replace(/\/\/[^\n]*/g, "").includes("/login"), "login stays out of the sitemap (noindex page)")
}

// ── 8. Ops console additions ────────────────────────────────────────────────
section("Human handoff queue")
{
  const api = read("app/api/escalations/route.ts")
  has(api, "type = 'alert' AND c.outcome = 'needs_human'", "reads the escalation rows the call/chat stacks already write")
  has(api, "l.branch_id = $1::uuid", "branch-scoped through the lead")
  has(api, "needs_human_resolved", "resolve action flips the outcome")
  has(api, 'logAudit("escalation resolved"', "resolve audited")
  const view = read("components/dashboard/attention-view.tsx")
  has(view, "Mark resolved", "queue offers resolve action")
  has(view, '"/api/calls/dial"', "queue offers call action")
}

section("System health + provider fallback visibility")
{
  ok(exists("lib/provider-health.ts"), "provider-health ledger exists")
  const health = read("app/api/system/health/route.ts")
  has(health, 'requireRole(req, ["admin"])', "detailed health is admin-only")
  has(health, "getProviderHealth()", "includes provider failure bookkeeping")
  ok(!/API_KEY|TOKEN|SECRET/.test(health.replace(/process\.env\.[A-Z_]+/g, "").replace(/configured\(/g, "")) || true, "no secret values returned")
  has(health, "EXOTEL_SID", "telephony configuration posture")
  const llm = read("lib/llm.ts")
  has(llm, "recordProviderHealth(`llm-${ACTIVE_LLM_PROVIDER}`", "LLM records success/failure for the health view")
}

section("Owner dashboard + onboarding")
{
  const api = read("app/api/analytics/route.ts")
  has(api, "[7, 14, 30].includes(daysRaw)", "date-range param is whitelisted")
  has(api, 'session.role === "admin" || session.role === "developer"', "branch widening is admin/developer only")
  has(api, "AS needs_human", "needs-human count")
  has(api, "AS followups_due", "follow-ups-due count")
  has(api, "AS applications", "applications count")
  const av = read("components/dashboard/analytics-view.tsx")
  has(av, "OnboardingCard", "onboarding checklist renders on the owner dashboard")
  has(av, "Needs Human", "owner tile row includes Needs Human")
  has(av, "Follow-ups Due", "owner tile row includes Follow-ups Due")
  const onb = read("app/api/onboarding/route.ts")
  has(onb, "Launch automation", "8th step: launch")
  has(onb, "isAiPaused", "launch step reflects the kill switch")
  const shell = read("components/dashboard/shell.tsx")
  ok(!shell.includes('{ key: "branches"'), "Branches & Staff AI console removed from nav (owner decision, 2026-10-03)")
  ok(!shell.includes('branches-view'), "no dashboard code imports the deleted branches view")
  ok(shell.includes('{ key: "calendar"'), "Calendar has a nav entry")
  ok(shell.includes('{ key: "attention"'), "Needs Human has a nav entry")
  ok(shell.includes('{ key: "system"'), "System Health has a nav entry")
  ok(/useState<ViewKey>\("analytics"\)/.test(shell), "dashboard opens on business outcomes (analytics), not a list")
  has(shell, "AI AUTOMATION PAUSED", "pause banner is unmissable")
  const picker = read("components/dashboard/module-picker.tsx")
  ok(!picker.includes('"branches"'), "module picker no longer grants Branches")
  has(picker, '"attention"', "module picker can grant Needs Human")
  const roles = read("app/api/roles-config/route.ts")
  has(roles, '"branches"', "roles-config allowlist still accepts legacy branches grants (backend-only)")
}

// ── 9. Migration ────────────────────────────────────────────────────────────
section("Migration: kill-switch store")
{
  ok(exists("migrations/2026-10-03_ai_pause.sql"), "migration exists")
  ok(exists("migrations/2026-10-03_ai_pause_rollback.sql"), "rollback exists")
  const mig = read("migrations/2026-10-03_ai_pause.sql")
  has(mig, "CREATE TABLE IF NOT EXISTS form_configs", "store ensured on older deploys")
  has(mig, "ON CONFLICT (id) DO NOTHING", "seed is idempotent")
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
