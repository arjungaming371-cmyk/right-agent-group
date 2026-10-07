import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import { Readable } from "stream"
import { isSecurityEnabled } from "@/lib/security"
import { requireModuleOrRole } from "@/lib/auth"
import { safeRecordingPath } from "@/lib/recordings"
import { query } from "@/lib/db"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// Serve a WHATSAPP call recording (written by server/whatsapp-calls.js into
// the shared RECORDINGS_DIR) to authorized dashboard users.
//
//   GET /api/calls/recording/file?name=wacall-xxx.mp3
//
// Security:
//   • session auth, voice module — same gate as the Exotel recording proxy
//   • strict filename allowlist + resolved-path containment (no traversal —
//     `..%2F.env` and friends never resolve past the recordings dir)
//   • Cache-Control mirrors the call_recording_encryption toggle exactly like
//     the Exotel proxy: no decrypted bytes ever cached when it is ON
// Range support (206) so <audio> seeking works; slices capped at 8 MB.

const MAX_RANGE_SLICE = 8 * 1024 * 1024

function contentTypeFor(name: string): string {
  return name.endsWith(".mp3") ? "audio/mpeg" : "audio/wav"
}

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const name = req.nextUrl.searchParams.get("name") || ""
  const filePath = safeRecordingPath(name)
  if (!filePath) return NextResponse.json({ error: "invalid recording name" }, { status: 400 })

  // BRANCH SCOPE: recordings belong to a call; a call belongs to a branch.
  // A branch-scoped session may only open recordings whose voice_calls row
  // sits in its own branch. Unknown/legacy recordings (row missing) stay
  // reachable — the filenames are unguessable call SIDs, and admins (no
  // branch scope) always pass.
  const ownBranchId = sessionBranchId(session)
  if (ownBranchId) {
    const sid = name.replace(/\.(mp3|wav)$/i, "")
    try {
      const call = await query(`SELECT branch_id FROM voice_calls WHERE twilio_call_sid = $1 LIMIT 1`, [sid])
      if (call.rows[0]?.branch_id && call.rows[0].branch_id !== ownBranchId) {
        return NextResponse.json({ error: "recording not found" }, { status: 404 })
      }
    } catch {
      // voice_calls unavailable — fail closed for restricted roles below admin.
      if (session.role !== "admin" && session.role !== "developer") {
        return NextResponse.json({ error: "recording unavailable" }, { status: 503 })
      }
    }
  }

  let size = 0
  try {
    const st = await fs.promises.stat(filePath)
    if (!st.isFile()) return NextResponse.json({ error: "recording not found" }, { status: 404 })
    size = st.size
  } catch {
    return NextResponse.json({ error: "recording not found" }, { status: 404 })
  }
  if (size === 0) return NextResponse.json({ error: "empty recording" }, { status: 404 })

  const noStore = await isSecurityEnabled("call_recording_encryption")
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentTypeFor(name),
    "Accept-Ranges": "bytes",
    "Cache-Control": noStore ? "no-store" : "private, max-age=3600",
    "Content-Disposition": "inline",
  }

  // ---- Range request (browser <audio> seeking) ----
  const rangeHeader = req.headers.get("range")
  if (rangeHeader?.startsWith("bytes=")) {
    const parts = rangeHeader.slice("bytes=".length).split("-")
    const start = Number.parseInt(parts[0], 10)
    const endRaw = parts[1] ? Number.parseInt(parts[1], 10) : NaN
    if (Number.isNaN(start) || start < 0 || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      })
    }
    // Clamp: never hand out more than MAX_RANGE_SLICE per request, never
    // read past EOF. Browsers only need small windows to seek/play.
    const requestedEnd = Number.isNaN(endRaw) ? size - 1 : Math.min(endRaw, size - 1)
    const end = Math.min(requestedEnd, start + MAX_RANGE_SLICE - 1)
    const length = end - start + 1
    try {
      const fh = await fs.promises.open(filePath, "r")
      try {
        const buf = Buffer.alloc(length)
        await fh.read(buf, 0, length, start)
        return new NextResponse(buf, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(length),
          },
        })
      } finally {
        await fh.close().catch(() => {})
      }
    } catch (e) {
      console.error("🎙 recording file read error:", e)
      return NextResponse.json({ error: "read failed" }, { status: 500 })
    }
  }

  // ---- Full file: stream from disk (never buffered whole into memory) ----
  try {
    const nodeStream = fs.createReadStream(filePath)
    return new NextResponse(Readable.toWeb(nodeStream) as unknown as ReadableStream, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(size) },
    })
  } catch (e) {
    console.error("🎙 recording file stream error:", e)
    return NextResponse.json({ error: "read failed" }, { status: 500 })
  }
}
