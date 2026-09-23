import { NextRequest, NextResponse } from "next/server"
import { requireModuleOrRole } from "@/lib/auth"
import { branchWhatsAppCtx } from "@/lib/whatsapp"

export const dynamic = "force-dynamic"

// WHY is my WhatsApp not reaching phones? One click answers it.
//
// Live-pings Meta's Graph API with the EXACT credentials the sender uses
// (company number, or the lead's branch number) and returns the raw truth:
//   token_valid  — is WHATSAPP_TOKEN accepted right now? (190 = expired)
//   phone        — display number Meta has for the phone_number_id
//   verified_name / quality_rating / platform_type — number health
//   error        — Meta's verbatim message (wrong phone_number_id,
//                  token expired, business unverified, app in dev mode…)
//
// This is a READ-ONLY GET to the phone node — nothing is sent, no customer
// is contacted, and it costs nothing.
export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const branchId = req.nextUrl.searchParams.get("branchId") || null
  const ctx = await branchWhatsAppCtx(branchId || undefined)

  const token = ctx?.whatsappToken || process.env.WHATSAPP_TOKEN
  const phoneId = ctx?.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!token || !phoneId) {
    return NextResponse.json({
      ok: false,
      token_valid: false,
      error: "WhatsApp Cloud API is not configured — set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env (or the branch's own number in Branches).",
    })
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneId}?fields=display_phone_number,verified_name,quality_rating,platform_type,code_verification_status&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15000) },
    )
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        token_valid: res.status !== 401 && data?.error?.code !== 190,
        error: data?.error?.error_data?.details || data?.error?.message || `Meta HTTP ${res.status}`,
        code: data?.error?.code ?? res.status,
      })
    }
    return NextResponse.json({
      ok: true,
      token_valid: true,
      phone: data.display_phone_number,
      verified_name: data.verified_name,
      quality_rating: data.quality_rating,
      platform_type: data.platform_type,
      code_verification_status: data.code_verification_status,
      error: null,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, token_valid: null, error: `Meta unreachable: ${e.message}` })
  }
}
