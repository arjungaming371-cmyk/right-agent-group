-- Rollback of 2026-10-05_perf_indexes.sql
DROP INDEX IF EXISTS idx_comm_logs_created;
DROP INDEX IF EXISTS idx_comm_logs_alerts_needs_human;
DROP INDEX IF EXISTS idx_outbound_queue_call_sid;
DROP INDEX IF EXISTS idx_outbound_queue_dialing_claimed;
