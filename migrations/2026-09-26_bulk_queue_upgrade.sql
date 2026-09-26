-- 2026-09-26 — Bulk calling queue upgrade (dual-channel, priority, cancel,
-- auto-retry). Companion to the "Outbound Bulk Calling & Queue Management"
-- plan; every statement is idempotent.
--
--  channel       'phone' (Exotel) | 'whatsapp_voice' (Meta Cloud API WebRTC)
--  priority      higher = dialed first within due rows (claim ORDER BY)
--  cancelled_*   soft-cancel audit trail (the dialer never claims them)
--  retry_count   auto-redial bookkeeping (busy/no-answer re-queue, cap 2)

ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS channel     TEXT NOT NULL DEFAULT 'phone';
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS priority    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- Atomic-claim path: priority-first, oldest-scheduled-first, pending only.
-- (The rare stuck-'dialing' reaper leg can't use a 'pending'-only partial
-- index — it is tiny and fine without one.)
CREATE INDEX IF NOT EXISTS idx_outbound_queue_claim
  ON outbound_queue (branch_id, status, priority DESC, scheduled_at ASC)
  WHERE status = 'pending';

-- Anti-duplicate stacking, race-proof: a number may exist at most ONCE in an
-- active (pending/dialing) state. check-then-insert alone loses under
-- concurrent inserts; the unique index is the real guard. Historical rows
-- (called/failed/skipped) are untouched. Clean up pre-existing stacked
-- actives first — keep the OLDEST row (it owns the campaign position),
-- soft-cancel the newer duplicates so the audit trail survives.
UPDATE outbound_queue
   SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'migration:dedupe'
 WHERE status = 'pending'
   AND id NOT IN (
     SELECT MIN(id) FROM outbound_queue
      WHERE status IN ('pending', 'dialing')
      GROUP BY right(regexp_replace(phone, '\D', '', 'g'), 10)
   );

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_queue_active_phone
  ON outbound_queue (right(regexp_replace(phone, '\D', '', 'g'), 10))
  WHERE status IN ('pending', 'dialing');

-- Dialer runtime settings (concurrency slider, auto-retry policy). Created
-- here for db:check; lib/dialer-settings.ts also creates it lazily so a
-- missed migration can never hard-fail the dialer.
CREATE TABLE IF NOT EXISTS dialer_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
