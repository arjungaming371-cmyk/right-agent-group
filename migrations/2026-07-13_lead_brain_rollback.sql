-- Rollback for migrations/2026-07-13_lead_brain.sql
-- Drops both new tables. Does NOT touch leads/voice_calls/whatsapp_messages —
-- this feature only ever reads those, never alters them.
--
-- Apply: psql -U postgres -d right_agent_group -f migrations/2026-07-13_lead_brain_rollback.sql

DROP TABLE IF EXISTS lead_interactions;
DROP TABLE IF EXISTS lead_memory;
