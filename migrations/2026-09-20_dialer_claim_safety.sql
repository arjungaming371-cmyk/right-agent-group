-- 2026-09-20 — Atomic dialer claiming (concurrency fix for /api/outbound/process).
--
-- The outbound dialer previously did SELECT pending → dial → mark called.
-- Two concurrent triggers (dashboard click + cron, or a double-click) could
-- read the SAME pending rows and dial real customers twice. The dialer now
-- claims rows atomically (FOR UPDATE SKIP LOCKED, status='dialing'); this
-- column timestamps the claim so a crashed worker's rows are automatically
-- reclaimed after 15 minutes.
--
-- Rollback: migrations/2026-09-20_dialer_claim_safety_rollback.sql

ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
