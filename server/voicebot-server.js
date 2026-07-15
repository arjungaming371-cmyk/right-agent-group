// Right Agent Group — Exotel Voicebot server (replaces Twilio + ElevenLabs).
//
// Exotel's Voicebot applet opens a WebSocket to this server and streams the
// caller's audio as base64 PCM (16-bit, 8kHz, mono). We run the full voice
// pipeline ourselves:
//
//   caller audio → silence-based endpointing → STT (self-hosted Whisper)
//     → Next.js /api/calls/turn (Ollama = Priya's brain, DB, WhatsApp link)
//     → TTS (free Microsoft Edge neural voices — no GPU server needed)
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
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts")
const { spawn } = require("child_process")

const PORT = parseInt(process.env.VOICEBOT_PORT || "3002")
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000"
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

// ---------- TTS: free Microsoft Edge neural voices (no GPU server) ----------
const EDGE_VOICES = {
  english: "en-IN-NeerjaNeural",
  hindi: "hi-IN-SwaraNeural",
  telugu: "te-IN-ShrutiNeural",
}

async function synthesizeSpeech(text, language) {
  const tts = new MsEdgeTTS()
  await tts.setMetadata(EDGE_VOICES[language] || EDGE_VOICES.english, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
  const { audioStream } = tts.toStream(text)
  const chunks = []
  await new Promise((resolve, reject) => {
    audioStream.on("data", (c) => chunks.push(c))
    audioStream.on("end", resolve)
    audioStream.on("error", reject)
  })
  return Buffer.concat(chunks)
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

      const r = await callTurnApi({ event: "turn", callSid: this.callSid || "unknown", speech: transcript, language: this.language })
      if (r.language) this.language = r.language
      await this.speak(r.text)
      if (r.hangup) this.hangupAfterAudio()
    } catch (e) {
      console.error("turn error:", e.message)
    } finally {
      this.processing = false
    }
  }

  async speak(text) {
    if (!text || this.closed) return
    this.botTalking = true
    try {
      const pcm8k = await textToSpeechPcm8k(text, this.language)
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
      // keep mic muted until playback roughly finishes on the caller's side
      const durationMs = (pcm8k.length / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000
      await new Promise((r) => setTimeout(r, durationMs + 200))
    } catch (e) {
      console.error("TTS error:", e.message)
    } finally {
      this.botTalking = false
    }
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

console.log(`Voicebot server listening on ws://127.0.0.1:${PORT}/voicebot (put nginx wss in front) — TTS: edge`)
