// Right Agent Group — Exotel Voicebot server (replaces Twilio + ElevenLabs).
//
// Exotel's Voicebot applet opens a WebSocket to this server and streams the
// caller's audio as base64 PCM (16-bit, 8kHz, mono). We run the full voice
// pipeline ourselves:
//
//   caller audio → silence-based endpointing → STT (self-hosted Whisper)
//     → Next.js /api/calls/turn (Ollama = Priya's brain, DB, WhatsApp link)
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
const SILENCE_END_MS = 800      // this much silence after speech = end of utterance
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
  const res = await fetch(`${STT_URL}/transcribe?language=${encodeURIComponent(language)}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav", "x-api-key": API_KEY },
    body: pcmToWav(pcm),
  })
  if (!res.ok) throw new Error(`STT service HTTP ${res.status} — is server/stt-service.py running?`)
  const data = await res.json()
  return (data?.text || "").trim()
}

// ---------- TTS: Edge TTS (server/tts-service, Microsoft neural voices, CPU-only) ----------
const TTS_URL = process.env.TTS_SERVICE_URL || "http://127.0.0.1:3004"

async function synthesizeSpeech(text, language) {
  const res = await fetch(`${TTS_URL}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ text, language: language || "telugu" }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`TTS service HTTP ${res.status} — is server/tts-service running?`)
  return Buffer.from(await res.arrayBuffer())
}

// Playback loudness. Edge TTS output downsampled to 8kHz lands quiet on a
// phone line ("low voice" — caller feedback), so boost by default. alimiter
// caps peaks so the gain can't clip into distortion. Tune per deployment
// with VOICEBOT_TTS_VOLUME (1 = no boost).
const TTS_VOLUME = Math.max(0.5, Math.min(4, parseFloat(process.env.VOICEBOT_TTS_VOLUME || "2.0") || 2.0))

/** WAV → 8kHz 16-bit mono PCM via ffmpeg (install once: sudo apt install -y ffmpeg). */
function audioToPcm8k(audio) {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-i", "pipe:0"]
    if (TTS_VOLUME !== 1) args.push("-af", `volume=${TTS_VOLUME},alimiter=limit=0.95`)
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

async function textToSpeechPcm8k(text, language) {
  return audioToPcm8k(await synthesizeSpeech(text, language))
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
    try {
      const r = await callTurnApi({ event: "start", callSid: this.callSid || "unknown", from })
      this.language = r.language || "english"
      await this.speak(r.text)
    } catch (e) {
      console.error("start error:", e.message)
      await this.speak("Hello! This is Priya from Right Agent Group.").catch(() => {})
    }
  }

  onMedia(msg) {
    if (this.botTalking || this.processing || this.closed) return // half-duplex: ignore mic while Priya talks
    const payload = msg.media?.payload
    if (!payload) return
    const frame = Buffer.from(payload, "base64")
    const energy = this.avgEnergy(frame)
    const ms = (frame.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000
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
      const transcript = await speechToText(pcm, "auto")
      console.log(`👂 [${this.language}] "${transcript}"`)
      if (!transcript) return

      // STREAMED turn: sentences arrive while the model is still writing and
      // go straight into the TTS/playback pipeline. The caller hears sentence
      // 1 while sentence 2 is still being generated.
      let hangup = false
      await callTurnApiStream(
        { event: "turn", callSid: this.callSid || "unknown", speech: transcript, language: this.language },
        (ev) => {
          if (ev.type === "sentence" && ev.text) {
            console.log(`🗣 ${ev.text}`)
            this.queueSentence(ev.text)
          } else if (ev.type === "done") {
            if (ev.language) this.language = ev.language
            hangup = !!ev.hangup
          }
        }
      )
      await this.drainSpeech()
      if (hangup) this.hangupAfterAudio()
    } catch (e) {
      console.error("turn error:", e.message)
    } finally {
      this.processing = false
    }
  }

  /** Sends synthesized PCM to the caller and waits out its real duration. */
  async playPcm(pcm8k) {
    // stream in 100ms chunks, padded to whole frames
    const CHUNK = FRAME_BYTES * 5
    for (let off = 0; off < pcm8k.length; off += CHUNK) {
      if (this.closed) return
      let chunk = pcm8k.subarray(off, Math.min(off + CHUNK, pcm8k.length))
      if (chunk.length % FRAME_BYTES !== 0) {
        chunk = Buffer.concat([chunk, Buffer.alloc(FRAME_BYTES - (chunk.length % FRAME_BYTES))])
      }
      this.ws.send(JSON.stringify({
        event: "media",
        stream_sid: this.streamSid,
        media: { payload: chunk.toString("base64") },
      }))
    }
    // keep mic muted until playback roughly finishes on the caller's side;
    // the 200ms tail doubles as a natural inter-sentence pause.
    const durationMs = (pcm8k.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000
    await new Promise((r) => setTimeout(r, durationMs + 200))
  }

  /**
   * Queue one sentence into the playback pipeline. Returns immediately —
   * synthesis is chained after the previous synthesis (one GPU inference at
   * a time), playback after the previous playback. Callers await
   * drainSpeech() when they need "everything has been said".
   */
  queueSentence(text) {
    const clean = (text || "").trim()
    if (!clean || this.closed) return
    this.botTalking = true
    const synth = this.synthChain.then(() =>
      this.closed ? null : textToSpeechPcm8k(clean, this.language).catch((e) => {
        console.error("TTS error:", e.message)
        return null
      })
    )
    this.synthChain = synth
    this.sendChain = this.sendChain.then(async () => {
      const pcm = await synth
      if (pcm && pcm.length > 0 && !this.closed) await this.playPcm(pcm)
    })
  }

  /** Wait until every queued sentence has fully played, then unmute the mic. */
  async drainSpeech() {
    await this.sendChain
    this.botTalking = false
  }

  /** Speak a fixed text (greeting/closing): pipelined sentence-by-sentence. */
  async speak(text) {
    if (!text || this.closed) return
    for (const s of splitIntoSentences(text)) this.queueSentence(s)
    await this.drainSpeech()
  }

  hangupAfterAudio() {
    this.closed = true
    console.log(`⏹ hangup sid=${this.callSid}`)
    setTimeout(() => { try { this.ws.close() } catch {} }, 500)
  }

  // Report the real call duration to the app. Exotel's status webhook does not
  // fire for inbound voicebot calls, so without this every inbound call showed
  // 0:00 in Voice Logs. Idempotent (flag + GREATEST() server-side), called from
  // both "stop" and the socket close handler — whichever happens first wins.
  reportEnd() {
    if (this.endReported || !this.callSid) return
    this.endReported = true
    const duration = Math.round((Date.now() - this.startedAt) / 1000)
    callTurnApi({ event: "end", callSid: this.callSid, duration }).catch((e) =>
      console.error("end report error:", e.message)
    )
  }
}

// ---------- WebSocket server ----------
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
        // Call-wide peak energy: if this is well below ENERGY_THRESHOLD, the caller's
        // audio never registered as speech and the threshold needs lowering. If it's
        // high but transcripts were empty, the problem is capture/format, not volume.
        console.log(`■ call stop sid=${session.callSid}  frames=${session.frameCount}  callMaxEnergy=${session.callMaxEnergy.toFixed(0)}  threshold=${ENERGY_THRESHOLD}`)
        session.reportEnd()
        try { ws.close() } catch {}
        break
    }
  })
  ws.on("close", () => { session.closed = true; session.reportEnd() })
  ws.on("error", (e) => console.error("ws error:", e.message))
})

console.log(`Voicebot server listening on ws://127.0.0.1:${PORT}/voicebot (put nginx wss in front) — TTS: edge-tts @ ${TTS_URL}`)
