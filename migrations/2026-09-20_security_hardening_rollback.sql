-- Rollback of migrations/2026-09-20_security_hardening.sql
-- WARNING: drops session revocation, form-link TTLs and digest idempotency.
-- (Instagram comment dedupe, dialer claimed_at and the dashboard unread
-- indexes are rolled back by their own separate rollback files.)

DROP TABLE IF EXISTS digest_sent_log;
DROP INDEX IF EXISTS idx_leads_ig_user_id;
ALTER TABLE branches DROP COLUMN IF EXISTS instagram_account_id;
ALTER TABLE leads DROP COLUMN IF EXISTS ig_user_id;
DROP INDEX IF EXISTS idx_outbound_claim;
DROP INDEX IF EXISTS idx_form_links_expires;
ALTER TABLE form_links DROP COLUMN IF EXISTS expires_at;
ALTER TABLE allowed_emails DROP COLUMN IF EXISTS session_epoch;
