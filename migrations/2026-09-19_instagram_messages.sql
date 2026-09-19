-- Migration: 2026-09-19_instagram_messages.sql
-- Create table for Instagram Direct Messages (DMs) and Post Comments

ALTER TABLE leads ADD COLUMN IF NOT EXISTS instagram_handle TEXT;

CREATE TABLE IF NOT EXISTS instagram_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  ig_user_id    TEXT NOT NULL,
  ig_username   TEXT,
  direction     TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  type          TEXT NOT NULL DEFAULT 'dm' CHECK (type IN ('dm', 'comment')),
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  ig_message_id TEXT UNIQUE,
  comment_id    TEXT,
  media_id      TEXT,
  branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instagram_messages_lead_id ON instagram_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_instagram_messages_ig_user_id ON instagram_messages(ig_user_id);
CREATE INDEX IF NOT EXISTS idx_instagram_messages_branch_id ON instagram_messages(branch_id);
CREATE INDEX IF NOT EXISTS idx_instagram_messages_created_at ON instagram_messages(created_at DESC);
