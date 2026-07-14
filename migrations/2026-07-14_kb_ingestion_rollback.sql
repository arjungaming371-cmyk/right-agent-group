-- Rollback for migrations/2026-07-14_kb_ingestion.sql
-- Apply: psql -U postgres -d right_agent_group -f migrations/2026-07-14_kb_ingestion_rollback.sql

DROP INDEX IF EXISTS idx_kb_source_url;
ALTER TABLE knowledge_base DROP COLUMN IF EXISTS last_fetched_at;
ALTER TABLE knowledge_base DROP COLUMN IF EXISTS source_filename;
ALTER TABLE knowledge_base DROP COLUMN IF EXISTS source_url;
ALTER TABLE knowledge_base DROP COLUMN IF EXISTS source_type;
