import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import { verifyServiceKey } from "@/lib/service-key"
import { safeRecordingPath } from "@/lib/recordings"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

// Internal bridge: server/whatsapp-calls.js finalizes a WhatsApp call
// recording (mixed WAV → MP3 on the shared disk) and posts its metadata
// here, so the voice_calls row gets a playable URL in the dashboard.
// Auth = the SAME shared service key as /api/calls/turn (fail-closed).
//
// The file never travels over HTTP — the voicebot writes it directly into
// RECORDINGS_DIR; this route only validates it exists and links it up.
//
//  { callSid, filename, format, bytes, durationSec }
//     → { ok: true, filename, bytes }
//
// Failure semantics (never leaves a broken row behind):
//   400 unknown callSid/filename shape · 404 file missing on disk or call
//   row missing · 409 declared size ≠ actual size (crashed finalize).

type UploadBody = {
  callSid?: unknown
  filename?: unknown
  bytes?: unknown
}

const CALL_SID_RE = /^wacall-[A-Za-z0-9_-]{1,120}$/

export async function POST(req: NextRequest) {
  if (!verifyServiceKey(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: UploadBody
  try {
    body = (await req.json()) as UploadBody
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const callSid = typeof body?.callSid === "string" ? body.callSid : ""
  const filename = typeof body?.filename === "string" ? body.filename : ""
  if (!CALL_SID_RE.test(callSid)) {
    return NextResponse.json({ error: "invalid callSid" }, { status: 400 })
  }
  const filePath = safeRecordingPath(filename)
  if (!filePath) {
    return NextResponse.json({ error: "invalid filename" }, { status: 400 })
  }

  // The link target must physically exist — otherwise the dashboard would
  // hand users a URL that 404s at play time.
  let size = 0
  try {
    const st = await fs.promises.stat(filePath)
    if (!st.isFile() || st.size === 0) throw new Error("not a non-empty file")
    size = st.size
  } catch {
    return NextResponse.json({ error: "recording file not found on disk" }, { status: 404 })
  }

  // What the voicebot says it wrote must be what actually landed — a mismatch
  // means the finalize was interrupted mid-write (e.g. pm2 restart).
  const declared = Number(body?.bytes)
  if (Number.isFinite(declared) && declared > 0 && Math.abs(declared - size) > 4096) {
    return NextResponse.json(
      { error: `size mismatch: declared ${declared}, on disk ${size}` },
      { status: 409 },
    )
  }

  const publicUrl = `/api/calls/recording/file?name=${encodeURIComponent(filename)}`
  try {
    const res = await query(
      `UPDATE voice_calls
         SET recording_url = $2, updated_at = now()
       WHERE twilio_call_sid = $1
       RETURNING id`,
      [callSid, publicUrl],
    )
    if (!res.rows?.length) {
      // No voice_calls row (start event never landed). Keep the file on disk —
      // the boot-time sweep clears it after 24 h — but tell the voicebot.
      console.error(`🎙 recording upload: no voice_calls row for ${callSid} — file kept, dashboard link skipped`)
      return NextResponse.json({ error: "call row not found" }, { status: 404 })
    }
  } catch (e) {
    console.error(`🎙 recording upload: DB error for ${callSid}:`, e)
    return NextResponse.json({ error: "database error" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, filename, bytes: size })
}
