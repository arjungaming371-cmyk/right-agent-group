-- Rollback of 2026-09-20_dashboard_perf_indexes.sql
DROP INDEX IF EXISTS idx_wa_messages_unread;
DROP INDEX IF EXISTS idx_ig_messages_unread;
