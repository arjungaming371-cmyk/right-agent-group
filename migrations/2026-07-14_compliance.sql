-- Regulatory compliance guardrails for outbound calling — calling-window
-- enforcement (TRAI TCCCPR / RBI Fair Practices Code) and a DND/opt-out
-- suppression list.
--
-- IMPORTANT: this does NOT give live access to TRAI's National Customer
-- Preference Register (NCPR) — that requires registering as a Registered
-- Telemarketer (RTM) on a telecom operator's DLT platform, a real business
-- and legal registration step outside the scope of application code.
-- dnd_suppression is a suppression list YOU control: numbers added manually,
-- CSV-uploaded (e.g. from an NCPR extract once registered), or auto-added
-- whenever a lead's Lead Brain stage becomes do_not_call.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-14_compliance.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-14_compliance_rollback.sql

CREATE TABLE IF NOT EXISTS compliance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
-- Defaults follow RBI's stricter 8am-7pm window (not TRAI's more permissive
-- 9am-9pm) since this is a lending business — verify against your own
-- compliance advisor and adjust from the dashboard if a different window
-- applies to your specific registration (NBFC-linked digital lender vs.
-- pure lead-generation telemarketer are NOT the same regulatory bucket).
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
