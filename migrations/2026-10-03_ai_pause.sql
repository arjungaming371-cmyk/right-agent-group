-- AI KILL SWITCH storage.
-- Uses the existing generic JSONB config store (form_configs, created by
-- 2026-09-16_admin_customizations.sql). This migration only ensures the
-- store exists and seeds the switch row so operators can see it in the DB.
--
-- Absent/empty row = automation RUNNING. The app tolerates a missing row.

CREATE TABLE IF NOT EXISTS form_configs (
  id TEXT PRIMARY KEY,
  config JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO form_configs (id, config)
VALUES (
  'ai_pause',
  '{"calls":{"paused":false},"messages":{"paused":false},"branches":{}}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
