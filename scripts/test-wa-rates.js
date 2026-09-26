#!/usr/bin/env node
// Rate-correctness proof for the WhatsApp calling stack's TTS decode chain.
//
// WHY THIS EXISTS: the live bug report was "Priya speaks in slow motion".
// Root cause (pre-e75257a): wavToPcm output was assumed to be 24 kHz and
// hand-upsampled ×2 regardless of what the TTS provider actually delivered —
// any 44.1k/48k source played ~1.8-2× slow. The fix resamples by the WAV
// header (ffmpeg, pure-JS fallback). This suite PROVES the invariant that
// matters perceptually:
//
//   1. DURATION is preserved through wavToPcm for EVERY plausible provider
//      rate (8k / 16k / 22.05k / 24k / 44.1k / 48k) — duration drift is
//      exactly what humans hear as slow motion / chipmunk.
//   2. PITCH is preserved (a 440 Hz sine stays ~440 Hz — zero-crossing
//      check) — duration alone can hide a wrong-rate resample.
//   3. The pure-JS fallback (no-ffmpeg path) holds the same invariants.
//   4. parseWav survives non-44-byte layouts (extra LIST/fact chunks).
//
// Run: node scripts/test-wa-rates.js   (uses real ffmpeg when available)

const {
  wavToPcm, parseWav, wavSampleRate, resamplePcmMono, jsWavToPcm48k, upsampleMono,
} = require("../server/whatsapp-calls")

let passed = 0
let failed = 0
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`) }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

// ---------- WAV builders (arbitrary rate / channels, plus extra chunks) ----------

function sinePcm(rate, seconds, freq = 440) {
  const n = Math.round(rate * seconds)
  const pcm = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000), i * 2)
  }
  return pcm
}

/** Canonical 44-byte mono s16 WAV. */
function makeWav(rate, pcm) {
  const h = Buffer.alloc(44)
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8)
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** WAV with a LIST chunk wedged BEFORE fmt (real providers do this) + an
 *  odd-sized chunk to exercise word-alignment padding. */
function makeWavWithExtraChunks(rate, pcm) {
  const list = Buffer.from("LIST\x10\x00\x00\x00INFO" + "x".repeat(12), "ascii") // 16-byte payload, exact
  const odd = Buffer.concat([Buffer.from("JUNK\x03\x00\x00\x00abc", "ascii"), Buffer.alloc(1)]) // 3 bytes + pad
  const fmt = Buffer.alloc(24) // 8-byte chunk header + 16-byte canonical fmt body
  fmt.write("fmt ", 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(1, 10); fmt.writeUInt32LE(rate, 12); fmt.writeUInt32LE(rate * 2, 16)
  fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22)
  const dataHead = Buffer.alloc(8)
  dataHead.write("data", 0); dataHead.writeUInt32LE(pcm.length, 4)
  const body = Buffer.concat([list, odd, fmt, dataHead, pcm])
  const head = Buffer.alloc(12)
  head.write("RIFF", 0); head.writeUInt32LE(4 + body.length, 4); head.write("WAVE", 8)
  return Buffer.concat([head, body])
}

function zeroPcm(rate, seconds) { return Buffer.alloc(Math.round(rate * seconds) * 2) }

// ---------- 1. Duration + pitch through the REAL wavToPcm (ffmpeg path) ----------

async function testWavToPcmRates() {
  console.log("-- wavToPcm (primary ffmpeg path): duration + pitch preserved at every provider rate --")
  const rates = [8000, 16000, 22050, 24000, 44100, 48000]
  for (const rate of rates) {
    const wav = makeWav(rate, sinePcm(rate, 1.0))
    const pcm = await wavToPcm(wav)
    const dur = pcm.length / 2 / 48000
    ok(`${rate} Hz → 48k keeps duration 1.0s`, Math.abs(dur - 1.0) < 0.05, `${dur.toFixed(3)}s (${pcm.length / 2} samples)`)
    // Pitch: zero crossings / 2 ≈ cycles per second. Slow motion halves it.
    let crossings = 0
    for (let i = 1; i < pcm.length / 2; i++) {
      const a = pcm.readInt16LE((i - 1) * 2), b = pcm.readInt16LE(i * 2)
      if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) crossings++
    }
    const hz = crossings / 2 / dur
    ok(`${rate} Hz → 48k keeps pitch ~440 Hz`, Math.abs(hz - 440) < 66, `~${hz.toFixed(0)} Hz`)
  }
  const silent = await wavToPcm(makeWav(16000, zeroPcm(16000, 0.5)))
  ok("silence in → silence out", silent.length / 2 === 24000 && !silent.some((b) => b !== 0), `${silent.length / 2} samples`)

  const extra = makeWavWithExtraChunks(24000, sinePcm(24000, 0.5))
  const viaExtra = await wavToPcm(extra)
  ok("WAV with LIST/JUNK chunks decodes", Math.abs(viaExtra.length / 2 / 48000 - 0.5) < 0.05, `${(viaExtra.length / 2 / 48000).toFixed(3)}s`)
}

// ---------- 2. The pure-JS fallback must hold the SAME invariants ----------

function testJsFallback() {
  console.log("-- jsWavToPcm48k (no-ffmpeg fallback): same duration/pitch invariants --")
  for (const rate of [8000, 16000, 22050, 24000, 44100, 48000]) {
    const pcmIn = sinePcm(rate, 1.0)
    const out = jsWavToPcm48k(makeWav(rate, pcmIn))
    const dur = out.length / 2 / 48000
    ok(`js fallback ${rate} Hz → 48k duration`, Math.abs(dur - 1.0) < 0.001, `${dur.toFixed(4)}s`)
    let crossings = 0
    for (let i = 1; i < out.length / 2; i++) {
      const a = out.readInt16LE((i - 1) * 2), b = out.readInt16LE(i * 2)
      if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) crossings++
    }
    const hz = crossings / 2 / dur
    ok(`js fallback ${rate} Hz → 48k pitch`, Math.abs(hz - 440) < 66, `~${hz.toFixed(0)} Hz`)
  }
  // Stereo folds to mono at the correct length.
  const stereo = Buffer.alloc(24000 * 4)
  for (let i = 0; i < 24000; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 12000)
    stereo.writeInt16LE(v, i * 4); stereo.writeInt16LE(-v, i * 4 + 2)
  }
  const stWav = (() => {
    const h = Buffer.alloc(44)
    h.write("RIFF", 0); h.writeUInt32LE(36 + stereo.length, 4); h.write("WAVE", 8)
    h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
    h.writeUInt16LE(2, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(24000 * 4, 28)
    h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
    h.write("data", 36); h.writeUInt32LE(stereo.length, 40)
    return Buffer.concat([h, stereo])
  })()
  const stOut = jsWavToPcm48k(stWav)
  ok("js fallback stereo → mono duration", Math.abs(stOut.length / 2 / 48000 - 1.0) < 0.001, `${(stOut.length / 2 / 48000).toFixed(4)}s`)
  // 8-bit / non-PCM must be rejected loudly (ffmpeg handles those on the primary path).
  let threw = false
  try {
    const h = makeWav(24000, Buffer.alloc(2400))
    h.writeUInt16LE(8, 34) // claim 8-bit
    jsWavToPcm48k(h)
  } catch { threw = true }
  ok("js fallback rejects non-s16 WAV", threw)
}

// ---------- 3. Resampler primitives + header peek ----------

function testPrimitives() {
  console.log("-- resamplePcmMono / parseWav / wavSampleRate primitives --")
  const ident = resamplePcmMono(sinePcm(48000, 0.25), 48000, 48000)
  ok("identity resample is a copy", ident.length === 24000, `${ident.length / 2} samples`)

  const up = upsampleMono(Buffer.from([0x01, 0x00, 0x02, 0x00, 0x03, 0x00]), 3)
  ok("upsampleMono ×3 length (test-locked API)", up.length === 18, `${up.length} bytes`)

  const empty = resamplePcmMono(Buffer.alloc(0), 24000, 48000)
  ok("empty PCM → empty output", empty.length === 0)

  const wav = makeWavWithExtraChunks(44100, sinePcm(44100, 0.1))
  const parsed = parseWav(wav)
  ok("parseWav walks past LIST/JUNK", parsed.sampleRate === 44100 && parsed.channels === 1 && parsed.bitsPerSample === 16)
  ok("wavSampleRate peeks true rate", wavSampleRate(wav) === 44100)
  ok("wavSampleRate null on garbage", wavSampleRate(Buffer.from("not a wav at all......")) === null)

  let threw = false
  try { parseWav(Buffer.from("RIFF----WAVE-fmt-broken")) } catch { threw = true }
  ok("parseWav throws on truncated header", threw)
}

// ---------- main ----------

;(async () => {
  try { testPrimitives(); testJsFallback(); await testWavToPcmRates() }
  catch (e) { failed++; console.error(`❌ suite crashed: ${e.stack || e.message}`) }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()
