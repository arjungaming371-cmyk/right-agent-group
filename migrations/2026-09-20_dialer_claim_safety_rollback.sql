-- Rollback of 2026-09-20_dialer_claim_safety.sql
ALTER TABLE outbound_queue DROP COLUMN IF EXISTS claimed_at;
