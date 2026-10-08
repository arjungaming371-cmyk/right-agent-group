-- 2026-10-08 — Autonomous Calendar Agent Schema.
--
-- Discovers appointments, branch visits, callbacks, document deadlines,
-- and follow-ups across Voice Calls, WhatsApp, Call Queue, and Leads CRM.
--
-- Enforces:
--   1. Confidence grading: 'high' -> auto-confirmed, 'medium'/'low' -> 'needs_review'
--   2. Event categorization: branch_visit (in-person, never auto-dials),
--      callback (scheduled phone/voice, links with outbound_queue),
--      document_deadline (WhatsApp reminder eligible), reminder.
--   3. Idempotency: unique constraint prevents duplicate events on repeated scans.
--   4. Bidirectional sync with outbound_queue via outbound_queue_id.

CREATE TABLE IF NOT EXISTS calendar_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  event_type          TEXT NOT NULL CHECK (event_type IN ('branch_visit', 'callback', 'document_deadline', 'reminder')),
  event_at            TIMESTAMPTZ NOT NULL,
  end_at              TIMESTAMPTZ,
  location            TEXT,
  channel             TEXT NOT NULL DEFAULT 'phone' CHECK (channel IN ('in_person', 'phone', 'whatsapp_voice', 'whatsapp_text')),
  confidence          TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high', 'medium', 'low')),
  confidence_score    NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  status              TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'needs_review', 'completed', 'rescheduled', 'cancelled')),
  review_reason       TEXT,
  raw_quote           TEXT,
  source_type         TEXT NOT NULL CHECK (source_type IN ('voice_call', 'whatsapp_message', 'outbound_queue', 'leads_crm', 'manual')),
  source_id           TEXT,
  source_at           TIMESTAMPTZ NOT NULL,
  outbound_queue_id   UUID REFERENCES outbound_queue(id) ON DELETE SET NULL,
  branch_id           UUID REFERENCES branches(id) ON DELETE SET NULL,
  notes               TEXT,
  reminder_enabled    BOOLEAN NOT NULL DEFAULT true,
  reminder_status     TEXT DEFAULT 'pending' CHECK (reminder_status IN ('pending', 'sent', 'failed', 'skipped', 'opt_out')),
  reminder_sent_at    TIMESTAMPTZ,
  reminder_error      TEXT,
  created_by          TEXT DEFAULT 'ai_calendar_agent',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency guarantee: same source cannot generate the same event_type twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_event_source 
  ON calendar_events (source_type, source_id, event_type);

-- Fast temporal queries for Calendar View month/week windows
CREATE INDEX IF NOT EXISTS idx_calendar_events_event_at 
  ON calendar_events (event_at ASC);

-- Fast review queue lookup
CREATE INDEX IF NOT EXISTS idx_calendar_events_status 
  ON calendar_events (status);

-- Lead relationship lookup
CREATE INDEX IF NOT EXISTS idx_calendar_events_lead_id 
  ON calendar_events (lead_id);

-- Branch isolation
CREATE INDEX IF NOT EXISTS idx_calendar_events_branch 
  ON calendar_events (branch_id, event_at ASC);

-- Queue bidirectional linkage
CREATE INDEX IF NOT EXISTS idx_calendar_events_queue_id 
  ON calendar_events (outbound_queue_id);

-- Audit log for extraction scans and dry-runs
CREATE TABLE IF NOT EXISTS calendar_scans (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_type                TEXT NOT NULL,
  dry_run                  BOOLEAN NOT NULL DEFAULT false,
  records_scanned          INT NOT NULL DEFAULT 0,
  events_discovered        INT NOT NULL DEFAULT 0,
  events_auto_confirmed    INT NOT NULL DEFAULT 0,
  events_needs_review      INT NOT NULL DEFAULT 0,
  events_skipped_duplicate INT NOT NULL DEFAULT 0,
  details                  JSONB,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ,
  created_by               TEXT
);
