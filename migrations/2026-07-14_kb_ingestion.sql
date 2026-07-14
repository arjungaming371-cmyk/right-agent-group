-- Knowledge base ingestion — CSV bulk-import, PDF upload (chunked), and
-- URL fetch (with re-fetch/"refresh" support). Adds provenance tracking so
-- the dashboard can show where an entry came from and re-fetch URL-sourced
-- entries without duplicating them.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-14_kb_ingestion.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-14_kb_ingestion_rollback.sql

ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual'
  CHECK (source_type IN ('manual', 'csv', 'pdf', 'url'));
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_filename TEXT;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS last_fetched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kb_source_url ON knowledge_base (source_url) WHERE source_url IS NOT NULL;
