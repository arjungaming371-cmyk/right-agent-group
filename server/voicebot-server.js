// Right Agent Group — Exotel Voicebot server (replaces Twilio + ElevenLabs).
//
// Exotel's Voicebot applet opens a WebSocket to this server and streams the
// caller's audio as base64 PCM (16-bit, 8kHz, mono). We run the full voice
// pipeline ourselves:
//
//   caller audio → silence-based endpointing → STT (self-hosted Whisper)
//     → Next.js /api/calls/turn (Groq = Priya's brain, DB, WhatsApp link)
//     → TTS (self-hosted Edge TTS, server/tts-service — free Microsoft
//       neural voices, one per language, no GPU/API key needed)
//     → downsample to 8kHz PCM → streamed back to the caller.
//
// Exotel setup: Voicebot applet URL = wss://YOUR-DOMAIN/voicebot
// (nginx proxies /voicebot → ws://127.0.0.1:3002 — see nginx snippet in
// UPGRADE-NOTES-v13.md).
//
// Run:  cd server && npm install && node voicebot-server.js
// Prod: pm2 start voicebot-server.js --name voicebot

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") })

const { WebSocketServer } = require("ws")
const { spawn } = require("child_process")

const PORT = parseInt(process.env.VOICEBOT_PORT || "3002")
// APP_INTERNAL_URL first: the app runs on the same machine, and going through
// the public tunnel URL adds a Cloudflare round-trip per turn AND risks the
// proxy buffering the NDJSON stream (which would undo sentence streaming).
const APP_URL = process.env.APP_INTERNAL_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000"
const API_KEY = process.env.WHATSAPP_SERVICE_KEY || "" // shared internal service key
const STT_URL = process.env.STT_URL || process.env.STT_SERVICE_URL || "http://127.0.0.1:3003" // self-hosted Whisper (server/stt-service)

if (!API_KEY) {
  console.error("FATAL: WHATSAPP_SERVICE_KEY not set — the voicebot cannot authenticate to the app.")
  process.exit(1)
}

// ---------- Audio constants (Exotel voicebot: 16-bit signed LE, 8kHz, mono) ----------
const SAMPLE_RATE = 8000
const BYTES_PER_SAMPLE = 2
const FRAME_MS = 20
const FRAME_BYTES = (SAMPLE_RATE * BYTES_PER_SAMPLE * FRAME_MS) / 1000 // 320
// Trimmed from 800ms for faster turn-taking — this delay is pure dead air
// before STT/LLM/TTS even start, on EVERY utterance. Real tradeoff: a caller
// who pauses mid-thought for longer than this gets cut off early. Raise it
// back toward 800ms if real calls start showing utterances split mid-sentence.
const SILENCE_END_MS = 600      // this much silence after speech = end of utterance
const MIN_SPEECH_MS = 250       // ignore blips shorter than this
const MAX_UTTERANCE_MS = 15000  // hard cap per utterance
// avg abs amplitude (0..32767) above this counts as speech. 500 was too high for
// real phone lines — quieter callers never crossed it. 300 is a safer default;
// override per-deployment with VOICEBOT_ENERGY_THRESHOLD once you see the live
// energy numbers the diagnostic log prints for each utterance.
const ENERGY_THRESHOLD = parseInt(process.env.VOICEBOT_ENERGY_THRESHOLD || "300")
// When set, every captured utterance is written to /kaggle/working (or DEBUG_DIR)
// as a .wav so you can play it back / re-feed STT. Off by default.
const DEBUG_DIR = process.env.VOICEBOT_DEBUG_DIR || ""

// ---------- Barge-in (interrupting Priya mid-sentence) ----------
//
// OFF BY DEFAULT, deliberately. Whether this works at all depends on
// something that cannot be determined from code: how much of our own
// outbound audio Exotel echoes back into the inbound media stream on a real
// phone line. If it echoes, Priya hears herself, decides the caller is
// talking, and cuts herself off — every call, every sentence. That failure
// is far worse than the half-duplex behaviour it replaces, so it does not
// get switched on until someone has made a real call with it.
//
// To validate: set VOICEBOT_BARGE_IN=1, call in, and stay SILENT through a
// full reply. If Priya interrupts herself, the line echoes — raise
// VOICEBOT_BARGE_ENERGY until she doesn't, or leave the feature off. Then
// call again and talk over her; she should stop within ~300ms.
const BARGE_IN = (process.env.VOICEBOT_BARGE_IN || "0").trim() === "1"
// Deliberately well above ENERGY_THRESHOLD: a frame only counts as the
// caller interrupting if it is clearly louder than the level we accept as
// speech when the line is otherwise quiet. Echo and line noise sit low.
const BARGE_ENERGY = parseInt(process.env.VOICEBOT_BARGE_ENERGY || String(ENERGY_THRESHOLD * 2))
// ...and it has to be SUSTAINED. A single loud frame is a cough, a door, or
// a codec artefact. A third of a second of continuous energy is someone
// actually talking.
const BARGE_MIN_MS = parseInt(process.env.VOICEBOT_BARGE_MIN_MS || "300")
// How far ahead of real time we let playback run. Audio already handed to
// Exotel cannot be recalled, so this is the worst-case overhang the caller
// still hears after interrupting. With barge-in off it is Infinity, which
// reproduces the original behaviour exactly: push the whole reply into the
// socket at once and let Exotel buffer it.
const PLAYBACK_LEAD_MS = BARGE_IN ? parseInt(process.env.VOICEBOT_PLAYBACK_LEAD_MS || "300") : Infinity

// ---------- Echo probe ----------
//
// Answers the question that keeps barge-in switched off: how much of Priya's
// own audio does Exotel loop back into the inbound stream? Nothing in the code
// can tell you — it depends on the carrier and the handset.
//
// This measures it from ONE ordinary call with barge-in still off, so there is
// no risk to the call at all. Set VOICEBOT_ECHO_PROBE=1, call in, and stay
// SILENT through a full reply. The per-call summary says whether barge-in
// would have falsely fired, and what threshold (if any) would clear the echo.
//
// Independent of VOICEBOT_BARGE_IN on purpose: the numbers describe the
// half-duplex configuration, which is the one you are deciding about.
const ECHO_PROBE = (process.env.VOICEBOT_ECHO_PROBE || "0").trim() === "1"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- STT: self-hosted faster-whisper (server/stt-service.py) ----------
function pcmToWav(pcm) {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28)
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// language="auto" → Whisper auto-detects per utterance. This is what makes
// mid-call language switching work: the transcript comes back in the script
// the caller actually spoke (Telugu/Devanagari/Latin), and the turn API
// switches Priya's language from that. Forcing the current call language here
// would transliterate English speech into Telugu script and lock the call.
async function speechToText(pcm, language) {
  const t0 = Date.now()
  const res = await fetch(`${STT_URL}/transcribe?language=${encodeURIComponent(language)}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav", "x-api-key": API_KEY },
    body: pcmToWav(pcm),
  })
  if (!res.ok) throw new Error(`STT service HTTP ${res.status} — is server/stt-service.py running?`)
  const data = await res.json()
  console.log(`⏱ STT: ${Date.now() - t0}ms`)
  return { text: (data?.text || "").trim(), lowConfidence: !!data?.low_confidence }
}

// Said when the STT service flags its own transcript as unreliable (see
// low_confidence in server/stt-service/app.py) — asking the caller to repeat
// beats sending Whisper's best guess at noise into the LLM, which otherwise
// confidently replies to words the caller never said.
const CLARIFY_PHRASE = {
  english: "Sorry, I didn't quite catch that — could you say that again?",
  telugu: "Sorry andi, naaku sariga vinipinchaledu. Malli oka sari cheppagalara?",
  hindi: "Sorry, mujhe thoda clear sunayi nahi diya. Kya aap dobara bol sakte hain?",
}

// ---------- TTS: server/tts-service — Edge TTS, native Telugu/Hindi voices + English for loanwords ----------
const TTS_URL = process.env.TTS_SERVICE_URL || "http://127.0.0.1:3004"

async function synthesizeSpeech(text, language) {
  const t0 = Date.now()
  const res = await fetch(`${TTS_URL}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ text, language: language || "telugu" }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`TTS service HTTP ${res.status} — is server/tts-service running?`)
  const buf = Buffer.from(await res.arrayBuffer())
  console.log(`⏱ TTS: ${Date.now() - t0}ms  ("${text.slice(0, 40)}${text.length > 40 ? "…" : ""}")`)
  return buf
}

// Playback loudness. Edge TTS output downsampled to 8kHz lands quiet on a
// phone line ("low voice" — caller feedback), so boost by default. alimiter
// caps peaks so the gain can't clip into distortion. Tune per deployment
// with VOICEBOT_TTS_VOLUME (1 = no boost).
const TTS_VOLUME = Math.max(0.5, Math.min(4, parseFloat(process.env.VOICEBOT_TTS_VOLUME || "2.0") || 2.0))

// Telephony voicing chain, applied before the 8kHz resample.
//
// A phone line carries roughly 300-3400Hz. Sub-bass below that is rumble the
// carrier strips anyway, and content above it just folds into the resample —
// but a flat `volume=` boost spent its headroom on that inaudible energy, so
// the part the caller CAN hear stayed quiet. Band-pass first, then compress,
// so the gain works only on real speech.
//
// acompressor is the actual fix for "sometimes too quiet, sometimes too
// loud": Edge TTS level swings sentence to sentence, and especially between
// the native and English voices stitched into one reply (see
// server/tts-service) — a static gain can only ever be right for one of
// them. Pulling peaks down before the makeup gain raises AVERAGE loudness,
// which is what actually carries on a phone line, instead of just making the
// loudest syllable clip.
//
// Measured on real Edge TTS output (the three public/promo/audio clips
// concatenated, so the native+English level swing is in the test):
//   plain volume=2.0  →  -14.6 LUFS integrated, -15.1 dB RMS
//   this chain        →  -12.5 LUFS integrated, -12.9 dB RMS
// ~2dB louder into the same peak ceiling, with no clipping (astats flat
// factor 0 on both).
//
// The highpass sits at 150Hz, NOT the textbook 300Hz: measured across
// 120/150/200/300 the loudness difference was 0.3dB up to 200 and only 300
// cost anything real (-13.2 LUFS) — so there is nothing to gain by cutting
// into a female voice's ~200Hz fundamental and thinning Priya out.
//
// Set VOICEBOT_AUDIO_FILTER=0 to fall back to the old plain-gain behaviour.
const AUDIO_FILTER = (process.env.VOICEBOT_AUDIO_FILTER || "1").trim() !== "0"

function buildAudioFilter() {
  const parts = []
  if (AUDIO_FILTER) {
    parts.push("highpass=f=150", "lowpass=f=3400")
    parts.push("acompressor=threshold=-18dB:ratio=3:attack=5:release=120:makeup=2")
  }
  if (TTS_VOLUME !== 1) parts.push(`volume=${TTS_VOLUME}`)
  // Only meaningful once something above can push the signal up.
  if (parts.length) parts.push("alimiter=limit=0.95")
  return parts.join(",")
}

const AUDIO_FILTER_CHAIN = buildAudioFilter()

/** WAV → 8kHz 16-bit mono PCM via ffmpeg (install once: sudo apt install -y ffmpeg). */
function audioToPcm8k(audio) {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-i", "pipe:0"]
    if (AUDIO_FILTER_CHAIN) args.push("-af", AUDIO_FILTER_CHAIN)
    args.push("-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "1", "pipe:1")
    const ff = spawn("ffmpeg", args)
    const out = []
    const err = []
    ff.stdout.on("data", (c) => out.push(c))
    ff.stderr.on("data", (c) => err.push(c))
    ff.on("error", (e) => reject(new Error(`ffmpeg not found — install it: sudo apt install -y ffmpeg (${e.message})`)))
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(err).toString().slice(0, 200)}`))
      resolve(Buffer.concat(out))
    })
    ff.stdin.on("error", () => {})
    ff.stdin.end(audio)
  })
}

// Memo cache for FIXED phrases (greetings, closings, clarify prompts). These
// are byte-identical on every call, so re-paying the Edge TTS round-trip +
// ffmpeg convert for them is pure dead air on the caller's ear. Capped and
// length-limited so an LLM reply (never identical twice) can't grow it.
const TTS_CACHE_MAX = 64
const TTS_CACHE_MAX_CHARS = 300
const ttsCache = new Map()

async function textToSpeechPcm8k(text, language) {
  const cacheable = text.length <= TTS_CACHE_MAX_CHARS
  const key = `${language}\u0000${text}`
  if (cacheable) {
    const hit = ttsCache.get(key)
    if (hit) {
      console.log(`⏱ TTS: cached  ("${text.slice(0, 40)}${text.length > 40 ? "…" : ""}")`)
      return hit
    }
  }
  const pcm = await audioToPcm8k(await synthesizeSpeech(text, language))
  if (cacheable && pcm.length > 0) {
    if (ttsCache.size >= TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value)
    ttsCache.set(key, pcm)
  }
  return pcm
}

// The FIRST call after a restart used to pay every cold start at once, with
// the caller already on the line: the TTS service imports edge_tts/pydub and
// resolves ffmpeg lazily inside the request, Next.js compiles /api/calls/turn
// on first hit, and the DB pool opens its first connection. Measured as
// several seconds of silence before Priya's first word. Pay all of it at boot
// instead — nobody is listening yet. Failures here are non-fatal: a warm-up
// that can't reach a service just means call #1 is as slow as it used to be.
async function prewarm() {
  const t0 = Date.now()
  const jobs = [
    // Warms edge_tts + pydub/ffmpeg in the TTS service AND ffmpeg in this
    // process. Both languages that need the segment-stitching path.
    textToSpeechPcm8k("Namaskaram!", "telugu").catch((e) => console.error("prewarm TTS(te):", e.message)),
    textToSpeechPcm8k("Hello!", "english").catch((e) => console.error("prewarm TTS(en):", e.message)),
    // Compiles/JITs the turn route and opens the DB pool. "warmup" is not a
    // real call sid, so the route's lookups miss and it returns an error —
    // that is fine, the point is the code path, not the response.
    fetch(`${APP_URL}/api/calls/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ event: "end", callSid: "__prewarm__", duration: 0 }),
    }).catch((e) => console.error("prewarm app:", e.message)),
    fetch(`${STT_URL}/health`, { headers: { "x-api-key": API_KEY } }).catch(() => {}),
  ]
  await Promise.allSettled(jobs)
  console.log(`✓ pipeline pre-warmed in ${Date.now() - t0}ms (TTS cache: ${ttsCache.size})`)
}

// ---------- Bridge to the Next.js app (Priya's brain) ----------
async function callTurnApi(payload) {
  const res = await fetch(`${APP_URL}/api/calls/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`turn API HTTP ${res.status}`)
  return res.json()
}

// Streaming turn: the app sends NDJSON — {"type":"sentence","text"} lines as
// the model writes them, then {"type":"done",language,hangup}. Each sentence
// goes to TTS the moment it arrives, so playback of sentence 1 overlaps
// generation of sentence 2 — the caller stops waiting for the full reply.
async function callTurnApiStream(payload, onEvent) {
  const res = await fetch(`${APP_URL}/api/calls/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ ...payload, stream: true }),
  })
  if (!res.ok) throw new Error(`turn API HTTP ${res.status}`)
  const ct = res.headers.get("content-type") || ""
  if (!ct.includes("ndjson")) {
    // App build without streaming — degrade gracefully to one big sentence.
    const r = await res.json()
    if (r.text) onEvent({ type: "sentence", text: r.text })
    onEvent({ type: "done", language: r.language, hangup: r.hangup })
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split("\n")
    buf = lines.pop() || ""
    for (const line of lines) {
      if (!line.trim()) continue
      try { onEvent(JSON.parse(line)) } catch {}
    }
  }
  if (buf.trim()) { try { onEvent(JSON.parse(buf)) } catch {} }
}

// JS mirror of lib/sentences.ts — used to pipeline FIXED texts (greeting,
// closings) through the same sentence-by-sentence playback as streamed turns.
function splitIntoSentences(text) {
  const out = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (!/[.!?…।॥]/.test(text[i])) continue
    const next = text[i + 1]
    if (next !== undefined && !/\s/.test(next)) continue
    const candidate = text.slice(start, i + 1).trim()
    if (candidate.length < 8) continue
    out.push(candidate)
    start = i + 1
  }
  const rest = text.slice(start).trim()
  if (rest) out.push(rest)
  return out.length ? out : [text.trim()].filter(Boolean)
}

// ---------- Per-call session ----------
class CallSession {
  constructor(ws) {
    this.ws = ws
    this.streamSid = null
    this.callSid = null
    this.language = "telugu"   // Telugu-first; the turn API confirms/switches per caller
    this.startedAt = Date.now() // for real call duration (Voice Logs showed 0:00 without it)
    this.buffer = []          // PCM chunks of current utterance
    this.speechMs = 0
    this.silenceMs = 0
    this.maxEnergy = 0        // loudest frame in the current utterance (diagnostics)
    this.callMaxEnergy = 0    // loudest frame in the whole call (diagnostics)
    this.frameCount = 0       // total media frames received this call (diagnostics)
    this.speaking = false     // caller currently speaking
    this.botTalking = false   // we're currently sending audio (mic muted)
    this.processing = false
    this.closed = false
    this.started = false      // guards against a duplicate Exotel "start" event replaying the greeting mid-call
    // Two-stage playback pipeline: synthChain serializes GPU synthesis (one
    // F5 inference at a time), sendChain serializes playback. Synthesis of
    // sentence N+1 runs WHILE sentence N is playing out to the caller —
    // that overlap is where the "instant reply" feel comes from.
    this.synthChain = Promise.resolve()
    this.sendChain = Promise.resolve()
    this.sendingAudio = false  // inside playPcm — comfort silence must yield
    this.comfortTimer = null
    // Bumped every time queued speech is abandoned (barge-in). Everything
    // asynchronous that was started for a reply carries the epoch it began
    // under and checks it before doing anything the caller would hear, so an
    // interrupted turn's in-flight TTS and playback silently drop instead of
    // playing over whatever comes next.
    this.speechEpoch = 0
    this.bargeMs = 0        // sustained caller energy while Priya is talking
    this.bargeBuffer = []   // frames captured during that window
    // ---- echo probe counters (all inert unless ECHO_PROBE) ----
    this.echoReplyOpen = false  // a reply is currently being measured
    this.echoReplyNo = 0
    this.echoFrames = 0         // inbound frames seen while Priya spoke
    this.echoMs = 0
    this.echoAbove = 0          // ...of which, above BARGE_ENERGY
    this.echoPeak = 0
    this.echoRunMs = 0          // current consecutive run above the threshold
    this.echoRunCounted = false // latch: one long run is ONE would-be fire
    this.echoMaxRunMs = 0
    this.echoFires = 0
    this.echoFirstFireMs = 0
    this.echoCallReplies = 0
    this.echoCallFrames = 0
    this.echoCallMs = 0
    this.echoCallPeak = 0
    this.echoCallMaxRunMs = 0
    this.echoCallFires = 0
    this.echoCallRepliesCut = 0
    this.echoCallerPeak = 0     // loudest frame while the mic was LIVE
    this.echoSummaryDone = false
  }

  /**
   * One frame of echo measurement. Called for every inbound frame when the
   * probe is on, BEFORE any of onMedia's branches, so it sees everything.
   *
   * Deliberately nothing but integer arithmetic on its own fields: onMedia
   * runs straight from the raw ws "message" handler with no try/catch, so a
   * throw here would take down every live call on the process. It reads
   * botTalking and writes only echo* fields — it must never touch frameCount,
   * maxEnergy, speaking, buffer, bargeMs or any other real call state.
   */
  probeFrame(energy, ms) {
    if (!this.botTalking) {
      // Mic is live: this is the CALLER. Tracked separately from the existing
      // callMaxEnergy so the threshold advice below is derived from real
      // caller level, never from the echo it is meant to clear.
      if (energy > this.echoCallerPeak) this.echoCallerPeak = energy
      return
    }
    this.echoFrames++
    this.echoMs += ms
    if (energy > this.echoPeak) this.echoPeak = energy
    // Mirrors interrupt()'s rule exactly — same comparison, same accumulation,
    // same threshold — so "would have fired" means precisely that.
    if (energy > BARGE_ENERGY) {
      this.echoAbove++
      this.echoRunMs += ms
      if (this.echoRunMs > this.echoMaxRunMs) this.echoMaxRunMs = this.echoRunMs
      if (this.echoRunMs >= BARGE_MIN_MS && !this.echoRunCounted) {
        this.echoRunCounted = true
        this.echoFires++
        if (!this.echoFirstFireMs) this.echoFirstFireMs = this.echoMs
      }
    } else {
      this.echoRunMs = 0
      this.echoRunCounted = false
    }
  }

  /** Per-reply echo line. Rolls the reply's numbers into the call totals. */
  probeReport() {
    if (!this.echoReplyOpen) return
    this.echoReplyOpen = false
    this.echoReplyNo++
    this.echoCallReplies++
    this.echoCallFrames += this.echoFrames
    this.echoCallMs += this.echoMs
    this.echoCallFires += this.echoFires
    if (this.echoPeak > this.echoCallPeak) this.echoCallPeak = this.echoPeak
    if (this.echoMaxRunMs > this.echoCallMaxRunMs) this.echoCallMaxRunMs = this.echoMaxRunMs
    if (this.echoFires > 0) this.echoCallRepliesCut++

    const verdict = this.echoFrames === 0
      ? "no inbound audio at all while Priya spoke"
      : this.echoFires > 0
        ? `WOULD HAVE CUT PRIYA OFF at ${this.echoFirstFireMs.toFixed(0)}ms`
        : "clean"
    console.log(
      `🔎 echo reply #${this.echoReplyNo}: ${(this.echoMs / 1000).toFixed(1)}s spoken  ` +
      `peak=${this.echoPeak.toFixed(0)}  above(>${BARGE_ENERGY})=${this.echoAbove}/${this.echoFrames} frames  ` +
      `longestRun=${this.echoMaxRunMs.toFixed(0)}ms (fires at ${BARGE_MIN_MS})  fires=${this.echoFires}  → ${verdict}`
    )
    this.echoFrames = 0
    this.echoMs = 0
    this.echoAbove = 0
    this.echoPeak = 0
    this.echoRunMs = 0
    this.echoRunCounted = false
    this.echoMaxRunMs = 0
    this.echoFires = 0
    this.echoFirstFireMs = 0
  }

  /**
   * End-of-call verdict. Says in words whether barge-in is safe on this line,
   * and — the part that matters — whether raising the threshold would actually
   * help or would just stop real callers interrupting too.
   */
  probeSummary() {
    if (this.echoSummaryDone) return
    this.echoSummaryDone = true
    this.probeReport() // flush a reply still open when the call dropped

    const suggested = Math.ceil((this.echoCallPeak * 1.5) / 50) * 50
    const callerPeak = this.echoCallerPeak
    let verdict
    if (this.echoCallFrames === 0) {
      verdict = "Exotel sent NO inbound audio while Priya was speaking. Nothing echoes —\n" +
                "            but there is also nothing to barge in WITH. Barge-in cannot work on this line."
    } else if (this.echoCallRepliesCut === 0) {
      verdict = `SAFE at the current threshold (${BARGE_ENERGY}). You can set VOICEBOT_BARGE_IN=1.\n` +
                "            Make one more call and talk over her to confirm she actually stops."
    } else if (callerPeak === 0) {
      // Without a caller level there is nothing to compare the echo against,
      // and a threshold recommendation would be a guess dressed up as a number.
      verdict = `NOT SAFE at ${BARGE_ENERGY} — ${this.echoCallRepliesCut} of ${this.echoCallReplies} replies would have been cut.\n` +
                "            But the caller never spoke, so there is no level to compare the echo against\n" +
                "            and no threshold can be recommended yet. Call again, stay silent through one\n" +
                "            reply as before, then say a few words after she finishes."
    } else if (suggested >= callerPeak * 0.6) {
      verdict = `NOT SAFE, and raising the threshold will NOT rescue it. Echo peaked at\n` +
                `            ${this.echoCallPeak.toFixed(0)} while the caller only reached ${callerPeak.toFixed(0)} — clearing the echo\n` +
                `            needs ~${suggested}, too close to the caller's own level to tell them apart.\n` +
                "            Leave VOICEBOT_BARGE_IN off on this line."
    } else {
      verdict = `NOT SAFE at ${BARGE_ENERGY} — ${this.echoCallRepliesCut} of ${this.echoCallReplies} replies would have been cut.\n` +
                `            Try VOICEBOT_BARGE_ENERGY=${suggested} (the caller reached ${callerPeak.toFixed(0)}, so that leaves headroom),\n` +
                "            re-run this probe, and confirm 'replies that would be cut' reaches 0 BEFORE enabling barge-in."
    }
    console.log(
      `\n🔎 ECHO PROBE SUMMARY sid=${this.callSid}\n` +
      `   replies measured         : ${this.echoCallReplies}\n` +
      `   inbound while Priya spoke: ${this.echoCallFrames} frames (${(this.echoCallMs / 1000).toFixed(1)}s)\n` +
      `   echo peak                : ${this.echoCallPeak.toFixed(0)}   (VOICEBOT_BARGE_ENERGY=${BARGE_ENERGY})\n` +
      `   longest sustained run    : ${this.echoCallMaxRunMs.toFixed(0)}ms  (fires at ${BARGE_MIN_MS}ms)\n` +
      `   replies that would be cut: ${this.echoCallRepliesCut} of ${this.echoCallReplies}  (${this.echoCallFires} fires total)\n` +
      `   caller peak, mic live    : ${callerPeak.toFixed(0)}\n` +
      `   VERDICT: ${verdict}\n`
    )
  }

  /**
   * Stream digital silence to the caller whenever we have nothing else to
   * send. Exotel plays its own connect/ringback tone on the answered leg
   * until the Voicebot applet emits its FIRST media packet — so the caller
   * heard "ringing… ringing…" for the whole time we spent on the start API
   * call + TTS, then Priya cut in abruptly. Sending silence from the instant
   * the stream opens makes Exotel drop the tone immediately: the caller hears
   * the line go live (like a normal answered call) and then Priya speaks.
   *
   * It keeps running for the rest of the call, which also fills the mid-turn
   * STT→LLM→TTS gap with an open line instead of whatever Exotel decides to
   * play into dead air.
   */
  startComfortNoise() {
    if (this.comfortTimer || this.closed) return
    const payload = Buffer.alloc(FRAME_BYTES * 5).toString("base64") // 100ms
    this.comfortTimer = setInterval(() => {
      if (this.closed || this.sendingAudio) return
      try {
        this.ws.send(JSON.stringify({
          event: "media",
          stream_sid: this.streamSid,
          media: { payload },
        }))
      } catch {}
    }, 100)
    if (this.comfortTimer.unref) this.comfortTimer.unref()
  }

  stopComfortNoise() {
    if (this.comfortTimer) clearInterval(this.comfortTimer)
    this.comfortTimer = null
  }

  avgEnergy(frame) {
    let sum = 0
    const n = Math.floor(frame.length / 2)
    for (let i = 0; i < n; i++) sum += Math.abs(frame.readInt16LE(i * 2))
    return n ? sum / n : 0
  }

  async onStart(msg) {
    if (this.started) {
      // Exotel resent "start" mid-call (reconnect/retry). Re-running this would
      // replay Priya's greeting and — before the transcript fix above — wipe the
      // conversation history. Just ignore the duplicate and keep the call going.
      console.log(`⚠ duplicate "start" event ignored sid=${this.callSid}`)
      return
    }
    this.started = true
    this.streamSid = msg.stream_sid || msg.streamSid || null
    const start = msg.start || {}
    this.callSid = start.call_sid || start.callSid || start.CallSid || null
    const from = start.from || start.From || ""
    console.log(`▶ call start sid=${this.callSid} from=${from}`)
    // BEFORE the API call, not after — this is what stops Exotel's ringback.
    this.startComfortNoise()
    const t0 = Date.now()
    try {
      const r = await callTurnApi({ event: "start", callSid: this.callSid || "unknown", from })
      console.log(`⏱ start API (answer → greeting text): ${Date.now() - t0}ms`)
      this.language = r.language || "english"
      await this.speak(r.text)
      console.log(`⏱ answer → greeting fully spoken: ${Date.now() - t0}ms`)
    } catch (e) {
      console.error("start error:", e.message)
      await this.speak("Hello! This is Priya from Right Agent Group.").catch(() => {})
    }
  }

  /**
   * The caller started talking over Priya. Abandon everything queued for the
   * current reply and treat the audio that triggered this as the start of
   * their next utterance.
   *
   * Note what this does NOT undo: the turn API call that produced the reply
   * has already run, so the FULL reply is in the saved transcript even
   * though the caller only heard part of it. Priya's next turn therefore
   * believes she said more than the caller heard. That is inherent to
   * barge-in (the text exists before the audio does) and is the main reason
   * to keep BARGE_MIN_MS high enough that this only fires on real speech.
   */
  interrupt() {
    this.speechEpoch++
    this.botTalking = false
    this.processing = false
    this.synthChain = Promise.resolve()
    this.sendChain = Promise.resolve()
    // Carry the frames that triggered the barge-in into the new utterance —
    // dropping them would clip the first third of a second off whatever the
    // caller said, which is usually the word that matters ("no", "wait").
    this.buffer = this.bargeBuffer
    this.speaking = true
    this.speechMs = this.bargeMs
    this.silenceMs = 0
    this.bargeBuffer = []
    this.bargeMs = 0
    console.log(`✋ barge-in — caller cut in, dropping the rest of the reply`)
  }

  onMedia(msg) {
    if (this.closed) return
    const payload = msg.media?.payload
    if (!payload) return
    const frame = Buffer.from(payload, "base64")
    const energy = this.avgEnergy(frame)
    const ms = (frame.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000

    if (ECHO_PROBE) this.probeFrame(energy, ms)

    // Priya is speaking. Half-duplex (the default) ignores the mic entirely;
    // with barge-in on we watch for sustained loud speech and cut her off.
    if (this.botTalking) {
      if (!BARGE_IN) return
      if (energy > BARGE_ENERGY) {
        this.bargeMs += ms
        this.bargeBuffer.push(frame)
        if (this.bargeMs >= BARGE_MIN_MS) this.interrupt()
      } else {
        // Not continuous — start over. Interrupting must take a real run of
        // speech, not a loud frame here and there.
        this.bargeMs = 0
        this.bargeBuffer = []
      }
      return
    }

    // Mid-turn (STT/LLM running, nothing being spoken yet): still ignore.
    if (this.processing) return

    // Diagnostics count ONLY frames captured while the mic is live. These
    // numbers answer "did the caller's audio ever register as speech?" when a
    // call goes quiet — counting frames received while Priya talks would feed
    // them echo of her own voice and mislead exactly the debugging they exist
    // for. (The barge-in change briefly moved these above the guards above;
    // this is the behaviour from before that.)
    this.frameCount++
    if (energy > this.maxEnergy) this.maxEnergy = energy
    if (energy > this.callMaxEnergy) this.callMaxEnergy = energy

    if (energy > ENERGY_THRESHOLD) {
      this.speaking = true
      this.speechMs += ms
      this.silenceMs = 0
      this.buffer.push(frame)
    } else if (this.speaking) {
      this.silenceMs += ms
      this.buffer.push(frame)
      if (this.silenceMs >= SILENCE_END_MS || this.speechMs >= MAX_UTTERANCE_MS) {
        this.endUtterance()
      }
    }
  }

  async endUtterance() {
    const pcm = Buffer.concat(this.buffer)
    const hadRealSpeech = this.speechMs >= MIN_SPEECH_MS
    const durationMs = (pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000
    const maxEnergy = this.maxEnergy
    this.buffer = []
    this.speaking = false
    this.speechMs = 0
    this.silenceMs = 0
    this.maxEnergy = 0
    if (!hadRealSpeech || this.processing) return

    // The epoch this turn belongs to. If the caller barges in partway
    // through, every step below stops mattering and must not clobber the
    // state the interrupt already handed to the newer turn.
    const epoch = this.speechEpoch
    this.processing = true
    try {
      // Always-on diagnostics: if a call ever goes silent again, these numbers
      // say exactly why (threshold too high vs. empty/garbled capture).
      console.log(`🎙 utterance: ${durationMs.toFixed(0)}ms  maxEnergy=${maxEnergy.toFixed(0)}  threshold=${ENERGY_THRESHOLD}  bytes=${pcm.length}`)
      if (DEBUG_DIR) {
        try {
          const f = require("path").join(DEBUG_DIR, `utt-${Date.now()}.wav`)
          require("fs").writeFileSync(f, pcmToWav(pcm))
          console.log(`   saved ${f}`)
        } catch (e) { console.error("   dump failed:", e.message) }
      }
      // Pass the call's KNOWN language instead of "auto" — Whisper's language
      // auto-detection runs an extra pass before every transcription, and on
      // this CPU-only setup that dwarfed the actual decode time (observed
      // live: a 1.6s "Yes, yes." utterance took 9.5s to transcribe, almost
      // entirely detection overhead, not the 3-4 words themselves).
      const turnT0 = Date.now()
      const { text: transcript, lowConfidence } = await speechToText(pcm, this.language)
      console.log(`👂 [${this.language}]${lowConfidence ? " LOW-CONFIDENCE" : ""} "${transcript}"`)
      if (!transcript) return

      if (lowConfidence) {
        // Bypass the LLM entirely — never let it reply to a transcript we
        // already know is likely wrong, and never let the garbled text into
        // conversation history where it would keep confusing later turns.
        const phrase = CLARIFY_PHRASE[this.language] || CLARIFY_PHRASE.english
        console.log(`🗣 (clarify) ${phrase}`)
        this.queueSentence(phrase, epoch)
        // No reportSpoken here on purpose: this branch never calls the app, so
        // there is no "ai" entry for this turn — a correction would silently
        // overwrite the PREVIOUS turn's reply instead.
        await this.drainSpeech(epoch)
        console.log(`⏱ TOTAL turn (silence → reply fully sent): ${Date.now() - turnT0}ms`)
        return
      }

      // STREAMED turn: sentences arrive while the model is still writing and
      // go straight into the TTS/playback pipeline. The caller hears sentence
      // 1 while sentence 2 is still being generated.
      let hangup = false
      let firstSentenceAt = null
      // Sentences whose playback actually started. Local to this turn, not a
      // field: after an interrupt the NEXT turn can start (and be interrupted
      // itself) while this one is still awaiting the model, and a shared
      // field would be clobbered in that window.
      const spoken = []
      const brainT0 = Date.now()
      await this.turnStream(
        { event: "turn", callSid: this.callSid || "unknown", speech: transcript, language: this.language },
        (ev) => {
          if (ev.type === "sentence" && ev.text) {
            if (!firstSentenceAt) {
              firstSentenceAt = Date.now()
              console.log(`⏱ brain (time to first sentence): ${firstSentenceAt - brainT0}ms`)
            }
            console.log(`🗣 ${ev.text}`)
            this.queueSentence(ev.text, epoch, spoken)
          } else if (ev.type === "done") {
            if (ev.language) this.language = ev.language
            hangup = !!ev.hangup
          }
        }
      )
      console.log(`⏱ brain (full generation): ${Date.now() - brainT0}ms`)
      await this.drainSpeech(epoch)
      // Interrupted? Correct the transcript down to what actually played.
      // Skipped when the socket is gone — the full text beats a correction
      // racing post-call analysis.
      if (epoch !== this.speechEpoch && !this.closed) await this.reportSpoken(spoken)
      // Total turn: from "caller stopped talking" to "all of Priya's audio
      // has been sent back" — this is the real silence the caller sat through.
      console.log(`⏱ TOTAL turn (silence → reply fully sent): ${Date.now() - turnT0}ms`)
      // Never hang up on an interrupted turn: the caller is mid-sentence, and
      // the goodbye that triggered this belongs to a reply they never heard.
      if (hangup && epoch === this.speechEpoch) this.hangupAfterAudio()
    } catch (e) {
      console.error("turn error:", e.message)
    } finally {
      // Only if this turn is still the current one — after a barge-in the
      // interrupt already reset processing for the turn that replaced it.
      if (epoch === this.speechEpoch) this.processing = false
    }
  }

  /**
   * Sends synthesized PCM to the caller and waits out its real duration.
   *
   * Paced rather than dumped: we stay at most PLAYBACK_LEAD_MS of audio
   * ahead of real time, so an interrupt stops the reply within that window.
   * Dumping the whole clip into the socket (what this used to do, and still
   * does when barge-in is off, since the lead is then Infinity) means every
   * byte is already buffered inside Exotel and nothing can call it back —
   * barge-in would cut the text but the caller would keep hearing audio.
   */
  async playPcm(pcm8k, epoch) {
    // stream in 100ms chunks, padded to whole frames
    const CHUNK = FRAME_BYTES * 5
    const bytesToMs = (n) => (n / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000
    this.sendingAudio = true // pause comfort silence so it can't interleave
    const startedAt = Date.now()
    let queuedMs = 0
    try {
      for (let off = 0; off < pcm8k.length; off += CHUNK) {
        if (this.closed || epoch !== this.speechEpoch) return
        let chunk = pcm8k.subarray(off, Math.min(off + CHUNK, pcm8k.length))
        if (chunk.length % FRAME_BYTES !== 0) {
          chunk = Buffer.concat([chunk, Buffer.alloc(FRAME_BYTES - (chunk.length % FRAME_BYTES))])
        }
        this.ws.send(JSON.stringify({
          event: "media",
          stream_sid: this.streamSid,
          media: { payload: chunk.toString("base64") },
        }))
        queuedMs += bytesToMs(chunk.length)
        // Hand over the next chunk only once we've drifted back inside the
        // lead. Keeping a lead (rather than sending exactly in real time)
        // is what stops timer jitter from starving the caller's playout.
        const aheadMs = queuedMs - (Date.now() - startedAt)
        if (aheadMs > PLAYBACK_LEAD_MS) await sleep(aheadMs - PLAYBACK_LEAD_MS)
      }
      // keep mic muted until playback roughly finishes on the caller's side;
      // the 200ms tail doubles as a natural inter-sentence pause.
      const remainingMs = queuedMs - (Date.now() - startedAt)
      if (remainingMs > 0) await sleep(remainingMs)
      if (!this.closed && epoch === this.speechEpoch) await sleep(200)
    } finally {
      this.sendingAudio = false
    }
  }

  /**
   * Queue one sentence into the playback pipeline. Returns immediately —
   * synthesis is chained after the previous synthesis (one GPU inference at
   * a time), playback after the previous playback. Callers await
   * drainSpeech() when they need "everything has been said".
   */
  /**
   * Queue one sentence for playback under the epoch of the TURN that produced
   * it — `turnEpoch`, not whatever the epoch happens to be right now.
   *
   * That distinction is the whole point. Sentences arrive one at a time from
   * the model's NDJSON stream, so a barge-in lands in the MIDDLE of a reply
   * being queued. Reading the current epoch here would stamp every sentence
   * that arrives after the interrupt with the NEW epoch, match, and play it —
   * Priya talking straight over the caller, which is precisely what barge-in
   * is supposed to stop. It would also re-set botTalking mid-utterance,
   * re-muting the caller's mic.
   *
   * `spoken`, when passed, collects the sentences whose playback actually
   * started, so the transcript can be corrected to what the caller heard.
   */
  queueSentence(text, turnEpoch, spoken) {
    const clean = (text || "").trim()
    if (!clean || this.closed) return
    // undefined => "whatever is current", so a missed call site degrades to
    // the old behaviour rather than going silent.
    const epoch = turnEpoch === undefined ? this.speechEpoch : turnEpoch
    if (epoch !== this.speechEpoch) return // this turn was abandoned
    if (ECHO_PROBE && !this.botTalking) this.echoReplyOpen = true
    this.botTalking = true
    const synth = this.synth(clean, epoch)
    this.synthChain = synth
    this.sendChain = this.sendChain.then(async () => {
      const pcm = await synth
      if (pcm && pcm.length > 0 && !this.closed && epoch === this.speechEpoch) {
        // Reaching here means the first chunk is about to hit the wire, and
        // interrupt() runs synchronously from onMedia so it cannot interleave
        // between this check and the push. Pushed <=> the caller heard at
        // least the start of this sentence.
        if (spoken) spoken.push(clean)
        await this.playPcm(pcm, epoch)
      }
    })
  }

  /** Extracted verbatim so tests can replace it without a TTS service. */
  synth(text, epoch) {
    return this.synthChain.then(() =>
      this.closed || epoch !== this.speechEpoch
        ? null
        : textToSpeechPcm8k(text, this.language).catch((e) => {
            console.error("TTS error:", e.message)
            return null
          })
    )
  }

  /** Extracted verbatim so tests can replace it without the Next.js app. */
  turnStream(payload, onEvent) {
    return callTurnApiStream(payload, onEvent)
  }

  /**
   * Wait until every queued sentence has fully played, then unmute the mic.
   * After a barge-in the epoch has moved on and the mic is already live —
   * clearing botTalking here would stomp on a turn that has since started.
   */
  async drainSpeech(epoch) {
    await this.sendChain
    if (epoch === undefined || epoch === this.speechEpoch) {
      this.botTalking = false
      // Every speech path — greeting, clarify phrase, streamed turn, closing —
      // ends here, so this is the one place that closes a measured reply.
      if (ECHO_PROBE) this.probeReport()
    }
  }

  /** Speak a fixed text (greeting/closing): pipelined sentence-by-sentence. */
  async speak(text) {
    if (!text || this.closed) return
    const epoch = this.speechEpoch
    for (const s of splitIntoSentences(text)) this.queueSentence(s, epoch)
    await this.drainSpeech(epoch)
  }

  /**
   * Tell the app what the caller ACTUALLY heard, after a barge-in cut a reply
   * short. Without this the full generated reply stays in the transcript, and
   * getHistory feeds it back next turn — so Priya carries on believing she
   * said things the caller never heard.
   *
   * Sent only after callTurnApiStream has returned, which means the app has
   * committed its transcript append (it awaits the write before emitting
   * "done"), so the row this corrects is guaranteed to exist.
   */
  async reportSpoken(spoken) {
    if (!this.callSid) return
    const said = spoken.join(" ").trim()
    const text = said
      ? `${said} …(interrupted by the customer)`
      : "(the customer interrupted before Priya said anything)"
    try {
      const r = await callTurnApi({ event: "spoken", callSid: this.callSid, text })
      console.log(`✂ transcript corrected to ${spoken.length} spoken sentence(s)${r?.corrected ? "" : " — no matching entry"}`)
    } catch (e) {
      console.error("spoken correction error:", e.message)
    }
  }

  hangupAfterAudio() {
    this.closed = true
    this.stopComfortNoise()
    console.log(`⏹ hangup sid=${this.callSid}`)
    setTimeout(() => { try { this.ws.close() } catch {} }, 500)
  }

  // Report the real call duration to the app. Exotel's status webhook does not
  // fire for inbound voicebot calls, so without this every inbound call showed
  // 0:00 in Voice Logs. Idempotent (flag + GREATEST() server-side), called from
  // both "stop" and the socket close handler — whichever happens first wins.
  reportEnd() {
    // First, and with its own guard: reportEnd is the one thing guaranteed to
    // run on both the Exotel "stop" event and a raw socket close, and putting
    // the summary ahead of the early returns means it still prints when
    // callSid was never set.
    if (ECHO_PROBE) this.probeSummary()
    if (this.endReported) return
    if (!this.callSid) {
      console.error(`⚠ reportEnd skipped — callSid was never set, duration lost (start event may be missing/malformed)`)
      return
    }
    this.endReported = true
    const duration = Math.round((Date.now() - this.startedAt) / 1000)
    callTurnApi({ event: "end", callSid: this.callSid, duration }).catch((e) =>
      console.error("end report error:", e.message)
    )
  }
}

// ---------- WebSocket server ----------
// Guarded so the module can be require()d without binding a port or firing
// the warm-up — that is what lets the barge-in/playback logic be tested
// against a fake socket instead of only on a live phone call.
function startServer() {
const wss = new WebSocketServer({ port: PORT, host: "127.0.0.1", path: "/voicebot" })

wss.on("connection", (ws) => {
  const session = new CallSession(ws)
  ws.on("message", (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    switch (msg.event) {
      case "connected": break
      case "start": session.onStart(msg); break
      case "media": session.onMedia(msg); break
      case "stop":
        session.closed = true
        session.stopComfortNoise()
        // Call-wide peak energy: if this is well below ENERGY_THRESHOLD, the caller's
        // audio never registered as speech and the threshold needs lowering. If it's
        // high but transcripts were empty, the problem is capture/format, not volume.
        console.log(`■ call stop sid=${session.callSid}  frames=${session.frameCount}  callMaxEnergy=${session.callMaxEnergy.toFixed(0)}  threshold=${ENERGY_THRESHOLD}`)
        session.reportEnd()
        try { ws.close() } catch {}
        break
    }
  })
  ws.on("close", () => { session.closed = true; session.stopComfortNoise(); session.reportEnd() })
  ws.on("error", (e) => console.error("ws error:", e.message))
})

console.log(`Voicebot server listening on ws://127.0.0.1:${PORT}/voicebot (put nginx wss in front) — TTS: edge-tts @ ${TTS_URL}`)
console.log(`   barge-in: ${BARGE_IN ? `ON (energy>${BARGE_ENERGY} for ${BARGE_MIN_MS}ms, ${PLAYBACK_LEAD_MS}ms playback lead)` : "off — set VOICEBOT_BARGE_IN=1 to enable"}`)

// Fire-and-forget: the socket is already accepting calls, so a slow warm-up
// never blocks startup — it just means an early call misses the cache.
prewarm()
}

if (require.main === module) startServer()

module.exports = { CallSession, startServer, buildAudioFilter, splitIntoSentences }
