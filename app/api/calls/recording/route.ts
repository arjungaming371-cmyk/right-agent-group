import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { isSecurityEnabled } from "@/lib/security"

// Proxy Exotel recording audio through our server
// This avoids the browser Basic Auth popup on protected recording URLs
// when accessing recording URLs directly
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get("url")

  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 })

  // Only proxy Exotel recording URLs — validate the HOSTNAME, not a substring
  // (substring checks can be bypassed with URLs like evil.com/?x=exotel.com).
  let hostname = ""
  try {
    hostname = new URL(url).hostname
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }
  const allowed = hostname === "exotel.com" || hostname.endsWith(".exotel.com") || hostname === "exotel.in" || hostname.endsWith(".exotel.in")
  if (!allowed) return NextResponse.json({ error: "Invalid URL" }, { status: 400 })

  const EXO_KEY   = process.env.EXOTEL_API_KEY || ""
  const EXO_TOKEN = process.env.EXOTEL_API_TOKEN || ""

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${EXO_KEY}:${EXO_TOKEN}`).toString("base64")}`,
      },
    })

    if (!res.ok) {
      return NextResponse.json({ error: `Exotel returned ${res.status}` }, { status: 502 })
    }

    const audio = await res.arrayBuffer()
    // Call Recording Encryption toggle: recordings live encrypted at the
    // provider and are only ever streamed through this authenticated proxy
    // over TLS — when the toggle is ON we additionally forbid any caching,
    // so no decrypted copy is ever written to browser or proxy disk.
    const noStore = await isSecurityEnabled("call_recording_encryption")
    return new NextResponse(audio, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
        "Cache-Control": noStore ? "no-store" : "private, max-age=3600",
      },
    })
  } catch (e: any) {
    return apiError(e)
  }
}
