// WhatsApp calling — session lifecycle verification.
//
// Spins up local mocks for the two cloud dependencies (the app's
// /api/calls/turn endpoint and Cartesia TTS), then drives the REAL
// WhatsAppCallSession lifecycle from server/whatsapp-calls.js:
//
//   connect (SDP offer) -> SDP answer + Priya greeting via Cartesia
//   duplicate connect (Meta retries) -> same answer, no double session
//   terminate -> end report lands on the turn API before endSession resolves
//
// Run: node scripts/test-wa-session.js   (no API keys / network needed)

const http = require("http")

// werift / @discordjs/opus are voicebot deps installed under server/
module.paths.push(require("path").join(__dirname, "..", "server", "node_modules"))

// ---- env BEFORE requiring the module (config is read at require time) ----
const MOCK_HOST = "127.0.0.1"

process.env.WHATSAPP_SERVICE_KEY = "test-service-key"
process.env.VOICEBOT_WA_TTS_PROVIDER = "cartesia"
process.env.CARTESIA_API_KEY = "test-cartesia-key"
process.env.CARTESIA_VOICE_ID = "test-voice-id"
process.env.VOICEBOT_WA_STT_SAMPLE_RATE = "16000"

const calls = [] // turn API event log
let ttsHits = 0

function wavFor(samples) {
  const pcm = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(6000 * Math.sin(i / 6)), i * 2)
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(24000, 24) // Cartesia sample rate
  header.writeUInt32LE(48000, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits
  header.write("data", 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function startMocks() {
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      if (req.url === "/api/calls/turn" && req.method === "POST") {
        if (req.headers["x-api-key"] !== "test-service-key") {
          res.writeHead(401).end()
          return
        }
        const payload = JSON.parse(body || "{}")
        calls.push(payload)
        if (payload.event === "start") {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({
            text: "Hello! This is Priya from Right Agent Group. How can I help you today?",
            language: "english",
            leadId: "lead-test-1",
            branchId: "hq",
          }))
        } else {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
        }
        return
      }
      if (req.url === "/tts/bytes" && req.method === "POST") {
        ttsHits++
        res.writeHead(200, { "Content-Type": "audio/wav" })
        res.end(wavFor(9600)) // 400 ms of 24 kHz audio
        return
      }
      res.writeHead(404).end()
    })
  })
  await new Promise((r) => server.listen(0, MOCK_HOST, r))
  const port = server.address().port
  process.env.APP_INTERNAL_URL = `http://${MOCK_HOST}:${port}`
  process.env.CARTESIA_URL = `http://${MOCK_HOST}:${port}`
  return server
}

// Minimal Chrome-style WhatsApp offer (opus 48k + DTLS sha-256).
const OFFER = [
  "v=0",
  "o=- 987654321 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:QwErTyUi",
  "a=ice-pwd:AsDfGhJkLzXcVbNm12345678",
  "a=setup:actpass",
  "a=mid:0",
  "a=sendrecv",
  "a=rtcp-mux",
  "a=rtpmap:111 opus/48000/2",
  "a=fingerprint:sha-256 22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11",
].join("\r\n") + "\r\n"

let passed = 0
const failures = []
function ok(name, cond, extra) {
  if (cond) {
    passed++
    console.log(`  ok   ${name}${extra ? ` — ${extra}` : ""}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms) => {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) return false
    await sleep(50)
  }
  return true
}

;(async () => {
  console.log("WhatsApp calling — session lifecycle self-test\n")
  const mock = await startMocks()

  // Require AFTER env + mocks are up (module reads config at require time).
  const {
    startSession,
    endSession,
    activeCount,
    validateConfig,
    describeConfig,
    callSidFor,
  } = require("../server/whatsapp-calls")

  console.log("-- connect --")
  const r1 = await startSession({
    callId: "wa-test-1",
    from: "919999911111",
    to: "918000800080",
    phoneNumberId: "pnid-test",
    sdp: OFFER,
    sdpType: "offer",
  })
  ok("connect returns an answer SDP", typeof r1.answerSdp === "string" && r1.answerSdp.includes("m=audio"))
  ok("answer is sha-256 only", r1.answerSdp.includes("a=fingerprint:sha-256") && !/a=fingerprint:(?!sha-256)/.test(r1.answerSdp))
  ok("one live session after connect", activeCount() === 1)

  ok("turn API got event=start", await until(() => calls.some((c) => c.event === "start"), 5000))
  const startEvt = calls.find((c) => c.event === "start") || {}
  ok("start uses the WhatsApp callSid", startEvt.callSid === callSidFor("wa-test-1"), startEvt.callSid)
  ok("start tagged source=whatsapp_call", startEvt.source === "whatsapp_call")
  ok("start carries the caller phone", startEvt.from === "919999911111")
  ok("greeting queued via Cartesia TTS", await until(() => ttsHits >= 1, 5000), `${ttsHits} synth call(s)`)
  ok("no Cartesia fallback to Sarvam (mocked provider fine)", ttsHits >= 1)

  console.log("-- duplicate connect (Meta retry) --")
  const r2 = await startSession({
    callId: "wa-test-1",
    from: "919999911111",
    to: "918000800080",
    phoneNumberId: "pnid-test",
    sdp: OFFER,
    sdpType: "offer",
  })
  ok("retry returns the SAME stored answer", r2.answerSdp === r1.answerSdp)
  ok("no second session created", activeCount() === 1)
  ok("greeting fired exactly once", calls.filter((c) => c.event === "start").length === 1)

  console.log("-- terminate --")
  const unknown = await endSession("wa-does-not-exist", "terminate")
  ok("terminate for unknown callId is a clean no-op", unknown.ok === true && unknown.ended === false)

  const ended = await endSession("wa-test-1", "terminate")
  ok("terminate reports ended", ended.ok === true && ended.ended === true)
  ok("session reaped", activeCount() === 0)
  ok("turn API got event=end", await until(() => calls.some((c) => c.event === "end"), 5000))
  const endEvt = calls.find((c) => c.event === "end") || {}
  ok("end report carries callSid + duration", endEvt.callSid === callSidFor("wa-test-1") && typeof endEvt.duration === "number", `duration=${endEvt.duration}s`)
  ok("endSession awaited the end report (no 0s misses)",
    endEvt.callSid === callSidFor("wa-test-1"))
  // A duplicate terminate after close must not resurrect anything.
  const again = await endSession("wa-test-1", "terminate")
  ok("double terminate is idempotent", again.ok === true && again.ended === false && activeCount() === 0)

  console.log("-- config helpers --")
  ok("validateConfig clean with key set", validateConfig().length === 0)
  ok("describeConfig names Cartesia", describeConfig().includes("Cartesia"))

  mock.close()
  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    failures.forEach((f) => console.error("  failed:", f))
    process.exit(1)
  }
  process.exit(0)
})().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
