-- Knowledge base — grounds Priya's answers to arbitrary caller/chat
-- questions (loan documents needed, minimum amounts, eligibility, etc.)
-- instead of only what's in the static script or a lead's own facts.
--
-- Deliberately reuses the SAME Postgres full-text search pattern already
-- built for leads/loan_applications (setweight + tsvector + GIN) instead
-- of adding a vector DB / embeddings dependency — this app has zero
-- existing vector infrastructure, and keyword FTS is plenty for a few
-- hundred FAQ/policy entries at call-turn latency budgets.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-14_knowledge_base.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-14_knowledge_base_rollback.sql

CREATE TABLE IF NOT EXISTS knowledge_base (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  category    TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_kb_search ON knowledge_base USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_kb_active ON knowledge_base (is_active);
