-- 2026-10-01 — Call Queue outcome feedback loop.
--
-- THE GAP: outbound_queue.status='called' has always meant "we DIALED this
-- row", never "someone answered". The real result (answered / no-answer /
-- busy / declined / carrier-failed) landed only on the voice_calls row via
-- the terminal webhooks (Exotel /api/calls/status, Meta calls terminate) —
-- the queue row stayed blind, so the Campaign Radar's "completed" counter
-- silently mixed answered with never-picked-up and operators had to
-- cross-reference Voice Logs to know how a campaign actually went.
--
-- This migration gives the queue row its own outcome columns, stamped by
-- lib/queue-outcome.ts from BOTH terminal paths, plus a one-shot backfill
-- so existing campaigns light up immediately.
--
--   outcome         resolved | missed | rejected | failed   (the funnel
--                   vocabulary voice_calls.outcome already uses)
--   outcome_at      when the terminal webhook landed
--   outcome_detail  the raw provider status / rejection reason
--                   (Meta's verbatim connect error, Exotel CallStatus, …)

ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS outcome        TEXT;
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS outcome_at     TIMESTAMPTZ;
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS outcome_detail TEXT;

-- Backfill: stamp outcomes onto rows that already dialed. Only rows still
-- in the dialable-history state 'called' are touched — skipped/cancelled/
-- failed rows have their own meaning and stay untouched.
UPDATE outbound_queue q
   SET outcome        = v.outcome,
       outcome_at     = v.updated_at,
       outcome_detail = v.status
  FROM voice_calls v
 WHERE q.call_sid = v.twilio_call_sid
   AND q.status = 'called'
   AND q.outcome IS NULL
   AND v.outcome IS NOT NULL;

-- The radar groups 'called' rows by outcome on every poll (GET
-- /api/outbound/process) — a partial index keeps it free.
CREATE INDEX IF NOT EXISTS idx_outbound_queue_called_outcome
  ON outbound_queue (branch_id, outcome)
  WHERE status = 'called';
