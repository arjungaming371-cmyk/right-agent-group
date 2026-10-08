-- Migration: 2026-10-08_calendar_agent_multievent.sql
-- Enables multiple legitimate appointments of the same type within a single conversation
-- while preserving strict idempotency, reschedule provenance, and historical re-scan immunity.

ALTER TABLE calendar_events 
  ADD COLUMN IF NOT EXISTS original_event_at TIMESTAMPTZ;

-- Backfill original_event_at from event_at for existing rows
UPDATE calendar_events 
  SET original_event_at = event_at 
  WHERE original_event_at IS NULL;

ALTER TABLE calendar_events 
  ALTER COLUMN original_event_at SET NOT NULL;

-- Upgrade unique index to incorporate original_event_at
DROP INDEX IF EXISTS uq_calendar_event_source;

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_event_source 
  ON calendar_events (source_type, source_id, event_type, original_event_at);
