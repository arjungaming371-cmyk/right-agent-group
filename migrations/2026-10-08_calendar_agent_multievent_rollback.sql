-- Rollback Migration: 2026-10-08_calendar_agent_multievent_rollback.sql

DROP INDEX IF EXISTS uq_calendar_event_source;

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_event_source 
  ON calendar_events (source_type, source_id, event_type);

ALTER TABLE calendar_events 
  DROP COLUMN IF EXISTS original_event_at;
