-- Rollback for 2026-07-25_callback_scheduling.sql

DROP INDEX IF EXISTS idx_leads_callback_at;
ALTER TABLE leads DROP COLUMN IF EXISTS callback_note;
ALTER TABLE leads DROP COLUMN IF EXISTS callback_at;
