-- Rollback for migrations/2026-07-13_prompt_tuner.sql
-- Apply: psql -U postgres -d right_agent_group -f migrations/2026-07-13_prompt_tuner_rollback.sql

DROP TABLE IF EXISTS prompt_suggestions;
