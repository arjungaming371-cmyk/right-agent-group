// Right Agent Group — Exotel Voicebot server (replaces Twilio + ElevenLabs).
//
// Exotel's Voicebot applet opens a WebSocket to this server and streams the
// caller's audio as base64 PCM (16-bit, 8kHz, mono). We run the full voice
// pipeline ourselves:
//
//   caller audio → silence-based endpointing → STT (self-hosted Whisper)
//     → Next.js /api/calls/turn (Ollama = Priya's brain, DB, WhatsApp link)
//     → TTS (Sarvam AI bulbul:v3 — Indic neural voices: en-IN / hi-IN / te-IN)
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

// TTS provider: "edge" (default, FREE) or "sarvam" (paid, more natural Indic voices).
const TTS_PROVIDER = (process.env.TTS_PROVIDER || "edge").toLowerCase()
const SARVAM_API_KEY = process.env.SARVAM_API_KEY || ""
const SARVAM_SPEAKER = process.env.SARVAM_SPEAKER || "priya"

if (!API_KEY) {
  console.error("FATAL: WHATSAPP_SERVICE_KEY not set — the voicebot cannot authenticate to the app.")
  process.exit(1)
}
if (TTS_PROVIDER === "sarvam" && !SARVAM_API_KEY) {
  console.error("FATAL: TTS_PROVIDER=sarvam but SARVAM_API_KEY not set. Get one at https://dashboard.sarvam.ai or switch to TTS_PROVIDER=edge (free).")
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
const ENERGY_THRESHOLD = 500    // avg abs amplitude above this = speech

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

// ---------- TTS: switchable — Edge (free, default) or Sarvam (paid) ----------
const LANG_CODES = {
  english: "en-IN",
  hindi: "hi-IN",
  telugu: "te-IN",
}
const EDGE_VOICES = {
  english: "en-IN-NeerjaNeural",
  hindi: "hi-IN-SwaraNeural",
  telugu: "te-IN-ShrutiNeural",
}

async function edgeSpeech(text, language) {
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

async function sarvamSpeech(text, language) {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": SARVAM_API_KEY },
    body: JSON.stringify({
      text,
      target_language_code: LANG_CODES[language] || LANG_CODES.english,
      model: "bulbul:v3",
      speaker: SARVAM_SPEAKER,
      output_audio_codec: "wav",
    }),
  })
  if (!res.ok) throw new Error(`Sarvam TTS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const b64 = data?.audios?.[0]
  if (!b64) throw new Error("Sarvam TTS returned no audio")
  return Buffer.from(b64, "base64")
}

function synthesizeSpeech(text, language) {
  return TTS_PROVIDER === "sarvam" ? sarvamSpeech(text, language) : edgeSpeech(text, language)
}

/** WAV → 8kHz 16-bit mono PCM via ffmpeg (install once: sudo apt install -y ffmpeg). */
function audioToPcm8k(audio) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "1", "pipe:1"])
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
    this.language = "english"
    this.buffer = []          // PCM chunks of current utterance
    this.speechMs = 0
    this.silenceMs = 0
    this.speaking = false     // caller currently speaking
    this.botTalking = false   // we're currently sending audio (mic muted)
    this.processing = false
    this.closed = false
  }

  avgEnergy(frame) {
    let sum = 0
    const n = Math.floor(frame.length / 2)
    for (let i = 0; i < n; i++) sum += Math.abs(frame.readInt16LE(i * 2))
    return n ? sum / n : 0
  }

  async onStart(msg) {
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
    this.buffer = []
    this.speaking = false
    this.speechMs = 0
    this.silenceMs = 0
    if (!hadRealSpeech || this.processing) return

    this.processing = true
    try {
      const transcript = await speechToText(pcm, this.language)
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
        console.log(`■ call stop sid=${session.callSid}`)
        try { ws.close() } catch {}
        break
    }
  })
  ws.on("close", () => { session.closed = true })
  ws.on("error", (e) => console.error("ws error:", e.message))
})

console.log(`Voicebot server listening on ws://127.0.0.1:${PORT}/voicebot (put nginx wss in front) — TTS: ${TTS_PROVIDER}`)
