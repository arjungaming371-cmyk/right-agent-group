// Shared contract for WhatsApp call recordings written by
// server/whatsapp-calls.js (voicebot) and served by
// app/api/calls/recording/file. The two processes run on the SAME box and
// share this directory (set RECORDINGS_DIR in .env to move it — both sides
// must point at the same place; the default is <repo>/recordings, gitignored).
import fs from "fs"
import path from "path"

export function recordingsDir(): string {
  return (process.env.RECORDINGS_DIR || "").trim() ||
    path.join(process.cwd(), "recordings")
}

// The voicebot only ever produces <callSid>.mp3|wav and the file route only
// ever serves these — a strict allowlist instead of trying to sanitize
// arbitrary input. (callSid itself is `wacall-` + Meta's call id.)
const RECORDING_NAME_RE = /^wacall-[A-Za-z0-9_-]{1,120}\.(mp3|wav)$/

/**
 * Resolve a recording filename to a path INSIDE the recordings directory.
 * Returns null for anything that is not a valid recording name or escapes
 * the directory (path traversal) — callers turn null into a 400.
 */
export function safeRecordingPath(name: string): string | null {
  if (!RECORDING_NAME_RE.test(name)) return null
  const dir = path.resolve(recordingsDir())
  const full = path.resolve(dir, name)
  if (full !== dir && !full.startsWith(dir + path.sep)) return null
  return full
}

/** Directory existence + writability probe for the status/diagnose pages. */
export function recordingsDirWritable(): boolean {
  try {
    fs.accessSync(recordingsDir(), fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}
