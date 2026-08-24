import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { rateLimit, clientIp } from "@/lib/rate-limit"
import { verifyExotelWebhookKey } from "@/lib/exotel-webhook-auth"

// Exotel-specific quirk: when a call flow uses a Voicebot applet (ours does —
// that's the WebSocket bridge to server/voicebot-server.js), the recording
// URL is NOT delivered through the normal call StatusCallback. Exotel only
// sends it here, via a GET request to a Passthru applet placed immediately
// after the Voicebot applet in the Exotel Flow (App Bazaar). Without that
// applet configured, recording_url stays null forever — verified live:
// every real call had status/duration/sentiment updating correctly via
// /api/calls/status, but recording_url was null on 100% of them.
//
// One-time Exotel dashboard setup:
//   App Bazaar → your Voicebot Flow → add a Passthru applet directly after
//   the Voicebot applet → URL: https://YOUR-DOMAIN/api/calls/passthru
//
// Exotel's Passthru GET params (bracket-notation query keys):
//   CallSid, Stream[Status], Stream[Duration], Stream[RecordingUrl], ...
export async function GET(req: NextRequest) {
  if (!verifyExotelWebhookKey(req)) {
    return new NextResponse("OK", { status: 200 })
  }
  if (!rateLimit(`call-passthru:${clientIp(req)}`, 60, 60000)) {
    return new NextResponse("OK", { status: 200 })
  }

  const { searchParams } = new URL(req.url)
  const callSid = searchParams.get("CallSid") || ""
  // Accept every spelling Exotel's docs/live payloads have used — bracket
  // notation under the Stream applet, and a few flat fallbacks — since this
  // callback shape isn't consistently documented across Exotel's own guides.
  const recordingUrl =
    searchParams.get("Stream[RecordingUrl]") ||
    searchParams.get("RecordingUrl") ||
    searchParams.get("recording_url") ||
    null

  if (!callSid) return new NextResponse("OK", { status: 200 })

  try {
    if (recordingUrl) {
      await query(
        `UPDATE voice_calls SET recording_url = COALESCE(recording_url, $2) WHERE twilio_call_sid = $1`,
        [callSid, recordingUrl]
      )
    }
    console.log(`Passthru: ${callSid} | recordingUrl: ${recordingUrl || "(none in this callback)"}`)
  } catch (e: any) {
    console.error("passthru update error:", e.message)
  }

  return new NextResponse("OK", { status: 200 })
}
