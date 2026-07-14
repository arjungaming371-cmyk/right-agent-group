-- Rollback for migrations/2026-07-14_compliance.sql
-- Apply: psql -U postgres -d right_agent_group -f migrations/2026-07-14_compliance_rollback.sql

DROP TABLE IF EXISTS dnd_suppression;
DROP TABLE IF EXISTS compliance_settings;
