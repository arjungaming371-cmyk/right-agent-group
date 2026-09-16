-- Rollback for 2026-07-20_lead_pinning.sql

DROP INDEX IF EXISTS idx_leads_pinned;
ALTER TABLE leads DROP COLUMN IF EXISTS pinned_at;
ALTER TABLE leads DROP COLUMN IF EXISTS pinned;
