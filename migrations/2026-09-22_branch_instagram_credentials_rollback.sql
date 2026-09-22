-- Rollback of 2026-09-22_branch_instagram_credentials.sql
-- (instagram_account_id was originally added by 2026-09-20_security_hardening;
-- dropping it here too restores that pre-state for both columns.)

ALTER TABLE branches DROP COLUMN IF NOT EXISTS instagram_token;
ALTER TABLE branches DROP COLUMN IF NOT EXISTS instagram_account_id;
