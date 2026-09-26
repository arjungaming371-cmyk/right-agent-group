import { NextRequest, NextResponse } from "next/server"
import { requireModuleOrRole } from "@/lib/auth"
import { getDialerSettings, setDialerSettings, type DialerSettings } from "@/lib/dialer-settings"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// Dialer runtime settings — the persisted concurrency slider + auto-retry
// policy (Features 3+4 of the bulk plan). The bulk runner re-reads these on
// EVERY invocation, so a slider change is genuinely "on the fly".
//
//   GET   → the current settings (every voice-module role can see them)
//   PATCH → update { concurrency?, autoRetry?, retryDelayMinutes?, maxRetries? }
//           (admin / branch_manager only)

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  return NextResponse.json(await getDialerSettings())
}

export async function PATCH(req: NextRequest) {
  const session = await requireModuleOrRole(req, "voice", ["admin", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as Partial<DialerSettings>
  const updated = await setDialerSettings(
    {
      concurrency: body.concurrency !== undefined ? Number(body.concurrency) : undefined,
      autoRetry: body.autoRetry !== undefined ? body.autoRetry === true : undefined,
      retryDelayMinutes: body.retryDelayMinutes !== undefined ? Number(body.retryDelayMinutes) : undefined,
      maxRetries: body.maxRetries !== undefined ? Number(body.maxRetries) : undefined,
    },
    session.email
  )
  logAudit("dialer settings updated", session.email, { ...updated })
  return NextResponse.json({ ok: true, ...updated })
}
