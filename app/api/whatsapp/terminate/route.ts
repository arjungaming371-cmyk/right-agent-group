import { NextRequest, NextResponse } from "next/server"
import { verifyServiceKey } from "@/lib/service-key"
import { terminateWhatsAppCall, type BranchWhatsAppCtx } from "@/lib/whatsapp"
import { resolveBranchByWhatsAppPhoneId } from "@/lib/branches"

export const dynamic = "force-dynamic"

// Internal bridge: the WhatsApp voicebot session (server/whatsapp-calls.js)
// asks the app to hang a call up business-side. For the longest time Priya
// said her goodbye and then the line just stayed open in silence until the
// CUSTOMER hung up (or the 120s media watchdog reaped it) — the turn API's
// hangup flag was logged, not acted on, because "Graph terminate" was never
// wired. lib/whatsapp.terminateWhatsAppCall already existed; this route is
// the missing link: session → app (shared WHATSAPP_SERVICE_KEY auth, same
// as /api/calls/turn) → Meta Graph action=terminate.
//
//   { callId, phoneNumberId? }
//     → { ok: true } | { ok: false, error }
//
// Branch routing mirrors the webhook: the WABA that OWNS the called number
// terminates the call (a branch token can't touch another number's call).
// Fail-open semantics for the CALLER of this route: a non-ok result is
// reported, never thrown — the session's own fallback timer still ends the
// call locally if the webhook never arrives.
export async function POST(req: NextRequest) {
  if (!verifyServiceKey(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const callId = typeof body.callId === "string" ? body.callId.trim() : ""
  if (!callId) {
    return NextResponse.json({ error: "callId required" }, { status: 400 })
  }

  let branch: BranchWhatsAppCtx = null
  const phoneNumberId = typeof body.phoneNumberId === "string" ? body.phoneNumberId.trim() : ""
  if (phoneNumberId) {
    try {
      branch = await resolveBranchByWhatsAppPhoneId(phoneNumberId)
    } catch (e) {
      console.warn(`wa terminate: branch lookup failed for phone_number_id (${(e as Error).message}) — using default WABA creds`)
    }
  }

  const cleanCallId = callId.replace(/^wacall-/, "").trim()
  const res = await terminateWhatsAppCall(cleanCallId, branch)
  if (res.ok) {
    console.log(`⏹ wa hangup: Graph terminate accepted for ${cleanCallId}${branch?.id ? ` (branch ${branch.id})` : ""}`)
  } else {
    // Expected when the customer already hung up first — log, don't alarm.
    console.warn(`wa hangup: Graph terminate rejected for ${cleanCallId}: ${res.error}`)
  }
  return NextResponse.json({ ok: res.ok, error: res.error ?? null }, { status: res.ok ? 200 : (res.status || 400) })
}
