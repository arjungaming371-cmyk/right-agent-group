-- Rollback for 2026-07-31_lead_code.sql
--
-- Destructive: dropping the column discards every assigned code, so any
-- code a customer or staff member wrote down stops resolving. Re-applying
-- the migration renumbers from RAG-0001 in created_at order, which will
-- NOT reproduce the old codes if any leads were deleted in between.
--
-- Apply: psql -U postgres -d right_agent_group -f migrations/2026-07-31_lead_code_rollback.sql

DROP INDEX IF EXISTS idx_leads_lead_code;

ALTER TABLE leads DROP COLUMN IF EXISTS lead_code;

DROP SEQUENCE IF EXISTS lead_code_seq;
