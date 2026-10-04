-- Performance indexes (2026-10-05 production pass).
-- Additive only — CREATE INDEX IF NOT EXISTS, no data changes, safe to re-run.
-- Rollback: drop the same four indexes (see 2026-10-05_perf_indexes_rollback.sql).

-- 1) Communication Log HQ feed: app/api/comms reads the newest 200 rows
--    ordered by created_at DESC on every dashboard poll, and escalations/digest
--    scan alerts by time. Only a (lead_id, created_at) index existed, so every
--    HQ poll was a full sort over an unbounded table.
CREATE INDEX IF NOT EXISTS idx_comm_logs_created
  ON comm_logs (created_at DESC);

-- 2) Needs-human escalation lane (Attention view): partial index matched to
--    the exact predicate comms/escalations filter on.
CREATE INDEX IF NOT EXISTS idx_comm_logs_alerts_needs_human
  ON comm_logs (created_at DESC)
  WHERE type = 'alert' AND outcome = 'needs_human';

-- 3) Queue outcome stamping: lib/queue-outcome runs
--    UPDATE outbound_queue WHERE call_sid = $1 on EVERY terminal call
--    webhook — previously a sequential scan over the whole queue table.
CREATE INDEX IF NOT EXISTS idx_outbound_queue_call_sid
  ON outbound_queue (call_sid)
  WHERE call_sid IS NOT NULL;

-- 4) Stuck-row reaper: the claim query's OR leg
--    (status = 'dialing' AND claimed_at < now() - interval) defeated the
--    pending-only partial claim index; this partial index serves that leg.
CREATE INDEX IF NOT EXISTS idx_outbound_queue_dialing_claimed
  ON outbound_queue (claimed_at)
  WHERE status = 'dialing';
