import { NextRequest, NextResponse } from "next/server"
import { verifyTelephonyWebhookKey } from "@/lib/exotel-webhook-auth"
import { query } from "@/lib/db"

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

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

  const leadId = req.nextUrl.searchParams.get("leadId") || ""
  const branchId = req.nextUrl.searchParams.get("branchId") || ""
  const lang = req.nextUrl.searchParams.get("lang") || "telugu"

  let callUuid = ""
  let requestUuid = ""
  let to = ""
  let from = ""

  const contentType = req.headers.get("content-type") || ""
  const rawBody = await req.text().catch(() => "")
  if (rawBody) {
    if (contentType.includes("application/json")) {
      try {
        const json = JSON.parse(rawBody) as Record<string, unknown>
        callUuid = String(json.CallUUID || json.call_uuid || json.CallSid || json.call_sid || "")
        requestUuid = String(json.RequestUUID || json.request_uuid || json.request_id || "")
        to = String(json.To || json.to || "")
        from = String(json.From || json.from || "")
      } catch {}
    } else {
      try {
        const params = new URLSearchParams(rawBody)
        callUuid = params.get("CallUUID") || params.get("call_uuid") || params.get("CallSid") || params.get("call_sid") || ""
        requestUuid = params.get("RequestUUID") || params.get("request_uuid") || params.get("request_id") || ""
        to = params.get("To") || params.get("to") || ""
        from = params.get("From") || params.get("from") || ""
      } catch {}
    }
  }

  if (!callUuid) {
    callUuid = req.nextUrl.searchParams.get("CallUUID") || req.nextUrl.searchParams.get("call_uuid") || ""
  }
  if (!requestUuid) {
    requestUuid = req.nextUrl.searchParams.get("RequestUUID") || req.nextUrl.searchParams.get("request_uuid") || ""
  }

  console.log(`[vobiz-answer] callUuid=${callUuid} requestUuid=${requestUuid} leadId=${leadId} lang=${lang} to=${to}`)

  // Link Vobiz live CallUUID with the outbound initiated row in voice_calls
  if (callUuid) {
    try {
      if (requestUuid) {
        await query(
          `UPDATE voice_calls 
              SET twilio_call_sid = $1, status = 'in-progress', updated_at = NOW() 
            WHERE twilio_call_sid = $2`,
          [callUuid, requestUuid]
        )
      } else if (leadId) {
        await query(
          `UPDATE voice_calls 
              SET twilio_call_sid = $1, status = 'in-progress', updated_at = NOW() 
            WHERE id = (
              SELECT id FROM voice_calls 
              WHERE lead_id = $2 AND status = 'initiated' AND direction = 'outbound'
              ORDER BY created_at DESC LIMIT 1
            )`,
          [callUuid, leadId]
        )
      }
    } catch (e) {
      console.error("vobiz-answer: failed to link callSid:", e)
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

  // Convert http:// to ws:// and https:// to wss://
  let wsUrl = appUrl.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://")
  wsUrl = `${wsUrl.replace(/\/+$/, "")}/voicebot`

  const queryParams = new URLSearchParams()
  const wsKey = (process.env.VOICEBOT_WS_KEY || "").trim()
  if (wsKey) queryParams.set("key", wsKey)
  if (callUuid) queryParams.set("callSid", callUuid)
  if (leadId) queryParams.set("leadId", leadId)
  if (branchId) queryParams.set("branchId", branchId)
  if (lang) queryParams.set("lang", lang)
  if (to) queryParams.set("to", to)

  const queryString = queryParams.toString()
  if (queryString) {
    wsUrl += `?${queryString}`
  }

  const webhookKey = (process.env.VOBIZ_WEBHOOK_KEY || process.env.EXOTEL_WEBHOOK_KEY || "").trim()
  const statusKeyParam = webhookKey ? `?key=${encodeURIComponent(webhookKey)}` : ""
  const statusCallback = `${appUrl.replace(/\/+$/, "")}/api/calls/status${statusKeyParam}`

  // Return VobizXML instructing Vobiz to stream bidirectional audio to our WebSocket server
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" statusCallbackUrl="${escapeXml(statusCallback)}" statusCallbackMethod="POST">
    ${escapeXml(wsUrl)}
  </Stream>
</Response>`

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  })
}
