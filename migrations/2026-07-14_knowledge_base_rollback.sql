-- Rollback for migrations/2026-07-14_knowledge_base.sql
-- Apply: psql -U postgres -d right_agent_group -f migrations/2026-07-14_knowledge_base_rollback.sql

DROP TABLE IF EXISTS knowledge_base;
