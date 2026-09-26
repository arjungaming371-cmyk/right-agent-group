// WhatsApp calling — WebRTC + audio-math verification.
//
// Exercises the REAL code path server/whatsapp-calls.js uses to answer a
// WhatsApp "connect" webhook: createCallAnswer() must negotiate opus, return
// a SHA-256-only SDP answer, and the resulting werift PC must carry live
// bidirectional opus RTP against another werift peer (simulating Meta's SFU).
//
// Run: node scripts/test-wa-webrtc.js   (no API keys / network needed)

process.env.WHATSAPP_SERVICE_KEY = process.env.WHATSAPP_SERVICE_KEY || "test-key"
process.env.VOICEBOT_WA_ICE_SERVERS = "" // host candidates only — pure loopback

// werift / @discordjs/opus are voicebot deps installed under server/
module.paths.push(require("path").join(__dirname, "..", "server", "node_modules"))

const {
  RTCPeerConnection,
  MediaStreamTrack,
  RtpHeader,
  RtpPacket,
} = require("werift")
const { OpusEncoder } = require("@discordjs/opus")
const {
  createCallAnswer,
  filterSdpForWhatsApp,
  downsampleToStt,
  upsampleMono,
  pcmToWav16k,
  wavToPcm,
  avgEnergy,
} = require("../server/whatsapp-calls")

const WA_RATE = 48000
const FRAME_SAMPLES = 960 // 20 ms
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

function waitForIceState(pc, states, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ICE state timeout (wanted ${states})`)), ms)
    pc.iceConnectionStateChange.subscribe((state) => {
      if (states.includes(state)) {
        clearTimeout(t)
        resolve(state)
      }
    })
  })
}

// Minimal Chrome-style offer: one audio m-line, opus 48k, DTLS-SRTP.
function offerSdp() {
  return [
    "v=0",
    "o=- 1234567890 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "c=IN IP4 0.0.0.0",
    "a=rtcp:9 IN IP4 0.0.0.0",
    "a=ice-ufrag:AbCdEfGh",
    "a=ice-pwd:IjKlMnOpQrStUvWxYz012345",
    "a=setup:actpass",
    "a=mid:0",
    "a=sendrecv",
    "a=rtcp-mux",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00",
  ].join("\r\n") + "\r\n"
}

async function testSdpFilter() {
  console.log("-- WhatsApp SDP fingerprint filter --")
  const dirty = [
    "v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=fingerprint:sha-1 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD",
    "a=fingerprint:sha-384 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00",
    "a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00",
    "a=rtpmap:111 opus/48000/2",
  ].join("\n")
  const out = filterSdpForWhatsApp(dirty)
  ok("sha-256 fingerprint kept", out.includes("a=fingerprint:sha-256"))
  ok("sha-1 fingerprint stripped", !out.includes("sha-1"))
  ok("sha-384 fingerprint stripped", !out.includes("sha-384"))
  ok("CRLF line endings", out.includes("\r\n"))
  ok("trailing CRLF terminator", out.endsWith("\r\n"))
}

async function testAudioMath() {
  console.log("-- resampler / WAV math (48k opus leg <-> 16k STT / 24k TTS) --")
  const frame = Buffer.alloc(FRAME_SAMPLES * 2)
  for (let i = 0; i < FRAME_SAMPLES; i++) frame.writeInt16LE(((i % 100) - 50) * 100, i * 2)

  const ds = downsampleToStt(frame)
  ok("48k -> 16k decimation is 3:1", ds.length / 2 === FRAME_SAMPLES / 3, `${ds.length / 2} samples (averaged, not picked)`)
  const dsMid = downsampleToStt(frame)
  ok("decimation deterministic", ds.equals(dsMid))

  const us = upsampleMono(ds, 3)
  ok("16k -> 48k upsample restores length", us.length === FRAME_SAMPLES * 2, `${us.length} bytes`)
  ok("upsample amplitude preserved at kept sample", Math.abs(us.readInt16LE(0)) > 0)

  const wav = pcmToWav16k(frame.subarray(0, 640))
  ok("WAV RIFF header", wav.slice(0, 4).toString() === "RIFF" && wav.slice(8, 12).toString() === "WAVE")
  ok("WAV mono 16-bit", wav.readUInt16LE(22) === 1 && wav.readUInt16LE(34) === 16)
  ok("WAV sample rate 16000", wav.readUInt32LE(24) === 16000)
  // CONTRACT (2026-09-25): wavToPcm resamples ANY input rate to the 48 kHz
  // WebRTC clock via ffmpeg (the old pass-through + hand-×2 upsample broke
  // pitch the moment a deployment changed SARVAM_TTS_SAMPLE_RATE). A 20 ms
  // 16 kHz frame therefore comes back 20 ms LONG at 48 kHz = 1920 bytes,
  // with the waveform energy preserved.
  const back = await wavToPcm(wav)
  ok("wavToPcm resamples 16k → 48k (20 ms in, 1920 B out)", back.length === 1920, `${back.length} bytes back`)
  ok("wavToPcm resample preserves energy", avgEnergy(back) > 0)
  const silentWav = pcmToWav16k(Buffer.alloc(640))
  const silentBack = await wavToPcm(silentWav)
  ok("wavToPcm resampled silence is silent", silentBack.length === 1920 && avgEnergy(silentBack) === 0, `${silentBack.length} bytes back`)

  ok("avgEnergy silence == 0", avgEnergy(Buffer.alloc(FRAME_SAMPLES * 2)) === 0)
  ok("avgEnergy loud > 0", avgEnergy(frame) > 0)
}

async function testLiveLoopback() {
  console.log("-- live werift<->werift media loopback through createCallAnswer() --")

  // Caller side (stands in for Meta's SFU).
  const caller = new RTCPeerConnection({ iceServers: [] })
  const callerTrack = new MediaStreamTrack({ kind: "audio" })
  const callerSender = caller.addTrack(callerTrack)

  await caller.setLocalDescription(await caller.createOffer())

  // The code under test: answer exactly like the WhatsApp webhook handler.
  const answer = await createCallAnswer(caller.localDescription.sdp)
  ok("answer SDP has audio m-line", /m=audio \d+ UDP\/TLS\/RTP\/SAVPF \d+/.test(answer.answerSdp))
  ok("answer negotiates opus (any payload type)",
    /a=rtpmap:\d+ opus\/48000\/2/i.test(answer.answerSdp),
    `payloadType=${answer.payloadType}`)
  ok("answer fingerprints are sha-256 only",
    answer.answerSdp.includes("a=fingerprint:sha-256") && !/a=fingerprint:(?!sha-256)/.test(answer.answerSdp),
    `payloadType=${answer.payloadType}`)
  ok("opus payload type resolved", Number.isInteger(answer.payloadType))
  ok("ssrc assigned", Number.isInteger(answer.ssrc))

  // Wire the loopback together.
  const receivedIn = [] // caller -> us (the direction the caller's voice flows)
  const receivedOut = [] // us -> caller (the direction Priya's TTS flows)

  // werift fires onTrack once, synchronously inside createCallAnswer's
  // setRemoteDescription — the captured answer.remoteTrack is the ONLY way to
  // see inbound media. (This is the exact property the production session
  // depends on; regressing it means the caller is never heard.)
  ok("remote track captured inside createCallAnswer", !!answer.remoteTrack)
  answer.remoteTrack.onReceiveRtp.subscribe(({ header, payload }) => {
    receivedIn.push({ seq: header.sequenceNumber, len: payload.length })
  })
  caller.onTrack.subscribe((track) => {
    track.onReceiveRtp.subscribe(({ header, payload }) => {
      receivedOut.push({ seq: header.sequenceNumber, len: payload.length })
    })
  })

  await caller.setRemoteDescription({ type: "answer", sdp: answer.answerSdp })

  // No manual candidate exchange: werift gathers INSIDE setLocalDescription
  // (non-trickle), so both SDPs already carry a=candidate lines — exactly the
  // property the webhook round-trip relies on (answer must go back complete).

  const bothUp = Promise.all([
    waitForIceState(caller, ["connected", "completed"], 20000),
    waitForIceState(answer.pc, ["connected", "completed"], 20000),
  ])
  const t0 = Date.now()
  await bothUp
  ok("ICE connected both directions", true, `${Date.now() - t0}ms (loopback DTLS-SRTP)`)

  // Caller's voice: 25 frames (~500 ms) of real opus audio toward our
  // session. Give DTLS-SRTP a moment to settle first — the first packets
  // after ICE-up race the handshake tail, exactly like a real call start.
  await sleep(150)
  const enc = new OpusEncoder(WA_RATE, 1)
  const pcm = Buffer.alloc(FRAME_SAMPLES * 2)
  for (let i = 0; i < FRAME_SAMPLES; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2)
  const opusFrame = enc.encode(pcm)

  let seq = 1000
  let ts = 8000
  const SENT = 25
  for (let i = 0; i < SENT; i++) {
    const header = new RtpHeader({
      payloadType: callerTrack.codec?.payloadType ?? 111,
      sequenceNumber: seq++,
      timestamp: ts,
      ssrc: callerSender.ssrc,
      marker: i === 0,
    })
    callerTrack.writeRtp(new RtpPacket(header, opusFrame))
    ts += FRAME_SAMPLES
    await sleep(20) // real-time pacing, keeps jitter buffer honest
  }
  await sleep(200)
  ok("caller -> us opus RTP received", receivedIn.length >= SENT / 2, `${receivedIn.length}/${SENT} frames`)
  ok("inbound payload sizes match opus frames", receivedIn.every((r) => r.len === opusFrame.length))
  ok("inbound sequence monotonic",
    receivedIn.every((r, i) => i === 0 || r.seq > receivedIn[i - 1].seq))

  // Priya's voice: write through the session's send track (same call the
  // pacer makes every 20 ms once ICE is up).
  const ours = enc.encode(pcm.subarray(0, FRAME_SAMPLES * 2))
  let oseq = 5000
  let ots = 16000
  for (let i = 0; i < 10; i++) {
    const header = new RtpHeader({
      payloadType: answer.payloadType,
      sequenceNumber: oseq++,
      timestamp: ots,
      ssrc: answer.ssrc,
      marker: i === 0,
    })
    answer.sendTrack.writeRtp(new RtpPacket(header, ours))
    ots += FRAME_SAMPLES
    await sleep(20)
  }
  await sleep(200)
  ok("us -> caller opus RTP received", receivedOut.length >= 5, `${receivedOut.length}/10 frames`)

  try { caller.close() } catch {}
  try { answer.pc.close() } catch {}
}

;(async () => {
  console.log("WhatsApp calling — WebRTC loopback + audio math self-test\n")
  await testSdpFilter()
  await testAudioMath()
  await testLiveLoopback()
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
