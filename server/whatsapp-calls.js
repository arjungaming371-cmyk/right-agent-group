// Right Agent Group — WhatsApp Business Calling voice bridge.
//
// Meta's WhatsApp Business Calling API (Cloud API) delivers a customer's
// WhatsApp voice call as a WEBRTC offer inside the webhook ("calls" field,
// event "connect"). The Next.js webhook forwards that offer to this server;
// we answer it with werift (pure-JS WebRTC — no native WebRTC deps), and the
// audio then flows directly between Meta's media server and this process:
//
//   caller (WhatsApp app) ⇄ Meta SFU ⇄ [WERIFT/SRTP] ⇄ this file
//
// Pipeline — deliberately the SAME brain as the Exotel voicebot:
//
//   opus RTP in (48 kHz) → decode → silence-based endpointing (same state
//   machine as voicebot-server's CallSession) → Sarvam Saaras STT
//     → Next.js /api/calls/turn  (Groq/Sarvam LLM = Priya, DB, Lead Brain)
//     → Cartesia/Sarvam TTS (WAV, ANY rate) → resample to 48 kHz by the WAV
//       header (ffmpeg, pure-JS fallback) → opus RTP out (48 kHz)
//
// STT stays Sarvam, the LLM stays Groq (via the app's turn API) and TTS
// defaults to CARTESIA for WhatsApp calls (VOICEBOT_WA_TTS_PROVIDER=cartesia,
// the default). Sarvam TTS remains the automatic fallback when no Cartesia
// key is configured, so a call never dies for lack of a TTS provider.
//
// WhatsApp calls are IP-to-IP wideband audio with the WhatsApp client's own
// echo cancellation, so — unlike the 8 kHz Exotel line — barge-in is safe to
// default ON here, and no telephony filter chain (band-pass/compressor) is
// applied: the caller hears studio-quality audio straight from Cartesia.
//
// Signalling flow (incoming call):
//   1. Meta webhook → Next.js /api/whatsapp (field "calls", event "connect",
//      session.sdp = offer)
//   2. Next.js POSTs the offer here → createCallAnswer() returns our SDP answer
//   3. Next.js calls Graph API  POST /{phone_number_id}/calls
//      action=pre_accept (with the answer) then action=accept (same answer)
//   4. ICE/DTLS/SRTP connect; the pacer starts streaming; Priya greets.
//
// Run by voicebot-server.js (HTTP on 127.0.0.1:VOICEBOT_HTTP_PORT, default
// 3003, auth = WHATSAPP_SERVICE_KEY). Both directions are implemented:
//   • INBOUND  (customer → business, free): the webhook carries Meta's offer,
//     we answer — see startSession().
//   • OUTBOUND (business → customer, needs Meta call permission): WE create
//     the offer, Graph action=connect rings the customer, Meta's webhook
//     later delivers the answer — see createOutboundOffer() /
//     attachOutboundSession(). Outbound reuses the ENTIRE session machinery
//     below (pacer, endpointing, turns, recording) — only the SDP direction
//     flips.
//
// Dependencies (server/package.json): werift, @discordjs/opus.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") })

const crypto = require("crypto")
const { spawn } = require("child_process")
const {
  RTCPeerConnection,
  MediaStreamTrack,
  RtpPacket,
  RtpHeader,
} = require("werift")
const { OpusEncoder } = require("@discordjs/opus")
const voiceProviders = require("./voice-providers")
const recorder = require("./recorder")

// ---------- Configuration ----------

const APP_URL = process.env.APP_INTERNAL_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000"
const API_KEY = process.env.WHATSAPP_SERVICE_KEY || ""

// Wideband end to end — opus on the WebRTC leg, 16 kHz WAV for Saaras STT.
const WA_RATE = 48000            // opus / WebRTC clock rate
const WA_FRAME_SAMPLES = 960     // 20 ms
const WA_FRAME_BYTES = WA_FRAME_SAMPLES * 2
const STT_RATE = parseInt(process.env.VOICEBOT_WA_STT_SAMPLE_RATE || "16000")
const DSR = WA_RATE / STT_RATE   // decimation factor (3 at 16 kHz)

// Endpointing — same numbers as the Exotel path (they were tuned live).
const ENERGY_THRESHOLD = parseInt(process.env.VOICEBOT_WA_ENERGY_THRESHOLD || "300")
const SILENCE_END_MS = 600
const MIN_SPEECH_MS = 250
const MAX_UTTERANCE_MS = 15000

// Barge-in defaults ON for WhatsApp: the client does its own echo
// cancellation on IP audio, so sustained loud input while Priya talks is a
// real interruption, not line echo (the Exotel path needs a manual echo
// probe before enabling this — see voicebot-server.js).
const BARGE_IN = (process.env.VOICEBOT_WA_BARGE_IN || "1").trim() === "1"
const BARGE_MIN_MS = parseInt(process.env.VOICEBOT_WA_BARGE_MIN_MS || "300")

// Dead-peer backstop while CONNECTED: Meta's "terminate" webhook can be lost
// (webhook outage, Next.js pm2 restart at call end) and werift does not run
// ICE consent-freshness for us. A connected session whose inbound RTP goes
// silent for this long is dead — reap it so the pacer, the peer connection
// and the recorder temp files cannot leak forever. Opus DTX still emits
// frames every ~400 ms, so 120 s of TRUE silence only ever means a corpse.
const MEDIA_TIMEOUT_MS = Math.max(30_000, parseInt(process.env.VOICEBOT_WA_MEDIA_TIMEOUT_MS || "120000") || 120_000)

// TTS: WhatsApp calls default to Sarvam or Cartesia if specified.
// Automatic Sarvam fallback is always active if Cartesia fails or runs out of credits.
const WA_TTS_PROVIDER = (process.env.VOICEBOT_WA_TTS_PROVIDER || process.env.TTS_PROVIDER || "sarvam").toLowerCase()

// STUN only — this process runs on a public-IP server (AWS), Meta's SFU is
// publicly reachable; a TURN relay is never needed for this topology.
const ICE_SERVERS = (process.env.VOICEBOT_WA_ICE_SERVERS ||
  "stun:stun.l.google.com:19302")
  .split(",").map((s) => s.trim()).filter(Boolean).map((urls) => ({ urls }))

// Fixed lines (mirrored from voicebot-server.js — kept local so this module
// stays dependency-free from it; voicebot-server owns the Exotel path).
const CLARIFY_PHRASE = {
  english: "Sorry, I didn't quite catch that — could you say that again?",
  telugu: "Sorry అండి, నాకు సరిగా వినిపించలేదు. మళ్ళీ ఒకసారి చెప్పగలరా?",
  hindi: "Sorry, मुझे थोड़ा clear सुनाई नहीं दिया। क्या आप दोबारा बोल सकते हैं?",
}
const FALLBACK_PHRASE = {
  english: "Sorry, one moment please — I'm checking on something.",
  telugu: "క్షమించండి, ఒక నిమిషం. నేను చెక్ చేస్తున్నాను.",
  hindi: "क्षमा कीजिए, एक पल रुकिए — मैं जाँच रही हूँ।",
}
const START_FALLBACK_PHRASE = {
  english: "Hello! This is Priya from Right Agent Group.",
  telugu: "నమస్కారం! నేను రైట్ ఏజెంట్ గ్రూప్ నుంచి మాట్లాడుతున్నాను.",
  hindi: "नमस्ते! मैं राइट एजेंट ग्रुप से बोल रही हूँ।",
}

const TURN_TIMEOUT_MS = parseInt(process.env.VOICEBOT_TURN_TIMEOUT_MS || "20000")
const TURN_STREAM_TIMEOUT_MS = parseInt(process.env.VOICEBOT_TURN_STREAM_TIMEOUT_MS || "90000")

// Call recording (RECORD_CALLS=0 disables both the capture AND the notice).
// The consent line is spoken BEFORE the greeting whenever a recording is
// actually running — India's telecom norms and general call etiquette both
// require the caller to know. A custom line can be set per deployment.
const RECORDING_NOTICE_TEXT = (process.env.RECORDING_NOTICE_TEXT || "").trim()
const RECORDING_NOTICE_PHRASE = {
  english: "Please note, this call is recorded for quality and training purposes.",
  telugu: "దయచేసి గమనించండి, ఈ కాల్ క్వాలిటీ మరియు ట్రైనింగ్ ప్రయోజనాల కోసం రికార్డ్ చేయబడుతుంది.",
  hindi: "कृपया ध्यान दें, गुणवत्ता और प्रशिक्षण उद्देश्यों के लिए यह कॉल रिकॉर्ड की जा रही है।",
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const maskPhone = (p) => (p && String(p).length > 6 ? `${String(p).slice(0, 3)}****${String(p).slice(-3)}` : (p || "?"))

// WhatsApp call ids can be long; the app keys everything off callSid.
const callSidFor = (callId) => `wacall-${callId}`

/**
 * POST the finished recording's metadata to the app so the voice_calls row
 * picks up its playable URL. Two attempts — the app may be mid-restart at
 * exactly call-end time. File itself is already on the shared disk.
 */
async function uploadRecordingMeta(callSid, meta) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${APP_URL}/api/calls/recording/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify({
          callSid,
          filename: meta.filename,
          format: meta.format,
          bytes: meta.bytes,
          durationSec: meta.durationSec,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) return true
      throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      console.error(`wa recording upload (attempt ${attempt}/2) error: ${e.message}`)
      if (attempt < 2) await sleep(2000)
    }
  }
  return false
}

// ---------- Turn API (same bridge the Exotel bot uses) ----------

async function callTurnApi(payload, signal) {
  const res = await fetch(`${APP_URL}/api/calls/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify(payload),
    signal: signal || AbortSignal.timeout(TURN_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`turn API HTTP ${res.status}`)
  return res.json()
}

async function callTurnApiStream(payload, onEvent, signal) {
  const res = await fetch(`${APP_URL}/api/calls/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ ...payload, stream: true }),
    signal: signal || AbortSignal.timeout(TURN_STREAM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`turn API HTTP ${res.status}`)
  const ct = res.headers.get("content-type") || ""
  if (!ct.includes("ndjson")) {
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

// JS mirror of lib/sentences.ts (same as voicebot-server.js).
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

// ---------- Audio helpers (all pure JS — no new native deps) ----------

/** 16 kHz mono s16 WAV around a PCM buffer (Saaras accepts 8/16 kHz). */
function pcmToWav16k(pcm) {
  const header = Buffer.alloc(44)
  const byteRate = STT_RATE * 2
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(STT_RATE, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** 48 kHz → STT_RATE, box-average decimation (3:1 at 16 kHz). */
function downsampleToStt(frame48k) {
  const out = Buffer.alloc(Math.floor(frame48k.length / 2 / DSR) * 2)
  let o = 0
  for (let i = 0; i + DSR <= frame48k.length / 2; i += DSR) {
    let acc = 0
    for (let k = 0; k < DSR; k++) acc += frame48k.readInt16LE((i + k) * 2)
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(acc / DSR))), o)
    o += 2
  }
  return out
}

/** Walk a RIFF/WAVE buffer chunk-by-chunk (never a fixed 44-byte layout —
 *  providers prepend/append LIST/fact chunks). Returns the fmt fields plus
 *  the raw data payload. Throws on anything that is not a parseable WAV. */
function parseWav(wav) {
  if (!wav || wav.length < 44 ||
      wav.toString("ascii", 0, 4) !== "RIFF" ||
      wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE buffer")
  }
  let off = 12
  let fmt = null
  let data = null
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4)
    const size = wav.readUInt32LE(off + 4)
    const body = off + 8
    if (id === "fmt " && !fmt) {
      fmt = {
        audioFormat: wav.readUInt16LE(body),
        channels: wav.readUInt16LE(body + 2),
        sampleRate: wav.readUInt32LE(body + 4),
        bitsPerSample: wav.readUInt16LE(body + 14),
      }
    } else if (id === "data" && !data) {
      data = wav.subarray(body, Math.min(body + size, wav.length))
    }
    off = body + size + (size % 2) // chunks are word-aligned
  }
  if (!fmt || !data || !data.length) throw new Error("WAV missing fmt/data chunk")
  return { ...fmt, pcm: data }
}

/** Quick header peek for diagnostics — the TRUE rate the TTS delivered
 *  (null when the buffer is not parseable). */
function wavSampleRate(wav) {
  try { return parseWav(wav).sampleRate } catch { return null }
}

/**
 * Resample mono s16 PCM from srcRate to dstRate via fractional linear
 * interpolation. Identity (buffer copy) when the rates already match.
 *
 * This is the speed-correctness core of the whole calling stack: the output
 * duration always equals the input duration (±1 sample), no matter what
 * rate the TTS provider delivered — the old hardcoded "assume 24 kHz and
 * double" turned every non-24 kHz source into slow motion / chipmunk.
 */
function resamplePcmMono(pcm, srcRate, dstRate) {
  const inSamples = Math.floor(pcm.length / 2)
  if (!inSamples) return Buffer.alloc(0)
  if (!srcRate || !dstRate || srcRate === dstRate) return Buffer.from(pcm)
  const outSamples = Math.max(1, Math.round((inSamples * dstRate) / srcRate))
  const out = Buffer.alloc(outSamples * 2)
  const step = srcRate / dstRate
  for (let i = 0; i < outSamples; i++) {
    const pos = i * step
    const i0 = Math.min(Math.floor(pos), inSamples - 1)
    const i1 = Math.min(i0 + 1, inSamples - 1)
    const frac = pos - i0
    const cur = pcm.readInt16LE(i0 * 2)
    const v = i1 === i0 ? cur : cur + (pcm.readInt16LE(i1 * 2) - cur) * frac
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2)
  }
  return out
}

/** Legacy integer-factor helper (test-locked API) — fractional resampler
 *  under the hood so there is exactly ONE resample implementation. */
function upsampleMono(pcm, factor) {
  return resamplePcmMono(pcm, 1, factor)
}

/** Pure-JS TTS decode — the ffmpeg-free wavToPcm fallback. Accepts mono or
 *  stereo s16 PCM WAV at ANY rate (stereo folds to mono by averaging). */
function jsWavToPcm48k(wav) {
  const { audioFormat, channels, sampleRate, bitsPerSample, pcm } = parseWav(wav)
  if (bitsPerSample !== 16 || (audioFormat !== 1 && audioFormat !== 0xfffe)) {
    throw new Error(`unsupported WAV (format=${audioFormat}, ${bitsPerSample}-bit) — install ffmpeg for full codec support`)
  }
  let mono = pcm
  if (channels === 2) {
    mono = Buffer.alloc(Math.floor(pcm.length / 4) * 2)
    for (let i = 0; i + 3 < pcm.length; i += 4) {
      mono.writeInt16LE(
        Math.max(-32768, Math.min(32767, Math.round((pcm.readInt16LE(i) + pcm.readInt16LE(i + 2)) / 2))),
        (i / 4) * 2,
      )
    }
  } else if (channels !== 1) {
    throw new Error(`unsupported WAV channel count: ${channels}`)
  }
  return resamplePcmMono(mono, sampleRate, WA_RATE)
}

let _warnedNoFfmpeg = false

/** TTS WAV (ANY provider sample rate) → mono s16 PCM at the 48 kHz WebRTC
 *  clock. Primary path: ffmpeg, which reads the WAV HEADER (source of truth)
 *  and resamples — no hardcoded rate anywhere. Fallback: the pure-JS header
 *  walk + linear resampler, so a server without ffmpeg (or a build that
 *  chokes on a stream) still gets correct-speed audio instead of dead air.
 *  One ffmpeg spawn per sentence either way — the resample is free. */
function wavToPcm(wav) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", String(WA_RATE), "pipe:1"])
    const chunks = []
    let ffError = null
    ff.stdout.on("data", (c) => chunks.push(c))
    ff.on("error", (e) => { ffError = e })
    ff.on("close", (code) => {
      if (code === 0 && chunks.length) return resolve(Buffer.concat(chunks))
      if (ffError && (ffError.code === "ENOENT" || ffError.code === "EACCES")) {
        if (!_warnedNoFfmpeg) {
          _warnedNoFfmpeg = true
          console.warn("⚠ ffmpeg not found on PATH — TTS decode falls back to the pure-JS resampler (install ffmpeg for best quality)")
        }
      } else {
        console.warn(`⚠ ffmpeg WAV decode failed (${ffError ? ffError.message : `exit ${code}`}) — trying the pure-JS resampler`)
      }
      try {
        resolve(jsWavToPcm48k(wav))
      } catch (e) {
        reject(new Error(`TTS WAV decode failed: ffmpeg=${ffError ? ffError.message : `exit ${code}`}, js=${e.message}`))
      }
    })
    ff.stdin.on("error", () => {})
    ff.stdin.end(wav)
  })
}
const wavToPcm48k = wavToPcm

function avgEnergy(frame) {
  let sum = 0
  const n = Math.floor(frame.length / 2)
  for (let i = 0; i < n; i++) sum += Math.abs(frame.readInt16LE(i * 2))
  return n ? sum / n : 0
}

/**
 * WhatsApp only accepts SHA-256 DTLS fingerprints in the SDP it receives.
 * werift already answers with sha-256, but the filter (mirrors pipecat's
 * WhatsApp client) guarantees nothing else slips in.
 */
function filterSdpForWhatsApp(sdp) {
  const lines = String(sdp).split(/\r?\n/)
  const filtered = lines.filter((l) => !l.startsWith("a=fingerprint:") || l.startsWith("a=fingerprint:sha-256"))
  return filtered.join("\r\n").replace(/\r?\n$/, "") + "\r\n"
}

// ---------- Signalling: SDP offer → answer ----------

/**
 * Build the WebRTC answer for a WhatsApp "connect" event.
 *
 * Called synchronously inside the webhook round-trip: the answer MUST go
 * back to Meta within a few seconds or the caller hears dead ringing. ICE
 * gathering completes inside setLocalDescription (werift semantics), so the
 * returned SDP is complete — no trickle.
 *
 * Returns everything the session needs to take over: the pc, our send track
 * with its negotiated payloadType/ssrc, and the filtered answer SDP.
 */
async function createCallAnswer(offerSdp) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const sendTrack = new MediaStreamTrack({ kind: "audio" })
  const sender = pc.addTrack(sendTrack)

  // werift fires onTrack synchronously INSIDE setRemoteDescription the moment
  // the remote offer is sendonly/sendrecv. Subscribe BEFORE that call or the
  // remote track is missed forever — the caller's voice would never reach
  // STT. (Browsers re-fire per-stream later; werift does not.)
  let remoteTrack = null
  pc.onTrack.subscribe((track) => { remoteTrack = track })

  await pc.setRemoteDescription({ type: "offer", sdp: offerSdp })

  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)

  // MediaStreamTrack.codec is set once the transceiver negotiated opus.
  const pt = sendTrack.codec?.payloadType
  if (pt === undefined || pt === null) {
    try { pc.close() } catch {}
    throw new Error("opus payload type missing after negotiation — WhatsApp offer contained no compatible audio codec")
  }
  const ssrc = sender.ssrc || sendTrack.ssrc

  console.log(`📋 WhatsApp WebRTC Offer:\n${offerSdp.trim()}`)
  const filtered = filterSdpForWhatsApp(pc.localDescription?.sdp || answer.sdp)
  console.log(`📋 WhatsApp WebRTC Answer:\n${filtered.trim()}`)

  return {
    pc,
    sendTrack,
    sender,
    answerSdp: filtered,
    payloadType: pt,
    ssrc,
    remoteTrack,
  }
}

// ---------- Per-call session ----------

class WhatsAppCallSession {
  constructor({ callId, from, to, phoneNumberId, branchId }) {
    this.callId = callId
    this.callSid = callSidFor(callId)
    this.from = from || ""
    this.to = to || ""
    this.phoneNumberId = phoneNumberId || ""
    this.branchId = branchId || null

    this.language = "telugu"
    this.voice = null           // { provider, speaker } from the branch's AI Employee
    this.startedAt = Date.now()
    this.connectedAt = 0        // epoch ms of the FIRST ICE connect — 0 = media never flowed
    this.lastInboundAt = Date.now() // media-inactivity watchdog clock (see pacer)
    this.closed = false
    this.started = false
    this.endReported = false

    // playback pipeline (epoch-guarded, same design as CallSession)
    this.speechEpoch = 0
    this.botTalking = false
    this.processing = false
    this.sendingAudio = false
    this.synthChain = Promise.resolve()
    this.sendChain = Promise.resolve()
    this.turnAbort = null

    // utterance state
    this.buffer = []            // downsampled 16k frames of the current utterance
    this.speechMs = 0
    this.silenceMs = 0
    this.maxEnergy = 0
    this.callMaxEnergy = 0
    this.frameCount = 0
    this.speaking = false
    this.bargeMs = 0
    this.bargeBuffer = []

    // RTP out
    this.outQueue = []          // 20 ms opus frames awaiting the pacer
    this.pacer = null
    this.seq = Math.floor(Math.random() * 0x10000)
    this.ts = Math.floor(Math.random() * 0x100000000)
    this.connected = false
    this.staleTimer = null
    // Promise for the in-flight "end" report (awaited by the terminate bridge)
    this.endReportPromise = null

    // Call recording — created per session, started only when media attaches.
    // null when RECORD_CALLS=0 (every capture point then no-ops).
    this.recorder = recorder.createFor(this.callSid)
    // Mirror of outQueue at 16 kHz (one entry per queued opus frame) so the
    // pacer can record EXACTLY what it plays out — see enqueuePcm/startPacer.
    this.outPcmQueue = []
  }

  /** Take over the negotiated peer connection and go live. */
  attach({ pc, sendTrack, sender, answerSdp, payloadType, ssrc, remoteTrack }) {
    this.pc = pc
    this.sendTrack = sendTrack
    this.sender = sender
    this.answerSdp = answerSdp
    this.pt = payloadType
    this.ssrc = ssrc
    this.encoder = new OpusEncoder(WA_RATE, 1)
    this.decoder = new OpusEncoder(WA_RATE, 1)
    this.silenceFrame = this.encoder.encode(Buffer.alloc(WA_FRAME_BYTES))

    pc.iceConnectionStateChange.subscribe((state) => {
      console.log(`🧊 WhatsApp call ${this.callSid} ICE state: ${state}`)
      if (state === "failed" || state === "closed") {
        this.end(state)
      }
    })
    pc.connectionStateChange.subscribe((state) => {
      console.log(`🔒 WhatsApp call ${this.callSid} PC state: ${state} (dtls=${this.sender?.dtlsTransport?.state})`)
      if (state === "connected") {
        if (!this.connected) {
          this.connected = true
          this.connectedAt = Date.now()
          console.log(`🔊 WhatsApp call ${this.callSid} media connected (PC connected)`)
        }
      } else if (state === "closed" || state === "failed") {
        this.end(state)
      }
    })

    if (this.sender?.dtlsTransport) {
      this.sender.dtlsTransport.onStateChange.subscribe((state) => {
        console.log(`🔐 WhatsApp call ${this.callSid} DTLS state: ${state}`)
        if (state === "connected") {
          if (!this.connected) {
            this.connected = true
            this.connectedAt = Date.now()
            console.log(`🔊 WhatsApp call ${this.callSid} media connected (DTLS connected)`)
          }
        }
      })
    }

    // Inbound audio: the REMOTE track. werift fires onTrack during
    // setRemoteDescription — createCallAnswer already captured it (see
    // remoteTrack there); bind it directly. The pc.onTrack subscribe below
    // is a guarded fallback for any late-firing implementation.
    let inboundBound = false
    const bindInbound = (track) => {
      if (inboundBound || !track) return
      inboundBound = true
      console.log(`📥 WhatsApp call ${this.callSid} inbound track bound (${track.kind || "audio"})`)
      track.onReceiveRtp.subscribe((rtp) => {
        try {
          if (!this._firstInboundLogged) {
            this._firstInboundLogged = true
            console.log(`📥 WhatsApp call ${this.callSid} first inbound RTP packet received (len=${rtp?.payload?.length})`)
          }
          if (this.closed || !rtp?.payload?.length) return
          // 1 opus frame per RTP packet (Meta sends 20 ms ptime).
          const pcm48k = this.safeDecode(rtp.payload)
          if (pcm48k) this.onInboundFrame(pcm48k)
        } catch (e) {
          console.error("wa rtp in error:", e.message)
        }
      })
    }
    if (remoteTrack) bindInbound(remoteTrack)
    pc.onTrack.subscribe(bindInbound)

    this.startPacer()
    // Safety net: if media never connects (firewall, bad ICE), the session
    // must not sit in memory forever. Meta also times the call out ~45-60s
    // after an unanswered accept and sends a terminate webhook — this timer
    // covers the case where THAT never arrives either.
    this.staleTimer = setTimeout(() => {
      if (!this.connected && !this.closed) {
        console.error(`⏰ WhatsApp call ${this.callSid} never connected — reaping`)
        this.end("ice-timeout")
      }
    }, 90_000)
    if (this.staleTimer.unref) this.staleTimer.unref()

    if (this.recorder) this.recorder.start()

    return this
  }

  waitForConnected(timeoutMs = 2500) {
    if (this.closed) return Promise.resolve(false)
    if (this.sender?.dtlsTransport?.state === "connected" || this.connected) {
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      let settled = false
      const done = (val) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { dtlsSub?.unsubscribe?.() } catch {}
        try { pcSub?.unsubscribe?.() } catch {}
        resolve(val)
      }
      const timer = setTimeout(() => done(this.sender?.dtlsTransport?.state === "connected" || this.connected), timeoutMs)
      if (timer.unref) timer.unref()

      let dtlsSub = null
      if (this.sender?.dtlsTransport) {
        dtlsSub = this.sender.dtlsTransport.onStateChange.subscribe((st) => {
          if (st === "connected") done(true)
          else if (st === "failed" || st === "closed") done(false)
        })
      }
      const pcSub = this.pc?.connectionStateChange?.subscribe?.((st) => {
        if (st === "connected") done(true)
        else if (st === "failed" || st === "closed") done(false)
      })
    })
  }

  safeDecode(payload) {
    try { return this.decoder.decode(payload) } catch { return null }
  }

  // ---- outbound audio (pacer) ----

  startPacer() {
    let pacerStartTime = null
    let totalPacketsSent = 0

    const sendOneTick = () => {
      if (this.closed) return
      // Media-inactivity watchdog — the twin of attach()'s never-connected
      // staleTimer. Checked on this 20 ms tick because it is already running:
      // zero cost, and it cannot forget to fire the way a separate timer that
      // gets cleared/recreated would.
      if (this.connected && Date.now() - this.lastInboundAt > MEDIA_TIMEOUT_MS) {
        console.error(`⏰ WhatsApp call ${this.callSid}: no inbound media for ${Math.round(MEDIA_TIMEOUT_MS / 1000)}s — reaping (terminate webhook was likely lost)`)
        this.end("media-timeout")
        return
      }
      const isReal = this.outQueue.length > 0
      const frame = isReal ? this.outQueue.shift() : this.silenceFrame
      if (!frame) return
      try {
        const packet = new RtpPacket(new RtpHeader({
          payloadType: this.pt,
          sequenceNumber: this.seq,
          timestamp: this.ts >>> 0,
          ssrc: this.ssrc,
        }), frame)
        this.seq = (this.seq + 1) & 0xffff
        this.ts = (this.ts + WA_FRAME_SAMPLES) >>> 0
        this.sendTrack.writeRtp(packet)
        if (this.recorder) {
          const pcm = (isReal && this.outPcmQueue.length) ? this.outPcmQueue.shift() : recorder.SILENCE_20MS
          this.recorder.pushOutbound(pcm)
        }
      } catch (e) {
        console.error("wa rtp out error:", e.message)
      }
    }

    // High-resolution pacer interval (runs every 5ms on Node/Windows).
    // Uses performance.now() elapsed time to pace exactly 50 packets per second (20ms real-time audio),
    // eliminating timer jitter and Windows 15.6ms clock quantisation that causes slow-motion audio.
    this.pacer = setInterval(() => {
      if (this.closed) return
      const dtlsState = this.sender?.dtlsTransport?.state
      const isReady = dtlsState === "connected" || (this.connected && !dtlsState)
      if (!isReady) {
        return
      }
      if (!this.connected) {
        this.connected = true
        console.log(`🔊 WhatsApp call ${this.callSid} media flowing over DTLS`)
      }

      const now = performance.now()
      if (pacerStartTime === null) {
        pacerStartTime = now
        totalPacketsSent = 0
      }

      const elapsedMs = now - pacerStartTime
      const targetPackets = Math.floor(elapsedMs / 20) + 1
      const burstLimit = 3
      let sentThisTick = 0
      while (totalPacketsSent < targetPackets && sentThisTick < burstLimit && !this.closed) {
        sendOneTick()
        totalPacketsSent++
        sentThisTick++
      }
    }, 5)
    if (this.pacer.unref) this.pacer.unref()
  }

  /** Split a PCM (s16 mono 48 kHz) clip into 20 ms opus frames on the queue. */
  enqueuePcm(pcm48k) {
    for (let off = 0; off < pcm48k.length; off += WA_FRAME_BYTES) {
      let chunk = pcm48k.subarray(off, Math.min(off + WA_FRAME_BYTES, pcm48k.length))
      if (chunk.length < WA_FRAME_BYTES) chunk = Buffer.concat([chunk, Buffer.alloc(WA_FRAME_BYTES - chunk.length)])
      this.outQueue.push(this.encoder.encode(chunk))
      // Same slice at 16 kHz for the recorder, index-aligned with outQueue so
      // the pacer can pop both together and record what it ACTUALLY plays.
      if (this.recorder) this.outPcmQueue.push(downsampleToStt(chunk))
    }
  }

  /** How much audio is sitting in the queue (ms) — each item is one 20 ms frame. */
  queuedMs() {
    return this.outQueue.length * 20
  }

  // ---- inbound audio → endpointing (mirrors CallSession.onMedia) ----

  onInboundFrame(pcm48k) {
    if (this.closed) return
    // ONE downsample per frame, shared by the recorder (always) and the STT
    // buffer (per state below) — the branches used to downsample separately.
    const pcm16k = downsampleToStt(pcm48k)
    this.lastInboundAt = Date.now()
    // Recording captures EVERY inbound frame — including audio the endpointer
    // drops (while Priya talks, while the brain is thinking). A recording
    // that skips the caller talking over Priya would be useless in a dispute.
    if (this.recorder) this.recorder.pushInbound(pcm16k)
    const energy = avgEnergy(pcm48k)
    // Frame duration FROM THE DECODED PCM, not a hardcoded 20: Meta's ptime
    // is 20 ms today but is not contractual, and a 60 ms frame used to make
    // every silence/MAX_UTTERANCE timer tick 3× too slow (sluggish turn-taking).
    const ms = (pcm48k.length / 2 / WA_RATE) * 1000

    if (this.botTalking) {
      if (!BARGE_IN) return
      if (energy > ENERGY_THRESHOLD * 2) {
        this.bargeMs += ms
        this.bargeBuffer.push(pcm16k)
        if (this.bargeMs >= BARGE_MIN_MS) this.interrupt()
      } else {
        this.bargeMs = 0
        this.bargeBuffer = []
      }
      return
    }

    if (this.processing) return

    this.frameCount++
    if (energy > this.maxEnergy) this.maxEnergy = energy
    if (energy > this.callMaxEnergy) this.callMaxEnergy = energy

    if (energy > ENERGY_THRESHOLD) {
      this.speaking = true
      this.speechMs += ms
      this.silenceMs = 0
      this.buffer.push(pcm16k)
      if (this.speechMs >= MAX_UTTERANCE_MS) void this.endUtterance().catch((e) => console.error("wa utterance error:", e.message))
    } else if (this.speaking) {
      this.silenceMs += ms
      this.buffer.push(pcm16k)
      if (this.silenceMs >= SILENCE_END_MS || this.speechMs >= MAX_UTTERANCE_MS) {
        void this.endUtterance().catch((e) => console.error("wa utterance error:", e.message))
      }
    }
  }

  interrupt() {
    this.speechEpoch++
    this.botTalking = false
    this.processing = false
    this.sendingAudio = false
    this.synthChain = Promise.resolve()
    this.sendChain = Promise.resolve()
    this.outQueue = []
    this.outPcmQueue = []
    if (this.turnAbort) { try { this.turnAbort.abort() } catch {} this.turnAbort = null }
    // Carry the triggering frames into the next utterance (same rule as the
    // Exotel path — dropping them clips the first word).
    this.buffer = this.bargeBuffer
    this.speaking = true
    this.speechMs = this.bargeMs
    this.silenceMs = 0
    this.bargeBuffer = []
    this.bargeMs = 0
    console.log(`✋ WhatsApp barge-in — caller cut in, dropping the rest of the reply`)
  }

  async endUtterance() {
    const pcm16k = Buffer.concat(this.buffer)
    const hadRealSpeech = this.speechMs >= MIN_SPEECH_MS
    const durationMs = (pcm16k.length / (STT_RATE * 2)) * 1000
    const maxEnergy = this.maxEnergy
    this.buffer = []
    this.speaking = false
    this.speechMs = 0
    this.silenceMs = 0
    this.maxEnergy = 0
    if (!hadRealSpeech || this.processing || this.closed) return

    const epoch = this.speechEpoch
    this.processing = true
    const turnT0 = Date.now()
    try {
      console.log(`🎙 wa utterance: ${durationMs.toFixed(0)}ms  maxEnergy=${maxEnergy.toFixed(0)}  threshold=${ENERGY_THRESHOLD}  bytes=${pcm16k.length}`)
      const { text: transcript, lowConfidence } = await voiceProviders.transcribe(pcmToWav16k(pcm16k), this.language)
      if (process.env.VOICEBOT_DEBUG_LOGS === "1") console.log(`👂 [wa][${this.language}]${lowConfidence ? " LOW-CONFIDENCE" : ""} "${transcript}"`)
      else console.log(`👂 [wa][${this.language}]${lowConfidence ? " LOW-CONFIDENCE" : ""} transcript (${(transcript || "").length} chars)`)
      if (!transcript || lowConfidence) {
        const phrase = CLARIFY_PHRASE[this.language] || CLARIFY_PHRASE.english
        this.queueSentence(phrase, epoch)
        await this.drainSpeech(epoch)
        return
      }

      let hangup = false
      let firstSentenceAt = null
      const turnAbort = new AbortController()
      this.turnAbort = turnAbort
      const spoken = []
      const brainT0 = Date.now()
      await callTurnApiStream(
        { event: "turn", callSid: this.callSid, speech: transcript, language: this.language },
        (ev) => {
          if (turnAbort.signal.aborted || epoch !== this.speechEpoch) return
          if (ev.type === "sentence" && ev.text) {
            if (!firstSentenceAt) {
              firstSentenceAt = Date.now()
              console.log(`⏱ wa brain (time to first sentence): ${firstSentenceAt - brainT0}ms`)
            }
            this.queueSentence(ev.text, epoch, spoken)
          } else if (ev.type === "done") {
            if (ev.language) this.language = ev.language
            hangup = !!ev.hangup
          }
        },
        turnAbort.signal
      )
      if (this.turnAbort === turnAbort) this.turnAbort = null
      await this.drainSpeech(epoch)
      if (epoch !== this.speechEpoch && !this.closed) await this.reportSpoken(spoken)
      console.log(`⏱ wa TOTAL turn (silence → reply fully sent): ${Date.now() - turnT0}ms`)
      // A WhatsApp hangup is always the CUSTOMER's action (we never hang up
      // first — there is no server-side "hang up" RTP signal; that would be
      // Graph terminate). The app's hangup flag is logged, not acted on.
      if (hangup && epoch === this.speechEpoch) {
        console.log(`ℹ turn requested hangup on ${this.callSid} — WhatsApp hangs up customer-side; Priya's goodbye plays out and the terminate webhook ends the call`)
      }
    } catch (e) {
      console.error("wa turn error:", e.message)
      if (epoch === this.speechEpoch && !this.closed) {
        try {
          const phrase = FALLBACK_PHRASE[this.language] || FALLBACK_PHRASE.english
          this.queueSentence(phrase, epoch)
          await this.drainSpeech(epoch)
        } catch (e2) {
          console.error("wa fallback failed too:", e2.message)
        }
      }
    } finally {
      if (epoch === this.speechEpoch) this.processing = false
    }
  }

  // ---- speech pipeline ----

  queueSentence(text, turnEpoch, spoken) {
    const clean = (text || "").trim()
    if (!clean || this.closed) return
    const epoch = turnEpoch === undefined ? this.speechEpoch : turnEpoch
    if (epoch !== this.speechEpoch) return
    this.botTalking = true
    const synth = this.synth(clean, epoch)
    this.synthChain = synth
    this.sendChain = this.sendChain.catch(() => {}).then(async () => {
      const frames = await synth
      if (frames && frames.length > 0 && !this.closed && epoch === this.speechEpoch) {
        if (spoken) spoken.push(clean)
        // Hand the frames to the pacer, then wait until real-time playout of
        // this sentence finished (+ 200 ms natural pause) before the next
        // sentence's frames join the queue — keeps sentence order AND lets
        // the endpointing state machine stay quiet while she talks.
        this.enqueuePcm(frames)
        this.sendingAudio = true
        try {
          while (this.outQueue.length > 0 && !this.closed && epoch === this.speechEpoch) await sleep(40)
          if (!this.closed && epoch === this.speechEpoch) await sleep(200)
        } finally {
          this.sendingAudio = false
        }
      } else if ((!frames || frames.length === 0) && !this.closed && epoch === this.speechEpoch) {
        console.error("wa TTS produced no audio for a sentence")
      }
    })
  }

  /**
   * Synthesize one sentence to 48 kHz PCM frames. TTS provider: Cartesia
   * (default for WhatsApp) with automatic Sarvam fallback when Cartesia is
   * not configured. The branch voice override's speaker is honoured when it
   * belongs to the same provider.
   */
  synth(text, epoch) {
    return this.synthChain.then(async () => {
      if (this.closed || epoch !== this.speechEpoch) return null
      try {
        const t0 = Date.now()
        let override = this.voice || null
        let audio
        let providerUsed = WA_TTS_PROVIDER
        if (WA_TTS_PROVIDER === "cartesia" && process.env.CARTESIA_API_KEY) {
          const speaker = override?.provider === "cartesia" ? override.speaker : (process.env.CARTESIA_VOICE_ID || undefined)
          try {
            audio = await voiceProviders.cartesiaTts(text, this.language, speaker)
            providerUsed = "cartesia"
          } catch (cartesiaErr) {
            console.warn(`[WA] Cartesia TTS failed (${cartesiaErr.message}), falling back to Sarvam TTS`)
            const sarvamSpeaker = override?.provider === "sarvam" ? override.speaker : undefined
            audio = await voiceProviders.sarvamTts(text, this.language, sarvamSpeaker)
            providerUsed = "sarvam (fallback)"
          }
        } else {
          const speaker = override?.provider === "sarvam" ? override.speaker : undefined
          audio = await voiceProviders.sarvamTts(text, this.language, speaker)
          providerUsed = "sarvam"
        }
        const pcm48k = await wavToPcm(audio)
        const inRate = wavSampleRate(audio)
        console.log(`⏱ wa TTS (${providerUsed}): ${Date.now() - t0}ms (in @ ${inRate || "?"} Hz → ${(pcm48k.length / (WA_RATE * 2)).toFixed(1)}s @ 48k)`)
        return pcm48k
      } catch (e) {
        console.error("wa TTS error:", e.message)
        return null
      }
    })
  }

  async drainSpeech(epoch) {
    await this.sendChain
    if (epoch === undefined || epoch === this.speechEpoch) this.botTalking = false
  }

  async speak(text) {
    if (!text || this.closed) return
    const epoch = this.speechEpoch
    for (const s of splitIntoSentences(text)) this.queueSentence(s, epoch)
    await this.drainSpeech(epoch)
  }

  async reportSpoken(spoken) {
    const said = spoken.join(" ").trim()
    const text = said
      ? `${said} …(interrupted by the customer)`
      : "(the customer interrupted before Priya said anything)"
    try {
      await callTurnApi({ event: "spoken", callSid: this.callSid, text })
    } catch (e) {
      console.error("wa spoken correction error:", e.message)
    }
  }

  // ---- lifecycle ----

  /** The consent line for the CURRENT language, or null when not recording.
   *  Gates on the recorder's REAL state — a disk failure must never have
   *  Priya announce a recording that will not exist. */
  recordingNotice() {
    if (!this.recorder || !this.recorder.recording()) return null
    return RECORDING_NOTICE_TEXT || RECORDING_NOTICE_PHRASE[this.language] || RECORDING_NOTICE_PHRASE.english
  }

  /** Fire the app's "start" (lead resolution + greeting) once media is up. */
  async start() {
    if (this.started || this.closed) return
    this.started = true
    const t0 = Date.now()
    try {
      const r = await callTurnApi({
        event: "start",
        callSid: this.callSid,
        from: this.from,
        to: this.to,
        branchId: this.branchId || undefined,
        source: "whatsapp_call",
      })
      console.log(`⏱ wa start API: ${Date.now() - t0}ms  lead=${r.leadId || "?"}  branch=${r.branchId || "hq"}`)
      this.language = r.language || "english"
      this.voice = r.voice && r.voice.speaker ? r.voice : null
      // Recording consent BEFORE the greeting — the caller must know the
      // call is recorded from the first spoken word onward.
      const notice = this.recordingNotice()
      if (notice) await this.speak(notice)
      await this.speak(r.text)
      console.log(`⏱ wa answer → greeting fully queued: ${Date.now() - t0}ms`)
    } catch (e) {
      console.error("wa start error:", e.message)
      const notice = this.recordingNotice()
      const line = START_FALLBACK_PHRASE[this.language] || START_FALLBACK_PHRASE.english
      await this.speak(notice ? `${notice} ${line}` : line).catch(() => {})
    }
  }

  end(reason) {
    if (this.closed) return
    this.closed = true
    if (this.staleTimer) { clearTimeout(this.staleTimer); this.staleTimer = null }
    if (this.pacer) { clearInterval(this.pacer); this.pacer = null }
    if (this.turnAbort) { try { this.turnAbort.abort() } catch {} this.turnAbort = null }
    try { this.pc && this.pc.close() } catch {}
    sessions.delete(this.callId)
    console.log(`■ WhatsApp call end sid=${this.callSid} reason=${reason}  frames=${this.frameCount}  callMaxEnergy=${this.callMaxEnergy.toFixed(0)}  threshold=${ENERGY_THRESHOLD}`)
    this.reportEnd()
    // Recording finalize runs AFTER the call is torn down and fully off the
    // call path: mix + MP3 transcode + upload happen in the background. A
    // failure here is logged, never thrown — the call is already over.
    if (this.recorder) void this.finishRecording()
  }

  /** Mix + upload the recording (fire-and-forget from end()). Never throws. */
  async finishRecording() {
    try {
      const t0 = Date.now()
      const meta = await this.recorder.finalize()
      if (!meta) {
        console.log(`🎙 wa recording ${this.callSid}: no audio captured (never connected) — nothing saved`)
        return
      }
      console.log(`🎙 wa recording ${this.callSid}: ${meta.format} ${Math.round(meta.bytes / 1024)}KB  ${meta.durationSec}s  mixed in ${Date.now() - t0}ms`)
      const ok = await uploadRecordingMeta(this.callSid, meta)
      if (!ok) {
        console.error(`🎙 wa recording ${this.callSid}: file saved locally (${meta.filename}) but the app could not be updated — it will NOT appear in the dashboard`)
      }
    } catch (e) {
      console.error(`wa recording finalize error: ${e.message}`)
    }
  }

  /** Real duration to the app (fills voice_calls; idempotent server-side). */
  reportEnd() {
    if (this.endReported) return
    if (!this.callSid) return
    this.endReported = true
    // Real TALK time, not wall time. startedAt counts accept → ICE connect
    // dead air — and when media NEVER connected it counted the customer's
    // entire frustrated wait, turning a dead-ring hang-up into a fake
    // "completed 40s call" (wrong bubble, wrong follow-up template, wrong
    // lead bump). Duration 0 = never talked; the finalizer then honestly
    // treats the call as MISSED.
    const duration = this.connectedAt ? Math.round((Date.now() - this.connectedAt) / 1000) : 0
    // Promise retained on the session: the HTTP bridge awaits it on the
    // terminate webhook so the app never finalizes before duration landed.
    this.endReportPromise = callTurnApi({ event: "end", callSid: this.callSid, duration }).catch((e) =>
      console.error("wa end report error:", e.message)
    )
  }
}

// ---------- Registry (the API the HTTP bridge talks to) ----------

const sessions = new Map() // callId → session

/**
 * Handle a "connect" webhook event: answer the SDP offer, register the
 * session, kick off Priya's greeting. Idempotent per callId (Meta retries).
 * Returns { answerSdp } for the caller (Next.js) to hand back to Meta via
 * pre_accept + accept.
 */
async function startSession({ callId, from, to, phoneNumberId, sdp, sdpType, branchId }) {
  if (!callId || !sdp) throw new Error("callId and sdp are required")
  const existing = sessions.get(callId)
  if (existing && !existing.closed) {
    console.log(`⚠ duplicate WhatsApp connect for ${existing.callSid} — returning the stored answer`)
    return { answerSdp: existing.answerSdp }
  }

  const answer = await createCallAnswer(sdp)
  const session = new WhatsAppCallSession({ callId, from, to, phoneNumberId, branchId })
  sessions.set(callId, session.attach(answer))
  console.log(`📞 WhatsApp call connect sid=${session.callSid} from=${maskPhone(from)} to=${maskPhone(to)} branch=${branchId || "hq"} (sdpType=${sdpType || "offer"})`)
  // Greeting fires immediately — the pacer holds frames until ICE connects,
  // so the greeting starts the instant media is live instead of after a
  // second turn-API round trip.
  session.start().catch((e) => console.error("wa session start error:", e.message))
  return { answerSdp: answer.answerSdp }
}

/** Handle a "terminate" webhook event (customer hung up / rejected / lost). */
async function endSession(callId, reason) {
  const session = sessions.get(callId)
  if (!session) return { ok: true, ended: false }
  session.end(reason || "terminate")
  // The app's webhook finalizer (follow-ups, chat bubble, comm_logs) reads
  // voice_calls.duration — wait until the "end" report actually landed so a
  // resolved call can never be finalized as a 0-second miss.
  if (session.endReportPromise) {
    try { await session.endReportPromise } catch {}
  }
  return { ok: true, ended: true }
}

async function waitConnectedSession(callId, timeoutMs = 2500) {
  const session = sessions.get(callId)
  if (!session) return { ok: false, connected: false }
  const connected = await session.waitForConnected(timeoutMs)
  return { ok: true, connected }
}

// ---------- Business-initiated (outbound) WhatsApp calls ----------
//
// Meta lets a business PLACE a WhatsApp voice call once the customer has
// granted call permission — implicitly (they called us first; Meta allows
// calling a user back after an inbound call) or explicitly (the
// call-permission template flow, approved per user in WhatsApp).
//
// The WebRTC direction FLIPS versus inbound: we generate the SDP OFFER,
// Next.js POSTs it to Graph (action=connect), Meta rings the customer, and
// the "calls" webhook later delivers their ANSWER SDP — which completes the
// negotiation HERE and goes live with the full session machinery (pacer,
// endpointing, turns, recording — all identical to inbound).
//
// Loopback lifecycle (same WHATSAPP_SERVICE_KEY auth as connect):
//   1. /whatsapp/outbound-offer    → { pendingId, offerSdp }  (offer held here)
//   2. Next.js Graph POST /calls   → Meta returns the call_id
//   3. /whatsapp/outbound-register { pendingId, callId }       (callId → pending)
//   4. webhook answer → /whatsapp/outbound-accept { callId, sdp }
//      → attachOutboundSession() → session live under the Meta call_id
//   5. /whatsapp/outbound-cancel releases a held offer on any Graph error,
//      and the TTL sweeper guarantees a peer connection can never leak.

const OUTBOUND_OFFER_TTL_MS = Math.max(30_000,
  parseInt(process.env.VOICEBOT_WA_OUTBOUND_TTL_MS || "180000") || 180_000)

// pendingId → held offer; once Graph accepts, callId (Meta) → pendingId.
const pendingOutbound = new Map()
const outboundByCallId = new Map()

function dropPendingOffer(pendingId, reason) {
  const pending = pendingOutbound.get(pendingId)
  if (!pending) return false
  pendingOutbound.delete(pendingId)
  if (pending.callId && outboundByCallId.get(pending.callId) === pendingId) {
    outboundByCallId.delete(pending.callId)
  }
  try { pending.pc.close() } catch {}
  console.log(`↩ WhatsApp outbound offer ${pendingId} dropped (${reason || "canceled"})`)
  return true
}

/** Generate + hold the WebRTC offer for one business-initiated call. The
 *  caller (Next.js dial route) MUST place it with Graph and register the
 *  returned call_id, or the sweeper reclaims the peer connection. */
async function createOutboundOffer({ phoneNumberId, from, to, branchId }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const sendTrack = new MediaStreamTrack({ kind: "audio" })
  const sender = pc.addTrack(sendTrack)
  // werift fires onTrack inside setRemoteDescription — i.e. the moment the
  // customer's ANSWER arrives, possibly minutes after this offer was made.
  // Capture the track through a closure the accept path reads later.
  let remoteTrack = null
  pc.onTrack.subscribe((track) => { remoteTrack = track })

  try {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer) // ICE gathering completes inside (werift)
  } catch (e) {
    try { pc.close() } catch {}
    throw new Error(`outbound offer failed: ${e.message}`)
  }

  const pendingId = `waout-${crypto.randomUUID()}`
  const offerSdp = filterSdpForWhatsApp(pc.localDescription?.sdp || "")
  pendingOutbound.set(pendingId, {
    pc, sendTrack, sender,
    getRemoteTrack: () => remoteTrack,
    offerSdp,
    from: from || "",        // the CUSTOMER's wa_id we are dialing
    to: to || "",
    phoneNumberId: phoneNumberId || "",
    branchId: branchId || null,
    callId: null,
    createdAt: Date.now(),
  })
  console.log(`📤 WhatsApp outbound offer held ${pendingId} (branch=${branchId || "hq"}) — awaiting Graph connect + answer`)
  return { pendingId, offerSdp }
}

/** Bind Meta's call_id to a held offer (step 3 — Graph accepted our connect). */
function registerOutboundCallId({ pendingId, callId }) {
  if (!pendingId || !callId) return { ok: false, error: "pendingId and callId are required" }
  const pending = pendingOutbound.get(pendingId)
  if (!pending) return { ok: false, error: "pending offer not found or expired" }
  pending.callId = callId
  outboundByCallId.set(callId, pendingId)
  return { ok: true }
}

/** The customer answered: complete the negotiation and go live. */
async function attachOutboundSession({ callId, sdp, from, to }) {
  if (!callId || !sdp) throw new Error("callId and sdp are required")
  const pendingId = outboundByCallId.get(callId)
  if (!pendingId) throw new Error(`no pending outbound offer for callId ***${String(callId).slice(-8)} (wrong callId, or the offer expired/canceled)`)
  const pending = pendingOutbound.get(pendingId)
  if (!pending) {
    outboundByCallId.delete(callId)
    throw new Error("pending offer expired before the answer arrived")
  }
  pendingOutbound.delete(pendingId)
  outboundByCallId.delete(callId)

  try {
    await pending.pc.setRemoteDescription({ type: "answer", sdp })
  } catch (e) {
    try { pending.pc.close() } catch {}
    throw new Error(`outbound answer rejected: ${e.message}`)
  }

  // Negotiation completed — the codec/ssrc are final exactly like inbound.
  const pt = pending.sendTrack.codec?.payloadType
  if (pt === undefined || pt === null) {
    try { pending.pc.close() } catch {}
    throw new Error("opus payload type missing after answer negotiation — customer SDP contained no compatible audio codec")
  }
  const ssrc = pending.sender.ssrc || pending.sendTrack.ssrc

  const session = new WhatsAppCallSession({
    callId,
    from: from || pending.from,   // the customer's wa_id (who we called)
    to: to || pending.to,
    phoneNumberId: pending.phoneNumberId,
    branchId: pending.branchId,
  })
  sessions.set(callId, session.attach({
    pc: pending.pc, sendTrack: pending.sendTrack, sender: pending.sender,
    answerSdp: null, payloadType: pt, ssrc,
    remoteTrack: pending.getRemoteTrack(),
  }))
  console.log(`📞 WhatsApp OUTBOUND call answered sid=${session.callSid} to=${maskPhone(session.from)} branch=${session.branchId || "hq"}`)
  // Greeting fires immediately — the pacer holds frames until ICE connects,
  // identical to the inbound path.
  session.start().catch((e) => console.error("wa outbound session start error:", e.message))
  return { ok: true, callSid: session.callSid }
}

function cancelOutboundOffer(pendingId, reason) {
  return dropPendingOffer(pendingId, reason)
}

// TTL sweeper — a Graph error, a crash between offer and register, or a
// customer who never answers must not leak a peer connection forever.
const __outboundSweep = setInterval(() => {
  const now = Date.now()
  for (const [pendingId, pending] of pendingOutbound) {
    if (now - pending.createdAt > OUTBOUND_OFFER_TTL_MS) dropPendingOffer(pendingId, "ttl expired")
  }
}, 30_000)
if (__outboundSweep.unref) __outboundSweep.unref()

function activeCount() {
  return sessions.size
}

function validateConfig() {
  const errors = []
  if (!API_KEY) errors.push("WHATSAPP_SERVICE_KEY is not set — the WhatsApp calling HTTP bridge cannot authenticate the Next.js app without it")
  if (WA_TTS_PROVIDER === "cartesia" && !process.env.CARTESIA_API_KEY) {
    // Not fatal: the session falls back to Sarvam TTS per call.
    console.warn("⚠ VOICEBOT_WA_TTS_PROVIDER=cartesia but CARTESIA_API_KEY is not set — WhatsApp calls will use Sarvam TTS")
  }
  return errors
}

function describeConfig() {
  const tts = WA_TTS_PROVIDER === "cartesia" && process.env.CARTESIA_API_KEY ? "Cartesia (with Sarvam fallback)" : "Sarvam"
  const rec = recorder.REC_ENABLED ? `on (${recorder.recordingsDir()})` : "off"
  return `STT: Sarvam Saaras (cloud) | LLM: via app /api/calls/turn | TTS: ${tts} | barge-in: ${BARGE_IN ? "on" : "off"} | recording: ${rec} | ICE: ${ICE_SERVERS.map((s) => s.urls).join(", ")}`
}

module.exports = {
  createCallAnswer,
  WhatsAppCallSession,
  startSession,
  endSession,
  waitConnectedSession,
  // outbound (business-initiated)
  createOutboundOffer,
  registerOutboundCallId,
  attachOutboundSession,
  cancelOutboundOffer,
  activeCount,
  validateConfig,
  describeConfig,
  callSidFor,
  // internals exported for tests
  filterSdpForWhatsApp, downsampleToStt, upsampleMono, pcmToWav16k, wavToPcm, avgEnergy,
  parseWav, wavSampleRate, resamplePcmMono, jsWavToPcm48k,
  RECORDING_NOTICE_PHRASE,
}

// Sweep orphaned recording files (crash mid-call / lost finalize) once at
// module load — after a pm2 restart this runs exactly once.
recorder.cleanupStale()
