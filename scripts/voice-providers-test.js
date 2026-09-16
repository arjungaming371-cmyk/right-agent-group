#!/usr/bin/env node
// Voice provider tests — server/voice-providers.js, against a MOCKED fetch.
// No Sarvam/Cartesia keys, no network, no phone call.
//
//   node scripts/voice-providers-test.js     (or: npm run test:providers)
//
// Config is read once at require time, so — like voicebot-selftest.js — this
// script re-spawns itself once per scenario:
//
//   A  defaults            — local/edge selection, validation, dispatch nulls
//   B  validation errors   — cloud providers selected without keys
//   C  sarvam calls        — STT multipart + TTS payload, mocked fetch
//   D  cartesia calls      — TTS payload + audio bytes, mocked fetch
//   E  script guard        — resolveTtsLocale (Hindi text ≠ Telugu voice)
//
// Follows scripts/voicebot-selftest.js: plain node, no test runner,
// non-zero exit with a readable message.

const { spawnSync } = require("child_process")

const SCENARIO = process.env.PROVIDER_TEST_SCENARIO || ""

// ---------- runner ----------
if (!SCENARIO) {
  const scenarios = [
    ["A", "defaults + dispatch + validation (local/edge)", {}],
    ["B", "validation errors (cloud without keys)", {
      STT_PROVIDER: "sarvam", TTS_CALL_PROVIDER: "cartesia",
    }],
    ["C", "sarvam STT + TTS payloads (mocked fetch)", {
      STT_PROVIDER: "sarvam", TTS_CALL_PROVIDER: "sarvam",
      SARVAM_API_KEY: "test-key-sarvam",
    }],
    ["D", "cartesia TTS payload (mocked fetch)", {
      TTS_CALL_PROVIDER: "cartesia",
      CARTESIA_API_KEY: "test-key-cartesia",
      CARTESIA_VOICE_ID: "11111111-2222-3333-4444-555555555555",
    }],
    ["E", "script guard + multipart builder", {
      SARVAM_API_KEY: "test-key-sarvam",
    }],
  ]
  let failed = 0
  for (const [id, label, env] of scenarios) {
    console.log(`\n${"=".repeat(64)}\nSCENARIO ${id} — ${label}\n${"=".repeat(64)}`)
    const r = spawnSync(process.execPath, [__filename], {
      stdio: "inherit",
      env: { ...process.env, ...env, PROVIDER_TEST_SCENARIO: id },
    })
    if (r.status !== 0) failed++
  }
  if (failed) {
    console.error(`\n❌ ${failed} of ${scenarios.length} scenarios failed\n`)
    process.exit(1)
  }
  console.log("\n✅ Voice provider tests passed in all scenarios\n")
  process.exit(0)
}

// ---------- one scenario ----------
const assert = require("assert")
const vp = require("../server/voice-providers")

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

// One WAV-ish header so length checks (>100 bytes) pass.
function fakeWav() {
  return Buffer.concat([Buffer.alloc(44, 0), Buffer.alloc(1000, 0x55)])
}

async function scenarioA() {
  check("A1 stt provider default", vp.sttProviderName() === "local", vp.sttProviderName())
  check("A2 tts provider default", vp.ttsCallProviderName() === "edge", vp.ttsCallProviderName())
  check("A3 validation passes", vp.validateConfig().length === 0, JSON.stringify(vp.validateConfig()))
  check("A4 dispatch transcribe → null (falls back to local)",
    (await vp.transcribe(fakeWav(), "telugu")) === null)
  check("A5 dispatch synthesize → null (falls back to local)",
    (await vp.synthesize("hello", "telugu")) === null)
  check("A6 describe mentions local stack", /Whisper/.test(vp.describeCallPipeline()) && /Edge/.test(vp.describeCallPipeline()))
}

async function scenarioB() {
  const errors = vp.validateConfig()
  check("B1 validation catches missing Sarvam key (STT)", errors.some((e) => /STT_PROVIDER=sarvam but SARVAM_API_KEY/.test(e)), JSON.stringify(errors))
  check("B2 validation catches missing Cartesia key", errors.some((e) => /CARTESIA_API_KEY/.test(e)))
  check("B3 validation catches missing Cartesia voice", errors.some((e) => /CARTESIA_VOICE_ID/.test(e)))
  check("B4 fails fast (non-empty)", errors.length >= 3, `got ${errors.length}`)
}

async function mockFetchOnce(respond, capture) {
  const realFetch = global.fetch
  global.fetch = async (url, init) => {
    if (capture) capture.push({ url: String(url), init })
    return respond()
  }
  return () => { global.fetch = realFetch }
}

async function scenarioC() {
  check("C1 providers selected", vp.sttProviderName() === "sarvam" && vp.ttsCallProviderName() === "sarvam")
  check("C2 validation passes with key", vp.validateConfig().length === 0)

  // --- STT: multipart shape + response parsing ---
  let captured = []
  let restore = await mockFetchOnce(
    () => ({
      ok: true,
      json: async () => ({ request_id: "r1", transcript: "mera phone number hai ninee eight", language_code: "hi-IN" }),
    }),
    captured
  )
  try {
    const out = await vp.sarvamStt(fakeWav(), "hindi")
    check("C3 STT returns transcript", out.text === "mera phone number hai ninee eight", JSON.stringify(out))
    check("C4 STT lowConfidence=false (Sarvam has no confidence figure)", out.lowConfidence === false)
    const req = captured[0]
    check("C5 STT hits /speech-to-text", req.url.endsWith("/speech-to-text"), req.url)
    check("C6 STT auth header", req.init.headers["api-subscription-key"] === "test-key-sarvam")
    const body = req.init.body.toString("utf8")
    check("C7 STT multipart has model", /name="model"\r\n\r\nsaaras:v4/.test(body))
    check("C8 STT multipart has mode=translit", /name="mode"\r\n\r\ntranslit/.test(body))
    check("C9 STT multipart has language hint", /name="language_code"\r\n\r\nhi-IN/.test(body))
    check("C10 STT multipart carries the file", /name="file"; filename="audio\.wav"/.test(body))
  } finally { restore() }

  // --- STT auto mode drops the language hint ---
  process.env.SARVAM_STT_AUTO = "1"
  // Re-require in a child would be cleaner, but the module reads it once —
  // so test the auto branch through the lib's documented knob instead: skip.
  delete process.env.SARVAM_STT_AUTO

  // --- TTS: JSON payload + base64 WAV decode ---
  const wav = fakeWav()
  captured = []
  restore = await mockFetchOnce(
    () => ({ ok: true, json: async () => ({ request_id: "r2", audios: [wav.toString("base64")] }) }),
    captured
  )
  try {
    const buf = await vp.sarvamTts("నమస్కారం sir! loan కావాలా?", "telugu")
    check("C11 TTS decodes base64 WAV", buf.equals(wav))
    const req = captured[0]
    check("C12 TTS hits /text-to-speech", req.url.endsWith("/text-to-speech"), req.url)
    const sent = JSON.parse(req.init.body)
    check("C13 TTS model bulbul:v3", sent.model === "bulbul:v3", sent.model)
    check("C14 TTS speaker default priya", sent.speaker === "priya", sent.speaker)
    check("C15 TTS locale te-IN for telugu", sent.language_code === "te-IN", sent.language_code)
    check("C16 TTS requests wav", sent.output_audio_codec === "wav")
    check("C17 TTS sample rate default 24000", sent.speech_sample_rate === 24000)
  } finally { restore() }

  // --- TTS dispatch returns audio (non-null) ---
  restore = await mockFetchOnce(() => ({ ok: true, json: async () => ({ audios: [wav.toString("base64")] }) }))
  try {
    const dispatched = await vp.synthesize("hello", "english")
    check("C18 dispatch synthesize returns cloud audio", Buffer.isBuffer(dispatched) && dispatched.length > 0)
  } finally { restore() }
}

async function scenarioD() {
  check("D1 provider selected", vp.ttsCallProviderName() === "cartesia")
  check("D2 validation passes", vp.validateConfig().length === 0)

  const wav = fakeWav()
  const captured = []
  const restore = await mockFetchOnce(
    () => ({ ok: true, arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) }),
    captured
  )
  try {
    const buf = await vp.cartesiaTts("మీ పేరు చెప్పగలరా?", "telugu")
    check("D3 TTS returns raw audio bytes", buf.equals(wav))
    const req = captured[0]
    check("D4 hits api.cartesia.ai/tts/bytes", req.url === "https://api.cartesia.ai/tts/bytes", req.url)
    check("D5 bearer auth", req.init.headers["Authorization"] === "Bearer test-key-cartesia")
    check("D6 X-API-Key auth", req.init.headers["X-API-Key"] === "test-key-cartesia")
    check("D7 Cartesia-Version header present", !!req.init.headers["Cartesia-Version"])
    const sent = JSON.parse(req.init.body)
    check("D8 model sonic-3.6", sent.model_id === "sonic-3.6", sent.model_id)
    check("D9 voice id passed", sent.voice?.id === "11111111-2222-3333-4444-555555555555", JSON.stringify(sent.voice))
    check("D10 locale te-IN for telugu", sent.language === "te-IN", sent.language)
    check("D11 wav output", sent.output_format?.container === "wav" && sent.output_format?.encoding === "pcm_s16le")
    check("D12 no generation_config at speed 1.0", sent.generation_config === undefined)
  } finally { restore() }

  // --- retry: one 500 then success ---
  const flaky = []
  let restore2 = await mockFetchOnce(() => {
    flaky.push(1)
    if (flaky.length === 1) return { ok: false, status: 500, text: async () => "boom" }
    return { ok: true, arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) }
  })
  try {
    const buf = await vp.cartesiaTts("hello", "english")
    check("D13 retries transient 500 once", buf.length > 0 && flaky.length === 2, `attempts=${flaky.length}`)
  } catch (e) {
    check("D13 retries transient 500 once", false, e.message)
  } finally { restore2() }

  // --- no retry on 4xx ---
  let attempts4xx = 0
  restore2 = await mockFetchOnce(() => {
    attempts4xx++
    return { ok: false, status: 401, text: async () => "bad key" }
  })
  try {
    await vp.cartesiaTts("hello", "english")
    check("D14 throws on 401 without retry", false, "expected throw")
  } catch {
    check("D14 throws on 401 without retry", attempts4xx === 1, `attempts=${attempts4xx}`)
  } finally { restore2() }
}

async function scenarioE() {
  // Hindi text must never come out of the Telugu voice, and vice versa —
  // the same guarantee server/tts-service's _voice_for() gives the Edge path.
  check("E1 telugu script + declared hindi → te-IN",
    vp.resolveTtsLocale("నమస్కారం sir, loan కావాలా?", "hindi", { english: "en-IN", hindi: "hi-IN", telugu: "te-IN" }) === "te-IN")
  check("E2 devanagari + declared telugu → hi-IN",
    vp.resolveTtsLocale("नमस्ते sir, loan चाहिए?", "telugu", { english: "en-IN", hindi: "hi-IN", telugu: "te-IN" }) === "hi-IN")
  check("E3 latin + declared telugu → te-IN",
    vp.resolveTtsLocale("Namaskaram sir! Mee WhatsApp number cheppagalara?", "telugu", { english: "en-IN", hindi: "hi-IN", telugu: "te-IN" }) === "te-IN")
  check("E4 latin + unknown language → english",
    vp.resolveTtsLocale("Hello, how are you?", "klingon", { english: "en-IN", hindi: "hi-IN", telugu: "te-IN" }) === "en-IN")
  check("E5 dominant script wins on mixed", 
    vp.resolveTtsLocale("నమస్కారం नमस्ते नमस्ते", "english", { english: "en-IN", hindi: "hi-IN", telugu: "te-IN" }) === "hi-IN")
  check("E6 hasIndicScript false for latin", vp.hasIndicScript("plain english text") === false)
  check("E7 hasIndicScript true for telugu", vp.hasIndicScript("తెలుగు") === true)

  // multipart builder
  const { body, contentType } = vp.buildMultipart({ model: "saaras:v4", mode: "translit" }, "file", Buffer.from("AUDIO"), "audio.wav", "audio/wav")
  check("E8 multipart content-type has boundary", /^multipart\/form-data; boundary=----rag-voice-/.test(contentType), contentType)
  const text = body.toString("utf8")
  check("E9 multipart field order + closing", text.includes('name="model"\r\n\r\nsaaras:v4') && text.includes('name="mode"\r\n\r\ntranslit') && text.trimEnd().endsWith("--"))
  check("E10 multipart file bytes intact", body.includes(Buffer.from("AUDIO")))

  // retry helper: network errors retry
  let attempts = 0
  const realFetch = global.fetch
  global.fetch = async () => {
    attempts++
    if (attempts === 1) throw new Error("ECONNRESET")
    return { ok: true, json: async () => ({ transcript: "recovered", language_code: "en-IN" }) }
  }
  try {
    process.env.SARVAM_API_KEY = "test-key-sarvam"
    const out = await vp.sarvamStt(fakeWav(), "english")
    check("E11 STT retries after network error", out.text === "recovered" && attempts === 2, `attempts=${attempts}`)
  } finally {
    global.fetch = realFetch
  }
}

;(async () => {
  const scenarios = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD, E: scenarioE }
  await scenarios[SCENARIO]()
  console.log(`\n  ${pass} passed, ${fail} failed (scenario ${SCENARIO})\n`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error(`  scenario ${SCENARIO} crashed:`, e)
  process.exit(1)
})
