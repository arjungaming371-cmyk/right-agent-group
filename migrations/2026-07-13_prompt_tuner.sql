-- Prompt Tuner — background job that reads recent call outcomes and proposes
-- small, human-reviewed script improvements. Nothing here ever auto-edits
-- ai_scripts; every suggestion sits in "pending" until an admin approves it.
--
-- Apply:   psql -U postgres -d right_agent_group -f migrations/2026-07-13_prompt_tuner.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-13_prompt_tuner_rollback.sql

CREATE TABLE IF NOT EXISTS prompt_suggestions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          TEXT NOT NULL DEFAULT 'both' CHECK (channel IN ('voice', 'whatsapp', 'both')),
  short_guideline  TEXT NOT NULL,
  situation        TEXT NOT NULL,
  risk             TEXT NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
  source_summary   TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  applied_to       TEXT[] NOT NULL DEFAULT '{}',
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prompt_suggestions_status ON prompt_suggestions (status, created_at DESC);
