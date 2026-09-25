#!/usr/bin/env node
// Self-test for server/recorder.js — the WhatsApp call recording engine.
//
//   node scripts/test-wa-recorder.js
//
// Covers: mixChunk math (incl. clipping), WAV header layout, the full
// start→push→finalize pipeline (disk streams → mix → MP3 transcode with
// WAV fallback), duration caps, stale-file sweep and the RECORD_CALLS=0
// kill switch. No external deps; ffmpeg is expected (already a TTS dep).

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const os = require("os")

// Isolated scratch recordings dir — set BEFORE requiring the module.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "rag-rec-test-"))
process.env.RECORDINGS_DIR = SCRATCH
process.env.RECORD_CALLS = "1"
delete process.env.RECORDING_MAX_MINUTES

const {
  CallRecorder, createFor, cleanupStale, wavHeader, mixChunk,
  transcodeToMp3, REC_RATE, SILENCE_20MS, maxBytes,
} = require("../server/recorder")

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}${extra ? " — " + extra : ""}`) }
}

// ---------- 1. mixChunk math ----------
{
  const a = Buffer.alloc(4), b = Buffer.alloc(4)
  a.writeInt16LE(1000, 0); a.writeInt16LE(-1000, 2)
  b.writeInt16LE(500, 0); b.writeInt16LE(-2500, 2)
  const m = mixChunk(a, b, 4)
  ok("mix: 1000+500 → 1500", m.readInt16LE(0) === 1500)
  ok("mix: -1000-2500 → -3500", m.readInt16LE(2) === -3500)
  const bigA = Buffer.alloc(2), bigB = Buffer.alloc(2)
  bigA.writeInt16LE(32000, 0); bigB.writeInt16LE(20000, 0)
  ok("mix: clip high → 32767", mixChunk(bigA, bigB, 2).readInt16LE(0) === 32767)
  bigA.writeInt16LE(-32000, 0); bigB.writeInt16LE(-20000, 0)
  ok("mix: clip low → -32768", mixChunk(bigA, bigB, 2).readInt16LE(0) === -32768)
  const short = mixChunk(a, Buffer.alloc(0), 4)
  ok("mix: missing side = silence", short.readInt16LE(0) === 1000 && short.readInt16LE(2) === -1000)
  ok("silence frame is exactly 20 ms", SILENCE_20MS.length === (REC_RATE / 50) * 2)
}

// ---------- 2. WAV header layout ----------
{
  const h = wavHeader(6400) // 0.2 s of 16 kHz mono s16
  ok("wav: RIFF tag", h.toString("ascii", 0, 4) === "RIFF")
  ok("wav: WAVE tag", h.toString("ascii", 8, 12) === "WAVE")
  ok("wav: PCM format", h.readUInt16LE(20) === 1)
  ok("wav: mono", h.readUInt16LE(22) === 1)
  ok("wav: 16 kHz", h.readUInt32LE(24) === REC_RATE)
  ok("wav: 16-bit", h.readUInt16LE(34) === 16)
  ok("wav: data size", h.readUInt32LE(40) === 6400)
  ok("wav: RIFF size", h.readUInt32LE(4) === 36 + 6400)
}

// ---------- 3. End-to-end: start → push → finalize (MP3 via ffmpeg) ----------
;(async () => {
  const sid = "wacall-test-e2e"
  const rec = new CallRecorder(sid)
  rec.start()
  const seconds = 1
  const samples = REC_RATE * seconds
  for (let i = 0; i < samples; i += REC_RATE / 50) {
    const frame = Buffer.alloc((REC_RATE / 50) * 2) // 20 ms
    for (let s = 0; s < REC_RATE / 50; s++) {
      // caller: a quiet ramp; Priya: a counter-phase signal on the first half
      frame.writeInt16LE(Math.round(Math.sin((i + s) / 20) * 5000), s * 2)
    }
    rec.pushInbound(frame)
    if (i < samples / 2) {
      const out = Buffer.alloc(frame.length)
      for (let s = 0; s < REC_RATE / 50; s++) out.writeInt16LE(Math.round(Math.cos((i + s) / 20) * 3000), s * 2)
      rec.pushOutbound(out)
    } else {
      rec.pushOutbound(SILENCE_20MS)
    }
  }
  const meta = await rec.finalize()
  ok("e2e: meta returned", !!meta && typeof meta.filename === "string")
  ok("e2e: filename namespaced to the callSid", meta.filename.startsWith(sid + "."))
  ok("e2e: duration ≈ 1.0s", Math.abs(meta.durationSec - seconds) < 0.1, `got ${meta.durationSec}`)
  ok("e2e: format mp3 or wav (fallback)", meta.format === "mp3" || meta.format === "wav", meta.format)
  const finalPath = path.join(SCRATCH, meta.filename)
  ok("e2e: file exists and non-empty", fs.existsSync(finalPath) && fs.statSync(finalPath).size === meta.bytes)
  ok("e2e: temp PCM files cleaned up",
    !fs.existsSync(path.join(SCRATCH, "tmp", `${sid}.in.pcm`)) &&
    !fs.existsSync(path.join(SCRATCH, "tmp", `${sid}.out.pcm`)))
  ok("e2e: finalize is idempotent", (await rec.finalize()) === meta)

  // If ffmpeg gave us an MP3, sanity-check it; if not, verify the WAV instead.
  if (meta.format === "mp3") {
    const buf = fs.readFileSync(finalPath)
    ok("e2e: MP3 frame sync present", buf.length > 128 && (buf[0] === 0xff || buf[0] === 0x49 || buf[0] === 0x44))
  } else {
    const buf = fs.readFileSync(finalPath)
    ok("e2e (wav fallback): valid header", buf.toString("ascii", 0, 4) === "RIFF" && buf.readUInt32LE(24) === REC_RATE)
    ok("e2e (wav fallback): data size matches duration", Math.abs((buf.readUInt32LE(40) / (REC_RATE * 2)) - seconds) < 0.1)
  }

  // ---------- 4. WAV-mix precision (direct, no transcode) ----------
  {
    const sid2 = "wacall-test-mix"
    const r2 = new CallRecorder(sid2)
    r2.start()
    const oneSec = Buffer.alloc(REC_RATE * 2)
    for (let i = 0; i < REC_RATE; i++) oneSec.writeInt16LE(100, i * 2)
    r2.pushInbound(oneSec)                       // caller: DC 100 for 1 s
    const half = Buffer.alloc(REC_RATE * 2)
    r2.pushOutbound(half)                        // Priya: silence for 1 s
    // bypass finalize's transcode by checking the mixed WAV pieces directly:
    // mix them by hand here via mixChunk and validate timeline alignment.
    const manual = mixChunk(oneSec, half, REC_RATE * 2)
    ok("mix-precision: 1s timeline, sample 0 = 100", manual.readInt16LE(0) === 100)
    ok("mix-precision: last sample = 100", manual.readInt16LE((REC_RATE - 1) * 2) === 100)
    void r2.finalize()
  }

  // ---------- 5. Duration cap ----------
  {
    const saved = process.env.RECORDING_MAX_MINUTES
    process.env.RECORDING_MAX_MINUTES = "1"
    ok("cap: 1 min → 1.92 MB of PCM", maxBytes() === REC_RATE * 2 * 60)
    const sid3 = "wacall-test-cap"
    const r3 = new CallRecorder(sid3)
    r3.start()
    const frame = Buffer.alloc((REC_RATE / 50) * 2, 7)
    for (let i = 0; i < (REC_RATE / 50) * 60 * 70; i++) r3.pushInbound(frame) // 70 min of frames
    ok("cap: bytes stop at the ceiling", r3.inBytes <= REC_RATE * 2 * 60 + (REC_RATE / 50) * 2)
    ok("cap: capped flag set", r3.capped)
    await r3.finalize()
    process.env.RECORDING_MAX_MINUTES = saved
  }

  // ---------- 6. Empty recording → null meta ----------
  {
    const r4 = new CallRecorder("wacall-test-empty")
    r4.start()
    ok("empty: finalize → null (no file)", (await r4.finalize()) === null)
  }

  // ---------- 7. Stale sweep ----------
  {
    const oldFile = path.join(SCRATCH, "wacall-test-old.wav")
    const newFile = path.join(SCRATCH, "wacall-test-new.wav")
    const junk = path.join(SCRATCH, "unrelated.txt")
    fs.writeFileSync(oldFile, "x"); fs.writeFileSync(newFile, "x"); fs.writeFileSync(junk, "x")
    const old = new Date(Date.now() - 48 * 3600 * 1000)
    fs.utimesSync(oldFile, old, old)
    const removed = cleanupStale()
    ok("sweep: removed the 48h-old recording", removed >= 1 && !fs.existsSync(oldFile))
    ok("sweep: kept the fresh recording", fs.existsSync(newFile))
    ok("sweep: never touches foreign files", fs.existsSync(junk))
    fs.unlinkSync(newFile); fs.unlinkSync(junk)
  }

  // ---------- 8. Kill switch (child process: env is read at require time) ----------
  {
    const { execFileSync } = require("child_process")
    const recorderPath = path.join(__dirname, "..", "server", "recorder.js")
    const out = execFileSync(process.execPath, [
      "-e",
      "process.env.RECORD_CALLS='0';process.env.RECORDINGS_DIR=" + JSON.stringify(SCRATCH) + ";" +
      "const r=require(" + JSON.stringify(recorderPath) + ");" +
      "console.log(r.createFor('wacall-x') === null ? 'KILLSWITCH-OK' : 'KILLSWITCH-FAIL')",
    ]).toString().trim()
    ok("RECORD_CALLS=0: createFor returns null", out === "KILLSWITCH-OK", out)
  }

  // ---------- 9. transcodeToMp3 negative path ----------
  {
    const bogus = path.join(SCRATCH, "wacall-bogus.wav")
    fs.writeFileSync(bogus, "this is not a wav file at all")
    const mp3 = path.join(SCRATCH, "wacall-bogus.mp3")
    const okTranscode = await transcodeToMp3(bogus, mp3)
    ok("transcode: garbage input → false (no throw)", okTranscode === false || (fs.existsSync(mp3) === false))
    fs.unlinkSync(bogus)
    if (fs.existsSync(mp3)) fs.unlinkSync(mp3)
  }

  fs.rmSync(SCRATCH, { recursive: true, force: true })

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error("test runner crashed:", e)
  process.exit(1)
})
