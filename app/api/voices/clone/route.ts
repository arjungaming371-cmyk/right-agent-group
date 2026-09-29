import { apiError } from "@/lib/api-error"
import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import {
  cartesiaCloneVoice,
  sarvamCloneVoice,
  synthesizePreview,
  VoiceProviderError,
  type VoiceLanguage,
} from "@/lib/voice-catalog"

export const dynamic = "force-dynamic"

// Voice Clone Lab — POST /api/voices/clone  (multipart/form-data)
//
//   file          audio sample 10–60s (.wav/.mp3/.m4a, ≤10 MB)  — required
//   provider      "sarvam" | "cartesia"                          — required
//   name          display name for the voice                     — required
//   language      primary language of the SAMPLE                 — required
//   gender        female | male | neutral                        — optional (default female)
//   description   what the voice is for                          — optional
//   consent       "true" — DPDP 2023 declaration confirmed       — required
//   consentNote   basis, e.g. "own voice" / "written consent"    — optional
//
//   → { ok, voice: { ...like GET /api/voices custom rows } }
//
// CONSENT IS A HARD GATE: cloning a real person's voice without their consent
// is illegal (DPDP Act 2023) and this endpoint refuses to run without the
// declaration. The reference audio is forwarded to the provider and then
// DISCARDED — it is never written to disk or the database; what is kept is
// the consent record + the provider voice id (enough to audit and delete).

const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME = ["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/webm"]

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const form = await req.formData()
    const file = form.get("file") as File | null
    const provider = String(form.get("provider") || "")
    const name = String(form.get("name") || "").trim().slice(0, 80)
    const language = String(form.get("language") || "english") as VoiceLanguage
    const genderRaw = String(form.get("gender") || "female")
    const description = String(form.get("description") || "").trim().slice(0, 300)
    const consent = String(form.get("consent") || "") === "true"
    const consentNote = String(form.get("consentNote") || "").trim().slice(0, 300)

    if (!file) return NextResponse.json({ error: "audio sample file required" }, { status: 400 })
    if (provider !== "sarvam" && provider !== "cartesia") {
      return NextResponse.json({ error: "provider must be sarvam or cartesia" }, { status: 400 })
    }
    if (!name) return NextResponse.json({ error: "voice name required" }, { status: 400 })
    if (!["english", "hindi", "telugu"].includes(language)) {
      return NextResponse.json({ error: "language must be english, hindi, or telugu" }, { status: 400 })
    }
    if (!consent) {
      return NextResponse.json(
        { error: "Consent declaration is mandatory — confirm you own this voice or hold written consent (DPDP Act 2023)" },
        { status: 400 }
      )
    }
    const rawMime = file.type || "audio/wav"
    const mime = rawMime.split(";")[0].trim().toLowerCase()
    const nameLower = (file.name || "").toLowerCase()
    const isAllowed =
      ALLOWED_MIME.includes(mime) ||
      mime === "audio/ogg" ||
      mime === "audio/aac" ||
      nameLower.endsWith(".wav") ||
      nameLower.endsWith(".mp3") ||
      nameLower.endsWith(".m4a") ||
      nameLower.endsWith(".webm") ||
      nameLower.endsWith(".ogg") ||
      nameLower.endsWith(".aac")
    if (!isAllowed) {
      return NextResponse.json({ error: `Unsupported audio type "${rawMime}" — use WAV, MP3, M4A, or WebM` }, { status: 400 })
    }
    const audio = Buffer.from(await file.arrayBuffer())
    if (audio.length < 20_000) {
      return NextResponse.json({ error: "Sample too short — please record or upload at least 5 to 10 seconds of clear speech" }, { status: 400 })
    }
    if (audio.length > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Sample too large (max 10 MB) — 10 to 60 seconds is plenty" }, { status: 413 })
    }

    const input = { audio, audioMime: mime, name, language, description }
    const { voiceId } = provider === "cartesia" ? await cartesiaCloneVoice(input) : await sarvamCloneVoice(input)

    // Register locally (metadata + consent ONLY — the audio buffer dies here).
    const inserted = await query(
      `INSERT INTO custom_voices
         (org_id, provider, voice_id, name, gender, primary_language, description, cloned,
          consent_confirmed, consent_note, consent_by, created_by)
       VALUES ((SELECT id FROM organizations ORDER BY created_at LIMIT 1), $1, $2, $3, $4, $5, $6, true,
               true, $7, $8, $9)
       ON CONFLICT (provider, voice_id) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description,
             consent_confirmed = true, consent_note = EXCLUDED.consent_note,
             consent_by = EXCLUDED.consent_by, is_active = true, updated_at = now()
       RETURNING id, provider, voice_id, name, gender, primary_language, description, created_at`,
      [provider, voiceId, name, ["female", "male", "neutral"].includes(genderRaw) ? genderRaw : "female",
       language, description || null, consentNote || null, session.email, session.email]
    )
    const row = inserted.rows[0] as { id: string; provider: string; voice_id: string; name: string; gender: string; primary_language: string; description: string | null; created_at: string }

    // First audition, generated server-side so the operator hears the result
    // immediately without a second manual step. Non-fatal on failure.
    let previewOk = false
    try {
      await synthesizePreview(provider as "sarvam" | "cartesia", voiceId, language)
      previewOk = true
    } catch { /* preview failure does not undo a successful clone */ }

    logAudit("voice cloned", session.email, { provider, voiceId, name, language, consentNote: consentNote || "declared" })
    return NextResponse.json(
      {
        ok: true,
        previewOk,
        voice: {
          provider: row.provider,
          voiceId: row.voice_id,
          name: row.name,
          gender: row.gender,
          cloned: true,
          description: row.description || undefined,
          origin: "custom" as const,
          language: row.primary_language,
          localId: row.id,
          createdAt: row.created_at,
        },
      },
      { status: 201 }
    )
  } catch (e: unknown) {
    if (e instanceof VoiceProviderError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return apiError(e)
  }
}
