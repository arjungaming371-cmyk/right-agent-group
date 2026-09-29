#!/usr/bin/env node
// Regression tests for the 2026-09-30 Voice Studio (multi-voice + cloning).
//
// Provider API calls are NOT made here (no keys, no network burn) — what IS
// testable pure is:
//   1. Migration ↔ local-setup.sql mirror integrity (drift = fresh installs
//      missing the table, the recurring failure class this repo guards
//      against with every migration).
//   2. The Sarvam preset catalog embedded in lib/voice-catalog.ts — unique
//      ids, valid genders, the two anchor voices the app documents.
//   3. Route contract invariants that must never regress:
//      consent hard-gate on /api/voices/clone, provider allow-lists, audio
//      size/type limits, and the svc- clone dispatch branch in the call
//      engine (server/voice-providers.js) + lib/tts.ts.
//   4. LIVE (env-gated): with SARVAM_API_KEY set, one real Bulbul synthesis
//      through the deployed speaker path — skipped silently otherwise, same
//      convention as scripts/test-instagram.js.
//
// Run: node scripts/test-voices.js

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const ROOT = path.join(__dirname, "..")

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

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

async function main() {
try {
  // ── 1. Migration ↔ mirror integrity ──
  section("custom_voices: migration and local-setup.sql stay in lockstep")
  const migration = read("migrations/2026-09-30_custom_voices.sql")
  const localSetup = read("local-setup.sql")
  const cols = ["id", "org_id", "provider", "voice_id", "name", "gender", "primary_language",
    "description", "sample_text", "cloned", "consent_confirmed", "consent_note",
    "consent_by", "created_by", "is_active", "created_at", "updated_at"]
  const block = localSetup.slice(localSetup.indexOf("CREATE TABLE IF NOT EXISTS custom_voices"))
  ok(block.includes("CREATE TABLE IF NOT EXISTS custom_voices"), "local-setup.sql mirrors the custom_voices table")
  for (const c of cols) ok(block.includes(`\n  ${c} `) || block.includes(` ${c} `), `mirror has column ${c}`)
  for (const c of cols) ok(migration.includes(`  ${c} `), `migration has column ${c}`)
  ok(migration.includes("UNIQUE (provider, voice_id)") && block.includes("UNIQUE (provider, voice_id)"), "UNIQUE (provider, voice_id) in both — no duplicate clone rows")
  ok(migration.includes("is_active") && block.includes("is_active"), "soft-delete column in both")

  // ── 2. Sarvam preset catalog integrity ──
  section("Sarvam Bulbul catalog: unique ids, valid genders, anchors present")
  const catalogSrc = read("lib/voice-catalog.ts")
  const voiceRows = [...catalogSrc.matchAll(/\{ id: "([a-z]+)", gender: "(female|male|neutral)"/g)]
  const ids = voiceRows.map((m) => m[1])
  ok(voiceRows.length >= 20, `catalog carries the full Bulbul family (${voiceRows.length} speakers)`)
  ok(new Set(ids).size === ids.length, "no duplicate speaker ids")
  ok(ids.includes("priya"), "priya present — the app's original default voice")
  ok(ids.includes("shubh"), "shubh present — documented male anchor")
  ok(!ids.includes(""), "no empty speaker ids")
  // every listed speaker must be a bare lowercase name (Sarvam speaker format)
  ok(ids.every((i) => /^[a-z]+$/.test(i)), "speaker ids are bare lowercase names (Sarvam format)")

  // ── 3. Route contract invariants ──
  section("Clone route: consent hard-gate, allow-lists, size caps")
  const cloneRoute = read("app/api/voices/clone/route.ts")
  ok(/consent.*"true"|"true".*consent/.test(cloneRoute.replace(/\s+/g, " ")), "consent must equal 'true' to proceed")
  ok(cloneRoute.includes("Consent declaration is mandatory"), "missing consent → explicit DPDP 2023 error, never a silent clone")
  ok(cloneRoute.includes('provider !== "sarvam" && provider !== "cartesia"'), "provider allow-list enforced server-side")
  ok(cloneRoute.includes('requireRole(req, ["admin", "developer"])'), "cloning is admin/developer only")
  ok(cloneRoute.includes("MAX_AUDIO_BYTES") && cloneRoute.includes("10 * 1024 * 1024"), "10 MB audio cap")
  ok(cloneRoute.includes("audio.length < 20_000"), "too-short samples rejected (< 20 KB ≈ <10s)")
  ok(cloneRoute.includes("logAudit"), "clone attempts land in the audit log")

  section("Catalog route: merged feeds + key hints")
  const listRoute = read("app/api/voices/route.ts")
  ok(listRoute.includes("sarvamPresets()"), "serves the Sarvam preset catalog")
  ok(listRoute.includes("listCartesiaVoices()"), "serves live Cartesia voices")
  ok(listRoute.includes("FROM custom_voices") && listRoute.includes("is_active = true"), "serves local clones (active only)")
  ok(listRoute.includes("keys: { sarvam"), "tells the UI which provider keys are configured")
  ok(listRoute.includes('requireRole(req, ["admin", "branch_manager", "developer"])'), "catalog is role-gated")

  section("Preview route: provider + language validation, no persistence")
  const previewRoute = read("app/api/voices/preview/route.ts")
  ok(previewRoute.includes('provider !== "sarvam" && provider !== "cartesia"'), "preview validates provider")
  ok(previewRoute.includes('"telugu"].includes(language)'), "preview validates language")
  ok(previewRoute.includes('"Cache-Control": "no-store"'), "audio is never cached (it is regenerated on demand)")
  ok(previewRoute.includes("logAudit"), "previews are audited (they burn provider credits)")

  section("Runtime dispatch: cloned voices reach the live call engine")
  const providers = read("server/voice-providers.js")
  ok(providers.includes('speaker.startsWith("svc-")'), "voicebot routes svc-* speakers to clone synthesis")
  ok(providers.includes("sarvamCloneTts"), "sarvamCloneTts exists in the engine")
  ok(providers.includes("sarvamStt, sarvamTts, sarvamCloneTts, cartesiaTts"), "clone synthesizer exported for tests")
  execSync(`node --check "${path.join(ROOT, "server/voice-providers.js")}"`, { stdio: "pipe" })
  ok(true, "server/voice-providers.js parses clean")
  const tts = read("lib/tts.ts")
  ok(tts.includes("TtsVoiceOverride"), "lib/tts.ts exposes the voice-override type")
  ok(tts.includes('speakerOverride.startsWith("svc-")'), "lib/tts.ts routes svc-* clones through the clone endpoint")

  // ── 4. LIVE gate (only when a key is actually configured) ──
  if (process.env.SARVAM_API_KEY && process.env.SARVAM_API_KEY.trim()) {
    section("LIVE: Sarvam Bulbul synthesis (SARVAM_API_KEY present)")
    const mod = require(path.join(ROOT, "server", "voice-providers.js"))
    const wav = await mod.sarvamTts("Namaskar, this is a voice studio test.", "english", "priya")
    ok(Buffer.isBuffer(wav) && wav.length > 1000, `live synthesis returned audio (${wav ? Math.round(wav.length / 1024) : 0} KB)`)
  } else {
    section("LIVE: skipped — SARVAM_API_KEY not set in this environment (CI-safe)")
  }
} catch (e) {
  failed++
  console.error("❌ SUITE ERROR:", e.message)
}
}

main().then(() => {
  console.log(`\n═══ test-voices: ${passed} passed, ${failed} failed ═══`)
  process.exit(failed ? 1 : 0)
})
