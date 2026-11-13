import { NextRequest, NextResponse } from "next/server"
import { verifyTelephonyWebhookKey } from "@/lib/exotel-webhook-auth"

export async function GET(req: NextRequest) {
  return handleAnswer(req)
}

export async function POST(req: NextRequest) {
  return handleAnswer(req)
}

async function handleAnswer(req: NextRequest) {
  if (!verifyTelephonyWebhookKey(req, "vobiz")) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

  // Convert http:// to ws:// and https:// to wss://
  let wsUrl = appUrl.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://")
  wsUrl = `${wsUrl.replace(/\/+$/, "")}/voicebot`

  const wsKey = (process.env.VOICEBOT_WS_KEY || "").trim()
  if (wsKey) {
    wsUrl += `?key=${encodeURIComponent(wsKey)}`
  }

  const webhookKey = (process.env.VOBIZ_WEBHOOK_KEY || process.env.EXOTEL_WEBHOOK_KEY || "").trim()
  const statusKeyParam = webhookKey ? `?key=${encodeURIComponent(webhookKey)}` : ""
  const statusCallback = `${appUrl.replace(/\/+$/, "")}/api/calls/status${statusKeyParam}`

  // Return VobizXML instructing Vobiz to stream bidirectional audio to our WebSocket server
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" statusCallbackUrl="${statusCallback}" statusCallbackMethod="POST">
    ${wsUrl}
  </Stream>
</Response>`

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  })
}
