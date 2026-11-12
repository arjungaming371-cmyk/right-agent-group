import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  return handleAnswer(req)
}

export async function POST(req: NextRequest) {
  return handleAnswer(req)
}

async function handleAnswer(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

  // Convert http:// to ws:// and https:// to wss://
  let wsUrl = appUrl.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://")
  wsUrl = `${wsUrl.replace(/\/+$/, "")}/voicebot`

  const wsKey = (process.env.VOICEBOT_WS_KEY || "").trim()
  if (wsKey) {
    wsUrl += `?key=${encodeURIComponent(wsKey)}`
  }

  const statusCallback = `${appUrl.replace(/\/+$/, "")}/api/calls/status`

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
