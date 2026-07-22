-- Right Agent Group — Master Database Setup
-- Run ONCE on a fresh PostgreSQL database:
--   psql -U postgres -d right_agent_group -f local-setup.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Leads (every person Priya has spoken to or will speak to)
CREATE TABLE IF NOT EXISTS leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT,
  phone             TEXT,
  address           TEXT,
  whatsapp_number   TEXT,
  email             TEXT,
  product_interest  TEXT,
  loan_amount       NUMERIC,
  notes             TEXT,
  form_completed    BOOLEAN DEFAULT false,
  status            TEXT DEFAULT 'new',
  interested        TEXT DEFAULT 'unknown',
  score             INTEGER DEFAULT 0,
  language          TEXT DEFAULT 'telugu',
  source            TEXT DEFAULT 'manual',
  call_count        INTEGER DEFAULT 0,
  last_called_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_phone  ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

-- Full-text search (name/product/address weighted above notes) — phone search
-- still uses ILIKE at the query layer since digits don't tokenize usefully.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(address, '') || ' ' || coalesce(product_interest, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'C')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_leads_search ON leads USING GIN (search_vector);

-- Voice calls (every call Priya makes or receives)
CREATE TABLE IF NOT EXISTS voice_calls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_call_sid  TEXT UNIQUE,
  lead_id          UUID REFERENCES leads(id),
  phone            TEXT,
  direction        TEXT DEFAULT 'outbound',
  status           TEXT DEFAULT 'initiated',
  language         TEXT DEFAULT 'telugu',
  duration         INTEGER DEFAULT 0,
  outcome          TEXT DEFAULT 'pending',
  sentiment        TEXT DEFAULT 'Neutral',
  ai_summary       TEXT,
  transcript       JSONB DEFAULT '[]',
  recording_url    TEXT,
  followup_sent    BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calls_lead ON voice_calls (lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_sid  ON voice_calls (twilio_call_sid);

-- Loan applications (submitted via the WhatsApp form link)
CREATE TABLE IF NOT EXISTS loan_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID REFERENCES leads(id),
  full_name       TEXT,
  customer_name   TEXT,
  phone           TEXT,
  city            TEXT,
  email           TEXT,
  whatsapp_number TEXT,
  address         TEXT,
  loan_type       TEXT,
  loan_amount     NUMERIC,
  monthly_income  NUMERIC,
  employment_type TEXT,
  pan_number      TEXT,
  form_data       JSONB,
  status          TEXT DEFAULT 'pending',
  submitted_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(customer_name, '') || ' ' || coalesce(full_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(city, '') || ' ' || coalesce(loan_type, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(address, '') || ' ' || coalesce(employment_type, '')), 'C')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_loan_apps_search ON loan_applications USING GIN (search_vector);

-- One-time form links (sent via WhatsApp after a successful call)
CREATE TABLE IF NOT EXISTS form_links (
  token      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID REFERENCES leads(id),
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- WhatsApp messages (every message sent or received)
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id             BIGSERIAL PRIMARY KEY,
  lead_id        UUID REFERENCES leads(id),
  wa_message_id  TEXT,
  phone_number   TEXT,
  direction      TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
  content        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_lead  ON whatsapp_messages (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_phone ON whatsapp_messages (phone_number, created_at DESC);

-- AI conversations (WhatsApp chat history for AI context)
CREATE TABLE IF NOT EXISTS ai_conversations (
  id         BIGSERIAL PRIMARY KEY,
  lead_id    UUID REFERENCES leads(id),
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  language   TEXT DEFAULT 'english',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_lead ON ai_conversations (lead_id, created_at ASC);

-- Communication log (summary of all outreach activity)
CREATE TABLE IF NOT EXISTS comm_logs (
  id         BIGSERIAL PRIMARY KEY,
  lead_id    UUID REFERENCES leads(id),
  type       TEXT,
  summary    TEXT,
  outcome    TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Outbound call queue (bulk calling campaigns)
CREATE TABLE IF NOT EXISTS outbound_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID REFERENCES leads(id),
  name             TEXT,
  phone            TEXT NOT NULL,
  language         TEXT DEFAULT 'english',
  product_interest TEXT,
  notes            TEXT,
  status           TEXT DEFAULT 'pending',
  call_sid         TEXT,
  scheduled_at TIMESTAMPTZ DEFAULT now(),
  called_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Security settings and audit log
CREATE TABLE IF NOT EXISTS security_settings (
  key        TEXT PRIMARY KEY,
  enabled    BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  action       TEXT NOT NULL,
  performed_by TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Insert default security settings
INSERT INTO security_settings (key, enabled) VALUES
  ('two_factor_auth', false),
  ('single_sign_on', false),
  ('ip_allowlist', false),
  ('call_recording_encryption', false)
ON CONFLICT (key) DO NOTHING;

-- Allowed Gmail accounts for login
CREATE TABLE IF NOT EXISTS allowed_emails (
  email      TEXT PRIMARY KEY,
  added_by   TEXT,
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Migration for databases created before the role column existed.
ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'agent';
DO $$ BEGIN
  ALTER TABLE allowed_emails ADD CONSTRAINT allowed_emails_role_check CHECK (role IN ('admin', 'agent', 'viewer'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Internal Ops Assistant — persistent chat history, one thread per staff member.
CREATE TABLE IF NOT EXISTS assistant_chats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_chats_user ON assistant_chats (user_email, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id         BIGSERIAL PRIMARY KEY,
  chat_id    UUID NOT NULL REFERENCES assistant_chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_chat ON assistant_messages (chat_id, created_at ASC);

-- Real-time dashboard notifications (loan applications, escalations, logins, new WhatsApp contacts)
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL CHECK (type IN ('loan_application', 'escalation', 'login', 'whatsapp_message')),
  title      TEXT NOT NULL,
  body       TEXT,
  link_view  TEXT,
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read    ON notifications (read);

-- Uploaded lead files
CREATE TABLE IF NOT EXISTS uploaded_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    TEXT,
  file_path   TEXT,
  type        TEXT DEFAULT 'contacts',
  row_count   INTEGER DEFAULT 0,
  processed   INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'pending',
  uploaded_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- MIGRATION SAFETY NET
-- If you already created the database with an older version of
-- this file, these lines add the missing columns in place.
-- Safe to re-run any number of times.
-- ============================================================
ALTER TABLE leads          ADD COLUMN IF NOT EXISTS notes            TEXT;
ALTER TABLE leads          ADD COLUMN IF NOT EXISTS form_completed   BOOLEAN DEFAULT false;
ALTER TABLE voice_calls    ADD COLUMN IF NOT EXISTS ai_summary       TEXT;
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS lead_id          UUID REFERENCES leads(id);
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS product_interest TEXT;
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS notes            TEXT;
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS type             TEXT DEFAULT 'contacts';
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS processed        INTEGER DEFAULT 0;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS customer_name   TEXT;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS city            TEXT;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS email           TEXT;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS form_data       JSONB;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS full_name       TEXT;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS phone           TEXT;
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS pan_number      TEXT;
ALTER TABLE voice_calls    ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT now();
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS call_sid         TEXT;
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS called_at        TIMESTAMPTZ;
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS file_path        TEXT;
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS uploaded_by      TEXT;
ALTER TABLE voice_calls    ADD COLUMN IF NOT EXISTS followup_sent    BOOLEAN DEFAULT false;
ALTER TABLE leads          ADD COLUMN IF NOT EXISTS score            INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_queue_lead   ON outbound_queue (lead_id);
CREATE INDEX IF NOT EXISTS idx_queue_status ON outbound_queue (status);

-- AI call scripts (client-editable via dashboard Script Manager).
-- Also created lazily by /api/script, but defined here so a fresh
-- db:setup provisions everything and db:check can verify it.
CREATE TABLE IF NOT EXISTS ai_scripts (
  id         SERIAL PRIMARY KEY,
  language   TEXT NOT NULL UNIQUE,
  content    TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT DEFAULT 'admin'
);

-- ============================================================
-- Lead Brain — persistent, structured, self-updating memory per lead.
-- See migrations/2026-07-13_lead_brain.sql (this block mirrors it so a
-- fresh db:setup provisions it too; rollback lives in the same folder).
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_memory (
  lead_id            UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  facts              JSONB NOT NULL DEFAULT '{}',
  locked_facts       TEXT[] NOT NULL DEFAULT '{}',
  summary            TEXT NOT NULL DEFAULT '',
  sentiment          TEXT NOT NULL DEFAULT 'neutral'
                        CHECK (sentiment IN ('positive', 'neutral', 'frustrated', 'hostile')),
  sentiment_history  JSONB NOT NULL DEFAULT '[]',
  stage              TEXT NOT NULL DEFAULT 'new'
                        CHECK (stage IN ('new', 'contacted', 'interested', 'docs_pending',
                                          'negotiating', 'converted', 'lost', 'do_not_call')),
  last_analysis_at   TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_memory_stage ON lead_memory (stage);

CREATE TABLE IF NOT EXISTS lead_interactions (
  id                BIGSERIAL PRIMARY KEY,
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL CHECK (channel IN ('voice', 'whatsapp', 'manual')),
  direction         TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ref_id            TEXT,
  one_line_summary  TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_lead_interactions_source UNIQUE (channel, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead ON lead_interactions (lead_id, occurred_at DESC);

INSERT INTO lead_interactions (lead_id, channel, direction, occurred_at, ref_id, one_line_summary)
SELECT
  vc.lead_id, 'voice',
  CASE WHEN vc.direction = 'inbound' THEN 'in' ELSE 'out' END,
  vc.created_at, vc.id::text,
  COALESCE(NULLIF(left(vc.ai_summary, 140), ''), 'Call — ' || vc.outcome || ', ' || vc.duration || 's')
FROM voice_calls vc
WHERE vc.lead_id IS NOT NULL
ON CONFLICT (channel, ref_id) DO NOTHING;

INSERT INTO lead_interactions (lead_id, channel, direction, occurred_at, ref_id, one_line_summary)
SELECT
  wm.lead_id, 'whatsapp',
  CASE WHEN wm.direction = 'inbound' THEN 'in' ELSE 'out' END,
  wm.created_at, wm.id::text, left(wm.content, 140)
FROM whatsapp_messages wm
WHERE wm.lead_id IS NOT NULL
ON CONFLICT (channel, ref_id) DO NOTHING;

-- ============================================================
-- Prompt Tuner — background-generated script improvement suggestions,
-- always human-reviewed before touching ai_scripts. See
-- migrations/2026-07-13_prompt_tuner.sql (rollback in the same folder).
-- ============================================================
CREATE TABLE IF NOT EXISTS prompt_suggestions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          TEXT NOT NULL DEFAULT 'both' CHECK (channel IN ('voice', 'whatsapp', 'both')),
  short_guideline  TEXT NOT NULL,
  situation        TEXT NOT NULL,
  risk             TEXT NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
  source_summary   TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  applied_to       TEXT[] NOT NULL DEFAULT '{}',
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prompt_suggestions_status ON prompt_suggestions (status, created_at DESC);

-- ============================================================
-- Regulatory compliance guardrails — calling-window enforcement
-- (TRAI TCCCPR / RBI Fair Practices Code) + DND/opt-out suppression list.
-- See migrations/2026-07-14_compliance.sql (rollback in the same folder).
-- NOTE: dnd_suppression is a list YOU control, not a live NCPR sync —
-- real NCPR access requires RTM/DLT registration, a business step.
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
INSERT INTO compliance_settings (key, value) VALUES
  ('calling_window_enabled', 'true'),
  ('calling_window_start_hour', '8'),
  ('calling_window_end_hour', '19'),
  ('calling_window_days', 'mon,tue,wed,thu,fri,sat')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS dnd_suppression (
  phone      TEXT PRIMARY KEY,
  reason     TEXT,
  source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv_upload', 'lead_do_not_call')),
  added_by   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Knowledge base — grounds Priya's answers to arbitrary questions via the
-- same Postgres full-text search pattern already used for leads/loan_apps.
-- See migrations/2026-07-14_knowledge_base.sql (rollback in the same folder).
-- ============================================================
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

-- Ingestion provenance — CSV bulk-import, PDF upload (chunked), URL fetch
-- with refresh support. See migrations/2026-07-14_kb_ingestion.sql.
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual'
  CHECK (source_type IN ('manual', 'csv', 'pdf', 'url'));
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_filename TEXT;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS last_fetched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_kb_source_url ON knowledge_base (source_url) WHERE source_url IS NOT NULL;
