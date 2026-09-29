-- 2026-09-30 — Custom Voices (Voice Studio): cloned + curated voices registry.
--
-- The Voice Studio lets operators browse Sarvam Bulbul presets and Cartesia
-- voices (live from the provider), audition any of them in Telugu / Hindi /
-- English, and CLONE new voices from a short audio sample (Cartesia instant
-- cloning today; Sarvam's clone API is dispatched through the same table the
-- moment it is enabled on the account's key).
--
-- This table stores the METADATA + CONSENT RECORD only. It deliberately does
-- NOT store the reference audio: the voice sample is biometric-adjacent data
-- under DPDP Act 2023, so it is used in-flight for the clone request and then
-- discarded. What survives is the consent declaration (who confirmed, when,
-- and on what basis) plus the provider's voice id — enough to audit, delete
-- (provider + local), and rebuild a preview at any time via on-demand TTS.

CREATE TABLE IF NOT EXISTS custom_voices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID REFERENCES organizations(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('sarvam', 'cartesia')),
  voice_id         TEXT NOT NULL,                      -- Sarvam clone id (svc-...) or Cartesia voice UUID
  name             TEXT NOT NULL,
  gender           TEXT NOT NULL DEFAULT 'female' CHECK (gender IN ('female', 'male', 'neutral')),
  primary_language TEXT NOT NULL DEFAULT 'english' CHECK (primary_language IN ('english', 'hindi', 'telugu')),
  description      TEXT,
  sample_text      TEXT,                               -- the line previews speak by default
  cloned           BOOLEAN NOT NULL DEFAULT true,      -- true = created via Clone Lab; false = manually pinned provider voice
  consent_confirmed BOOLEAN NOT NULL DEFAULT false,    -- DPDP 2023: voice owner consent declared at clone time
  consent_note     TEXT,                               -- free-text basis, e.g. "own voice" / "written consent on file"
  consent_by       TEXT,                               -- email of the person who declared consent
  created_by       TEXT,                               -- email of the operator who created the row
  is_active        BOOLEAN NOT NULL DEFAULT true,      -- soft delete — provider-side delete is best-effort
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, voice_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_voices_provider ON custom_voices (provider);
CREATE INDEX IF NOT EXISTS idx_custom_voices_org      ON custom_voices (org_id);
