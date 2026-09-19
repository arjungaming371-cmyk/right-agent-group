-- Migration: 2026-09-19_system_api_keys.sql
-- Create tables for website-managed system API keys & token usage logging

CREATE TABLE IF NOT EXISTS system_api_keys (
  key_name    TEXT PRIMARY KEY,
  key_value   TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_usage_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       TEXT NOT NULL, -- 'groq', 'sarvam', 'whatsapp', 'instagram', 'cartesia', 'exotel'
  tokens_used    INT NOT NULL DEFAULT 0,
  cost_estimate  NUMERIC(10, 4) DEFAULT 0,
  details        JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_logs_provider ON api_usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_created_at ON api_usage_logs(created_at DESC);
