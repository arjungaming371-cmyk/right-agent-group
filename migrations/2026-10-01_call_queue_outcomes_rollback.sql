-- Rollback of 2026-10-01_call_queue_outcomes.sql
DROP INDEX IF EXISTS idx_outbound_queue_called_outcome;
ALTER TABLE outbound_queue DROP COLUMN IF EXISTS outcome_detail;
ALTER TABLE outbound_queue DROP COLUMN IF EXISTS outcome_at;
ALTER TABLE outbound_queue DROP COLUMN IF EXISTS outcome;
