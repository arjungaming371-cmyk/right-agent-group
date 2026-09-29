import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { query } from "@/lib/db"
import { sarvamPresets, listCartesiaVoices, getCartesiaKey, getSarvamKey } from "@/lib/voice-catalog"

export const dynamic = "force-dynamic"

// Voice Studio catalog — GET /api/voices
//
// Returns everything the picker can speak with, merged into one list:
//   1. Sarvam Bulbul v3 presets (static catalog, live-validated on preview)
//   2. Cartesia voices fetched live from the account (factory + cloned there),
//      cached 1h on the server
//   3. Cloned voices registered locally in custom_voices (consent + audit
//      metadata attached; voice ids may be Sarvam clones or Cartesia clones)
//
// `keys` tells the UI which providers are usable right now so the Clone Lab
// can disable the right option without a failed round-trip.

type CustomVoiceRow = {
  id: string
  provider: "sarvam" | "cartesia"
  voice_id: string
  name: string
  gender: "female" | "male" | "neutral"
  primary_language: "english" | "hindi" | "telugu"
  description: string | null
  sample_text: string | null
  consent_confirmed: boolean
  consent_note: string | null
  consent_by: string | null
  created_by: string | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "branch_manager", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const [sarvamKey, cartesiaKey, cart] = await Promise.all([
      getSarvamKey(),
      getCartesiaKey(),
      listCartesiaVoices(),
    ])

    const customRes = await query(
      `SELECT id, provider, voice_id, name, gender, primary_language, description,
              sample_text, consent_confirmed, consent_note, created_by, created_at
         FROM custom_voices
        WHERE is_active = true
        ORDER BY created_at DESC`
    )
    const custom = (customRes.rows as CustomVoiceRow[]).map((r) => ({
      provider: r.provider,
      voiceId: r.voice_id,
      name: r.name,
      gender: r.gender,
      cloned: true,
      description: r.description || undefined,
      origin: "custom" as const,
      language: r.primary_language,
      consent: { confirmed: r.consent_confirmed, note: r.consent_note, by: r.consent_by || r.created_by },
      localId: r.id,
      createdAt: r.created_at,
    }))

    return NextResponse.json({
      sarvam: sarvamPresets(),
      cartesia: cart.voices,
      cartesiaError: cart.error || null,
      custom,
      keys: { sarvam: !!sarvamKey, cartesia: !!cartesiaKey },
    })
  } catch (e: unknown) {
    return apiError(e)
  }
}
