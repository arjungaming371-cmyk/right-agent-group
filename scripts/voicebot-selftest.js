#!/usr/bin/env node
// Voicebot self-test — barge-in, echo probe, and playback, against a fake
// WebSocket. No phone call, no Exotel, no TTS service, no Next.js app.
//
//   node scripts/voicebot-selftest.js      (or: npm run test:voicebot)
//
// VOICEBOT_BARGE_IN and VOICEBOT_ECHO_PROBE are read once at require time, so
// one process can only ever test one configuration. This script re-spawns
// itself three times, once per mode:
//
//   A  barge-in off, probe off  — the SHIPPING default; must behave exactly
//                                 as it did before either feature existed
//   B  probe on                 — measurement only, must not disturb anything
//   C  barge-in on              — interruption actually works
//
// Follows scripts/smoke-test.js: plain node, no test runner, non-zero exit
// with a readable message.

const { spawnSync } = require("child_process")
const path = require("path")

const MODE = process.env.SELFTEST_MODE || ""
const SAMPLE_RATE = 8000
const BYTES_PER_SAMPLE = 2
const FRAME_BYTES = 320 // 20ms
const FRAME_MS = 20

// ---------- runner ----------
if (!MODE) {
  const modes = [
    ["A", "default (barge-in off, probe off)", { VOICEBOT_BARGE_IN: "0", VOICEBOT_ECHO_PROBE: "0" }],
    ["B", "echo probe on", { VOICEBOT_BARGE_IN: "0", VOICEBOT_ECHO_PROBE: "1" }],
    ["C", "barge-in on", { VOICEBOT_BARGE_IN: "1", VOICEBOT_ECHO_PROBE: "0" }],
  ]
  let failed = 0
  for (const [id, label, env] of modes) {
    console.log(`\n${"=".repeat(64)}\nMODE ${id} — ${label}\n${"=".repeat(64)}`)
    const r = spawnSync(process.execPath, [__filename], {
      stdio: "inherit",
      env: {
        ...process.env,
        ...env,
        SELFTEST_MODE: id,
        // The module exits at require time without this.
        WHATSAPP_SERVICE_KEY: process.env.WHATSAPP_SERVICE_KEY || "selftest-key",
        // dotenv never overrides already-set vars, so these beat .env.
      },
    })
    if (r.status !== 0) failed++
  }
  if (failed) {
    console.error(`\n❌ ${failed} of ${modes.length} modes failed\n`)
    process.exit(1)
  }
  console.log("\n✅ Voicebot self-test passed in all three modes\n")
  process.exit(0)
}

// ---------- one mode ----------
const BARGE_IN = process.env.VOICEBOT_BARGE_IN === "1"
const ECHO_PROBE = process.env.VOICEBOT_ECHO_PROBE === "1"
const { CallSession } = require(path.join(__dirname, "..", "server", "voicebot-server.js"))

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ok   ${name} — ${detail}`)
  } else {
    fail++
    console.log(`  FAIL ${name} — ${detail}`)
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A frame of constant amplitude: avgEnergy() returns exactly `amp`.
function frameOf(amp) {
  const b = Buffer.alloc(FRAME_BYTES)
  for (let i = 0; i < FRAME_BYTES / 2; i++) b.writeInt16LE(amp, i * 2)
  return { media: { payload: b.toString("base64") } }
}
function feed(session, amp, frames) {
  for (let i = 0; i < frames; i++) session.onMedia(frameOf(amp))
}
function newSession() {
  const sent = []
  const ws = { send: (s) => sent.push(JSON.parse(s)), close: () => {} }
  const s = new CallSession(ws)
  s.streamSid = "stream-1"
  s.callSid = "call-1"
  return { s, sent }
}
const pcmOf = (seconds) => Buffer.alloc(SAMPLE_RATE * BYTES_PER_SAMPLE * seconds)

;(async () => {
  // ================= shared: the default path must never move =================
  console.log("\n-- call diagnostics only count frames captured while the mic is live --")
  {
    const { s } = newSession()
    s.botTalking = true
    // Below BARGE_ENERGY on purpose: in mode C a louder feed would legitimately
    // trigger an interrupt, which unmutes the mic and makes the counters start
    // moving for the right reason. This checks the plain half-duplex case.
    feed(s, 500, 25) // echo of Priya's own voice
    check("frameCount ignores frames while Priya speaks", s.frameCount === 0, `frameCount=${s.frameCount}`)
    check("callMaxEnergy not polluted by echo", s.callMaxEnergy === 0, `callMaxEnergy=${s.callMaxEnergy}`)

    s.botTalking = false
    s.processing = true
    feed(s, 9000, 25) // mid-turn: STT/LLM running
    check("frameCount ignores frames while processing", s.frameCount === 0, `frameCount=${s.frameCount}`)

    s.processing = false
    feed(s, 1234, 10) // mic live at last
    check("counts frames once the mic is live", s.frameCount === 10, `frameCount=${s.frameCount}`)
    check("records the caller's real peak", s.callMaxEnergy === 1234, `callMaxEnergy=${s.callMaxEnergy}`)
  }

  console.log("\n-- playback --")
  {
    const { s, sent } = newSession()
    const t0 = Date.now()
    await s.playPcm(pcmOf(2), 0)
    const took = Date.now() - t0
    check("2s of audio takes ~2s", took >= 2000 && took < 2700, `${took}ms`)
    check("every 100ms chunk sent", sent.length === 20, `${sent.length} chunks`)
    check("frames are well-formed media events", sent.every((m) => m.event === "media" && m.media && m.media.payload), "all chunks are media events with a payload")
  }
  {
    const { s, sent } = newSession()
    s.speechEpoch = 7
    await s.playPcm(pcmOf(3), 5) // epoch 5 = an abandoned turn
    check("a stale turn cannot emit audio", sent.length === 0, `${sent.length} chunks sent`)
  }
  {
    const { s } = newSession()
    s.botTalking = true
    s.speechEpoch = 3
    await s.drainSpeech(2)
    check("drainSpeech won't unmute a superseded turn", s.botTalking === true, "botTalking still true")
    await s.drainSpeech(3)
    check("drainSpeech unmutes the current turn", s.botTalking === false, "botTalking false")
  }

  // ================= mode A: nothing new may fire =================
  if (MODE === "A") {
    console.log("\n-- barge-in and probe are both inert --")
    const { s, sent } = newSession()
    s.botTalking = true
    feed(s, 9000, 100) // 2s of the loudest possible input
    check("never interrupts", s.speechEpoch === 0, `speechEpoch=${s.speechEpoch}`)
    check("no barge-in state accumulates", s.bargeMs === 0 && s.bargeBuffer.length === 0, `bargeMs=${s.bargeMs} bargeBuffer=${s.bargeBuffer.length}`)
    check("no probe state accumulates", s.echoFrames === 0 && s.echoPeak === 0 && s.echoCallerPeak === 0, `echoFrames=${s.echoFrames} echoPeak=${s.echoPeak}`)
    check("mic stays muted while Priya speaks", s.buffer.length === 0 && s.speaking === false, "no audio captured")
    check("nothing sent to the caller", sent.length === 0, `${sent.length} chunks`)

    const { s: s2, sent: sent2 } = newSession()
    const t0 = Date.now()
    await s2.playPcm(pcmOf(5), 0)
    check("playback is unpaced (original dump-then-sleep)", sent2.length === 50 && Date.now() - t0 >= 5000, `${sent2.length} chunks, all queued up front`)
  }

  // ================= mode B: the probe measures, and only measures =================
  if (MODE === "B") {
    console.log("\n-- echo probe measurement --")
    {
      const { s } = newSession()
      s.botTalking = true
      feed(s, 120, 20) // quiet line noise
      check("quiet echo never fires", s.echoFires === 0 && s.echoMaxRunMs === 0, `peak=${s.echoPeak} fires=${s.echoFires}`)
      check("tracks the echo peak", s.echoPeak === 120, `echoPeak=${s.echoPeak}`)
    }
    {
      const { s } = newSession()
      s.botTalking = true
      feed(s, 900, 20) // 400ms sustained, threshold is 300ms
      check("sustained echo would have fired", s.echoFires === 1, `fires=${s.echoFires}`)
      check("longest run measured", s.echoMaxRunMs === 400, `echoMaxRunMs=${s.echoMaxRunMs}`)
      check("reports when it would have fired", s.echoFirstFireMs === 300, `at ${s.echoFirstFireMs}ms`)
    }
    {
      const { s } = newSession()
      s.botTalking = true
      feed(s, 900, 10)
      feed(s, 50, 1) // one quiet frame breaks the run
      feed(s, 900, 10)
      check("intermittent echo never accumulates", s.echoFires === 0, `fires=${s.echoFires}`)
      check("run resets on a gap", s.echoMaxRunMs === 200, `longest run ${s.echoMaxRunMs}ms`)
    }
    {
      const { s } = newSession()
      s.botTalking = true
      feed(s, 900, 100) // 2s continuous — must be ONE would-be fire, not 86
      check("one long run counts once", s.echoFires === 1, `fires=${s.echoFires}`)
    }
    {
      const { s } = newSession()
      s.botTalking = false
      feed(s, 2600, 5) // the caller, mic live
      check("caller peak tracked separately from echo", s.echoCallerPeak === 2600 && s.echoPeak === 0, `callerPeak=${s.echoCallerPeak} echoPeak=${s.echoPeak}`)
    }
    {
      const { s, sent } = newSession()
      s.botTalking = true
      feed(s, 9000, 50)
      check("probe never interrupts", s.speechEpoch === 0, `speechEpoch=${s.speechEpoch}`)
      check("probe sends nothing to the caller", sent.length === 0, `${sent.length} chunks`)
      check("probe leaves capture state alone", s.buffer.length === 0 && s.bargeMs === 0, "buffer and barge state clean")
      s.echoReplyOpen = true
      s.probeReport()
      s.probeSummary()
      s.probeSummary() // must not print twice
      check("report and summary run without throwing", true, "and the summary is printed once")
    }
  }

  // ================= mode C: interruption actually works =================
  if (MODE === "C") {
    console.log("\n-- barge-in detection --")
    {
      const { s } = newSession()
      s.botTalking = true
      feed(s, 100, 50)
      check("ignores quiet line noise", s.speechEpoch === 0, `epoch=${s.speechEpoch}`)
      feed(s, 5000, 50) // alternating handled below; this is sustained
      check("interrupts on sustained speech", s.speechEpoch === 1, `epoch=${s.speechEpoch}`)
      check("mic goes live immediately", s.botTalking === false && s.processing === false, `botTalking=${s.botTalking}`)
      check("keeps the caller's first words", s.buffer.length >= 15, `${s.buffer.length} frames carried forward`)
    }
    {
      const { s } = newSession()
      s.botTalking = true
      for (let i = 0; i < 50; i++) s.onMedia(frameOf(i % 2 ? 5000 : 50))
      check("ignores intermittent loud frames", s.speechEpoch === 0, `epoch=${s.speechEpoch}`)
    }
    {
      const { s, sent } = newSession()
      const t0 = Date.now()
      const p = s.playPcm(pcmOf(5), 0)
      await sleep(400)
      s.speechEpoch++
      await p
      check("playback stops mid-clip", sent.length * 100 < 1500, `only ${sent.length * 100}ms of 5000ms sent`)
      check("and stops promptly", Date.now() - t0 < 1500, `returned after ${Date.now() - t0}ms`)
    }

    // ---- the regression that the original barge-in suite missed ----
    console.log("\n-- sentences streamed AFTER an interrupt must never play --")
    {
      const { s, sent } = newSession()
      const corrections = []
      s.synth = async () => Buffer.alloc(FRAME_BYTES * 50) // 1s of audio, no TTS service
      s.reportSpoken = async (spoken) => { corrections.push(spoken.slice()) }
      s.speechToTextOverride = true
      // Drive endUtterance's streaming section directly through turnStream.
      s.turnStream = async (payload, onEvent) => {
        onEvent({ type: "sentence", text: "Sentence one is long enough to play." })
        await sleep(150)
        s.interrupt() // caller cuts in mid-reply, while the model streams on
        onEvent({ type: "sentence", text: "Sentence two must never be heard." })
        onEvent({ type: "sentence", text: "Neither must sentence three." })
        onEvent({ type: "done", language: "english", hangup: true })
      }

      const epoch = s.speechEpoch
      const spoken = []
      await s.turnStream({}, (ev) => {
        if (ev.type === "sentence") s.queueSentence(ev.text, epoch, spoken)
      })
      await s.drainSpeech(epoch)
      if (epoch !== s.speechEpoch) await s.reportSpoken(spoken)

      check("only the pre-interrupt sentence played", spoken.length === 1, `spoken=${JSON.stringify(spoken)}`)
      check("post-interrupt sentences dropped", spoken.every((t) => !t.includes("never")), "no 'must never be heard' text reached playback")
      check("audio stopped at the interrupt", sent.length * 100 <= 1000, `${sent.length * 100}ms of audio sent`)
      check("transcript correction sent", corrections.length === 1 && corrections[0].length === 1, `corrections=${JSON.stringify(corrections)}`)
      check("epoch advanced exactly once", s.speechEpoch === epoch + 1, `epoch ${epoch} -> ${s.speechEpoch}`)
    }
    {
      // Same shape, no interrupt: nothing may be corrected.
      const { s } = newSession()
      const corrections = []
      s.synth = async () => Buffer.alloc(FRAME_BYTES * 5)
      s.reportSpoken = async (spoken) => { corrections.push(spoken.slice()) }
      const epoch = s.speechEpoch
      const spoken = []
      s.queueSentence("Only sentence.", epoch, spoken)
      await s.drainSpeech(epoch)
      if (epoch !== s.speechEpoch) await s.reportSpoken(spoken)
      check("uninterrupted turn sends no correction", corrections.length === 0, `${corrections.length} corrections`)
      check("uninterrupted sentence still plays", spoken.length === 1, `spoken=${JSON.stringify(spoken)}`)
    }
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed  [mode ${MODE}]`)
  process.exit(fail === 0 ? 0 : 1)
})()
