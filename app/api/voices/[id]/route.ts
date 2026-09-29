import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { deleteCustomVoice, VoiceProviderError } from "@/lib/voice-catalog"

export const dynamic = "force-dynamic"

// DELETE /api/voices/[id] — remove a locally registered cloned voice.
//
// Soft-deletes the custom_voices row (audit history stays) and best-effort
// deletes the voice at the provider too (Cartesia supports deletion; a
// provider-side failure is reported, not hidden — the row is already inactive
// so the voice never dials again either way).

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await requireRole(req, ["admin", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const { id } = await ctx.params
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 })
    }
    const { providerDelete } = await deleteCustomVoice(id)
    logAudit("voice deleted", session.email, { id, providerDelete })
    return NextResponse.json({ ok: true, providerDelete })
  } catch (e: unknown) {
    if (e instanceof VoiceProviderError && e.status === 404) {
      return NextResponse.json({ error: "voice not found" }, { status: 404 })
    }
    return apiError(e)
  }
}
