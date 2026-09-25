// Right Agent Group — WhatsApp call recorder.
//
// Records BOTH sides of a WhatsApp voice call (the caller's inbound RTP and
// Priya's outbound TTS playback) to one playable file, WITHOUT ever being
// allowed to break the live call: every failure degrades to "no recording",
// never to a dropped session.
//
// Design (staff-level constraints):
//   • Memory-flat — audio is streamed to disk as 16 kHz mono s16le raw PCM
//     the moment it arrives (two temp files per call), so even a 30-minute
//     call costs O(1) RAM, not the whole PCM buffer.
//   • Playout-accurate — the outbound side is captured in the RTP pacer (what
//     was ACTUALLY sent on the wire, silence included), not at TTS-enqueue
//     time, so barge-in-cut sentences and queue waits can't skew the mix.
//   • Mix = simple sample-add on a shared 16 kHz timeline (both sides are
//     frame-aligned 20 ms streams from call start), clamped to s16 range.
//   • finalize() mixes chunk-by-chunk with async FileHandles (no event-loop
//     blocking for other live calls), writes a proper WAV header, then
//     transcodes to MP3 via ffmpeg (already a hard TTS dependency) to cut
//     disk use ~10x — with an automatic fallback to keeping the WAV.
//   • Orphan sweep: temp/final files older than 24 h are removed on boot, so
//     a crash mid-call can never leak disk forever.
//
// Same-box contract: the Next.js app serves these files from the SAME
// directory (RECORDINGS_DIR, default <repo>/recordings) — both processes run
// on one host, exactly like the existing loopback HTTP bridge.

const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const { spawn } = require("child_process")

// ---------- Configuration ----------

const REC_ENABLED = (process.env.RECORD_CALLS === undefined
  ? "1"
  : process.env.RECORD_CALLS).trim() !== "0"

const REC_RATE = 16000 // mono s16 — wideband speech, half the 48k wire rate

function recordingsDir() {
  return (process.env.RECORDINGS_DIR || "").trim() ||
    path.join(__dirname, "..", "recordings")
}

function tmpDir() {
  return path.join(recordingsDir(), "tmp")
}

// Hard cap per call (both safety valve and disk guarantee). 1..120 minutes.
function maxBytes() {
  const minutes = Math.min(120, Math.max(1,
    parseInt(process.env.RECORDING_MAX_MINUTES || "30") || 30))
  return minutes * 60 * REC_RATE * 2
}

// 20 ms of silence at REC_RATE (320 samples × 2 bytes) — what the pacer
// records on ticks that carry no speech.
const SILENCE_20MS = Buffer.alloc(REC_RATE / 50 * 2)

// ---------- Pure helpers (unit-tested in scripts/test-wa-recorder.js) ----------

/** 44-byte canonical PCM WAV header for mono s16 at REC_RATE. */
function wavHeader(dataBytes) {
  const h = Buffer.alloc(44)
  h.write("RIFF", 0)
  h.writeUInt32LE(36 + dataBytes, 4)
  h.write("WAVE", 8)
  h.write("fmt ", 12)
  h.writeUInt32LE(16, 16)        // fmt chunk size
  h.writeUInt16LE(1, 20)         // PCM
  h.writeUInt16LE(1, 22)         // mono
  h.writeUInt32LE(REC_RATE, 24)
  h.writeUInt32LE(REC_RATE * 2, 28) // byte rate
  h.writeUInt16LE(2, 32)         // block align
  h.writeUInt16LE(16, 34)        // bits per sample
  h.write("data", 36)
  h.writeUInt32LE(dataBytes, 40)
  return h
}

/**
 * Mix one chunk of the two timelines sample-by-sample with clipping.
 * `n` = valid bytes in each buffer; the shorter side is treated as silence
 * past its length (caller left / Priya finished, respectively).
 */
function mixChunk(inBuf, outBuf, n) {
  const mixed = Buffer.alloc(n)
  for (let i = 0; i + 1 < n; i += 2) {
    const a = i < inBuf.length ? inBuf.readInt16LE(i) : 0
    const b = i < outBuf.length ? outBuf.readInt16LE(i) : 0
    const s = a + b
    mixed.writeInt16LE(s > 32767 ? 32767 : s < -32768 ? -32768 : s, i)
  }
  return mixed
}

/** WAV → MP3 (64 kbps mono, voice-optimized). Resolves false on ANY failure —
 *  the caller then keeps the WAV. ffmpeg is already required for TTS decode,
 *  so this adds no new deployment dependency. */
function transcodeToMp3(wavPath, mp3Path) {
  return new Promise((resolve) => {
    let stderr = ""
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", wavPath,
      "-codec:a", "libmp3lame", "-b:a", "64k", "-ac", "1", "-ar", String(REC_RATE),
      mp3Path,
    ])
    ff.stderr?.on("data", (c) => { stderr = (stderr + String(c)).slice(-400) })
    ff.on("error", () => resolve(false))
    ff.on("close", (code) => resolve(code === 0))
    setTimeout(() => { try { ff.kill("SIGKILL") } catch {} }, 120_000) // never hang finalize
    ff.on("close", () => { if (stderr && process.env.VOICEBOT_DEBUG_LOGS === "1") console.error(`recorder ffmpeg: ${stderr}`) })
  })
}

// ---------- Recorder ----------

class CallRecorder {
  /** @param {string} callSid e.g. "wacall-xxxx" (validated by callers) */
  constructor(callSid) {
    this.callSid = String(callSid || "").replace(/[^\w-]/g, "").slice(0, 128)
    this.started = false
    this.done = false       // finalize() entered — pushes become no-ops
    this.capped = false     // duration cap hit — that stream is closed early
    this.streamsOk = false
    this.inBytes = 0
    this.outBytes = 0
    this.inStream = null
    this.outStream = null
    this.inPath = null
    this.outPath = null
    this.meta = null
  }

  /** Open the two temp PCM streams. Never throws. */
  start() {
    if (this.started || !this.callSid) return
    this.started = true
    try {
      fs.mkdirSync(tmpDir(), { recursive: true })
      this.inPath = path.join(tmpDir(), `${this.callSid}.in.pcm`)
      this.outPath = path.join(tmpDir(), `${this.callSid}.out.pcm`)
      this.inStream = fs.createWriteStream(this.inPath, { flags: "w" })
      this.outStream = fs.createWriteStream(this.outPath, { flags: "w" })
      this.inStream.on("error", (e) => this._streamFailed("in", e))
      this.outStream.on("error", (e) => this._streamFailed("out", e))
      this.streamsOk = true
    } catch (e) {
      console.error(`🎙 recorder: cannot open temp streams for ${this.callSid}: ${e.message} — call continues WITHOUT recording`)
      this.streamsOk = false
    }
  }

  _streamFailed(side, e) {
    if (!this.streamsOk) return
    this.streamsOk = false
    console.error(`🎙 recorder: ${side} stream failed for ${this.callSid}: ${e.message} — recording degraded, call continues`)
  }

  /** Caller audio (16 kHz mono s16 chunk, e.g. a downsampled 20 ms frame). */
  pushInbound(buf) {
    this._push("in", buf)
  }

  /** Priya audio (16 kHz mono s16 chunk, captured at RTP playout time). */
  pushOutbound(buf) {
    this._push("out", buf)
  }

  _push(side, buf) {
    if (!this.streamsOk || this.done || !buf || !buf.length) return
    const stream = side === "in" ? this.inStream : this.outStream
    if (!stream || stream.destroyed) return
    const cap = maxBytes()
    const written = side === "in" ? this.inBytes : this.outBytes
    if (written >= cap) {
      if (!this.capped) {
        this.capped = true
        console.warn(`🎙 recorder: ${this.callSid} hit the ${Math.round(cap / (REC_RATE * 2) / 60)} min cap — recording stops growing, call continues`)
        try { stream.end() } catch {}
      }
      return
    }
    try {
      stream.write(buf)
      if (side === "in") this.inBytes += buf.length
      else this.outBytes += buf.length
    } catch { /* error handler flips streamsOk */ }
  }

  /**
   * True while capture is genuinely writing to disk. The consent notice
   * gates on this: a disk-full/mkdir failure must never have Priya announce
   * "this call is recorded" when no recording will exist.
   */
  recording() {
    return this.started && this.streamsOk && !this.done
  }

  /** Close both streams; safe to call twice. */
  async closeStreams() {
    const close = (s) => new Promise((res) => {
      if (!s || s.destroyed || s.writableEnded) return res()
      s.end(() => res())
      try { s.on("error", () => res()) } catch { res() }
    })
    await Promise.all([close(this.inStream), close(this.outStream)])
  }

  /**
   * Mix → WAV → (MP3 | keep WAV) → delete temps. Resolves
   * { filename, format, bytes, durationSec } or null when there is no audio.
   * Callers must try/catch — disk errors surface here.
   */
  async finalize() {
    if (this.done) return this.meta
    this.done = true
    await this.closeStreams()
    if (!this.started) return null

    const totalBytes = Math.max(this.inBytes, this.outBytes)
    if (totalBytes < 2) {
      // Nothing captured (ICE never connected / instant hangup) — no file.
      await this._removeTemps()
      return null
    }

    const dir = recordingsDir()
    await fsp.mkdir(dir, { recursive: true })
    const totalDataBytes = totalBytes % 2 ? totalBytes - 1 : totalBytes
    const wavPath = path.join(dir, `${this.callSid}.wav`)
    const mp3Path = path.join(dir, `${this.callSid}.mp3`)

    // Chunked async mix — never loads the whole call into RAM, never blocks
    // the pacer of other live calls for more than one chunk write.
    const inFd = await fsp.open(this.inPath || "/dev/null", "r")
    const outFd = await fsp.open(this.outPath || "/dev/null", "r")
    const wavFd = await fsp.open(wavPath, "w")
    let written = 0 // real mixed bytes — used for duration after the fd loop
    try {
      await wavFd.write(wavHeader(totalDataBytes))
      const CHUNK = REC_RATE * 2 // 1 second of mono s16
      const inBuf = Buffer.alloc(CHUNK)
      const outBuf = Buffer.alloc(CHUNK)
      while (written < totalDataBytes) {
        const want = Math.min(CHUNK, totalDataBytes - written)
        const inRes = await inFd.read(inBuf, 0, want, 44 + written)
        const outRes = await outFd.read(outBuf, 0, want, 44 + written)
        if (inRes.bytesRead === 0 && outRes.bytesRead === 0) break
        const n = Math.max(inRes.bytesRead, outRes.bytesRead)
        if (n < 2) break
        await wavFd.write(mixChunk(inBuf, outBuf, n))
        written += n
      }
      if (written !== totalDataBytes) {
        // Rare (disk hiccup): patch the header so the file stays playable.
        const patched = wavHeader(written)
        await wavFd.write(patched.subarray(4, 8), 0, 4, 4)   // RIFF size
        await wavFd.write(patched.subarray(40, 44), 0, 4, 40) // data size
      }
    } finally {
      await Promise.all([inFd.close().catch(() => {}), outFd.close().catch(() => {}), wavFd.close().catch(() => {})])
    }

    // MP3 keeps a month of logs at ~1/10 the disk; WAV is the fallback so a
    // missing/odd ffmpeg build still yields a playable recording.
    let filename = null, format = null, bytes = 0
    const mp3Ok = await transcodeToMp3(wavPath, mp3Path)
    if (mp3Ok) {
      try {
        const st = await fsp.stat(mp3Path)
        if (st.isFile() && st.size > 0) {
          filename = path.basename(mp3Path); format = "mp3"; bytes = st.size
          await fsp.unlink(wavPath).catch(() => {})
        }
      } catch { /* fall through to WAV */ }
    }
    if (!filename) {
      const st = await fsp.stat(wavPath)
      filename = path.basename(wavPath); format = "wav"; bytes = st.size
      await fsp.unlink(mp3Path).catch(() => {})
    }

    await this._removeTemps()
    this.meta = {
      filename,
      format,
      bytes,
      durationSec: Math.round((written / (REC_RATE * 2)) * 10) / 10,
    }
    return this.meta
  }

  async _removeTemps() {
    await Promise.all(
      [this.inPath, this.outPath].filter(Boolean).map((p) => fsp.unlink(p).catch(() => {}))
    )
  }
}

/**
 * Factory honoring RECORD_CALLS. Returns null when recording is disabled —
 * the call path treats that as "no recorder" and skips every capture point.
 */
function createFor(callSid) {
  if (!REC_ENABLED) return null
  return new CallRecorder(callSid)
}

/**
 * Boot-time orphan sweep: a crash mid-call (or a lost finalize) leaves temp
 * PCM / finished files behind. Anything older than 24 h matching our strict
 * wacall-* naming goes away. Never throws.
 */
function cleanupStale(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!REC_ENABLED) return 0
  let removed = 0
  try {
    const now = Date.now()
    for (const dir of [recordingsDir(), tmpDir()]) {
      let entries = []
      try { entries = fs.readdirSync(dir) } catch { continue }
      for (const f of entries) {
        if (!/^wacall-[\w.-]+$/.test(f)) continue
        const full = path.join(dir, f)
        try {
          const st = fs.statSync(full)
          if (st.isFile() && now - st.mtimeMs > maxAgeMs) {
            fs.unlinkSync(full)
            removed++
          }
        } catch { /* raced delete — fine */ }
      }
    }
    if (removed) console.log(`🧹 recordings: swept ${removed} stale file(s) older than 24h`)
  } catch (e) {
    console.error(`🧹 recordings cleanup error: ${e.message}`)
  }
  return removed
}

module.exports = {
  REC_ENABLED,
  REC_RATE,
  SILENCE_20MS,
  CallRecorder,
  createFor,
  cleanupStale,
  recordingsDir,
  // internals exported for tests
  wavHeader,
  mixChunk,
  transcodeToMp3,
  maxBytes,
}
