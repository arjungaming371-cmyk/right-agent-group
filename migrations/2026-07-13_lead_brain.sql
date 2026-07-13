-- Lead Brain — persistent, structured, self-updating memory per lead.
-- Forward migration. Idempotent (safe to re-run) — mirrors the pattern
-- already used throughout local-setup.sql (CREATE IF NOT EXISTS / ADD
-- COLUMN IF NOT EXISTS), so this file is ALSO appended verbatim into
-- local-setup.sql for fresh `npm run db:setup` runs.
--
-- Apply:   psql -U postgres -d right_agent_group -f migrations/2026-07-13_lead_brain.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-13_lead_brain_rollback.sql

-- ============================================================
-- lead_memory — one row per lead, the structured "brain"
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_memory (
  lead_id            UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  facts              JSONB NOT NULL DEFAULT '{}',
  -- Keys inside `facts` that a human has manually edited — the extraction
  -- pipeline merges new facts in but NEVER overwrites a locked key.
  locked_facts       TEXT[] NOT NULL DEFAULT '{}',
  summary            TEXT NOT NULL DEFAULT '',
  sentiment          TEXT NOT NULL DEFAULT 'neutral'
                        CHECK (sentiment IN ('positive', 'neutral', 'frustrated', 'hostile')),
  -- Append-only log: [{ "sentiment": "frustrated", "at": "2026-07-13T10:00:00Z" }, ...]
  sentiment_history  JSONB NOT NULL DEFAULT '[]',
  stage              TEXT NOT NULL DEFAULT 'new'
                        CHECK (stage IN ('new', 'contacted', 'interested', 'docs_pending',
                                          'negotiating', 'converted', 'lost', 'do_not_call')),
  last_analysis_at   TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_memory_stage ON lead_memory (stage);

-- ============================================================
-- lead_interactions — unified cross-channel timeline
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_interactions (
  id                BIGSERIAL PRIMARY KEY,
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL CHECK (channel IN ('voice', 'whatsapp', 'manual')),
  direction         TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- voice_calls.id (uuid) or whatsapp_messages.id (bigint) as text — the
  -- source row this timeline entry summarizes. NULL for manual notes.
  ref_id            TEXT,
  one_line_summary  TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One timeline entry per source row — lets the backfill AND the live
  -- pipeline both use ON CONFLICT DO NOTHING without duplicating history.
  CONSTRAINT uq_lead_interactions_source UNIQUE (channel, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead ON lead_interactions (lead_id, occurred_at DESC);

-- ============================================================
-- Backfill from existing history — safe to re-run, ON CONFLICT DO NOTHING
-- ============================================================
INSERT INTO lead_interactions (lead_id, channel, direction, occurred_at, ref_id, one_line_summary)
SELECT
  vc.lead_id,
  'voice',
  CASE WHEN vc.direction = 'inbound' THEN 'in' ELSE 'out' END,
  vc.created_at,
  vc.id::text,
  COALESCE(NULLIF(left(vc.ai_summary, 140), ''), 'Call — ' || vc.outcome || ', ' || vc.duration || 's')
FROM voice_calls vc
WHERE vc.lead_id IS NOT NULL
ON CONFLICT (channel, ref_id) DO NOTHING;

INSERT INTO lead_interactions (lead_id, channel, direction, occurred_at, ref_id, one_line_summary)
SELECT
  wm.lead_id,
  'whatsapp',
  CASE WHEN wm.direction = 'inbound' THEN 'in' ELSE 'out' END,
  wm.created_at,
  wm.id::text,
  left(wm.content, 140)
FROM whatsapp_messages wm
WHERE wm.lead_id IS NOT NULL
ON CONFLICT (channel, ref_id) DO NOTHING;
