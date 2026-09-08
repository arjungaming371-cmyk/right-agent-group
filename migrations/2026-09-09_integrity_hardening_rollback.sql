-- Rollback of migrations/2026-09-09_integrity_hardening.sql
-- Note: rows whose duplicate wa_message_id was NULLed by the forward
-- migration cannot be restored — the message content is untouched, only
-- Meta's dedupe key on the older duplicate rows is gone.

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;

DROP INDEX IF EXISTS idx_audit_created;
DROP INDEX IF EXISTS idx_calls_created;
DROP INDEX IF EXISTS idx_comm_logs_lead;
DROP INDEX IF EXISTS idx_loan_apps_status;
DROP INDEX IF EXISTS idx_loan_apps_phone;
DROP INDEX IF EXISTS idx_loan_apps_lead;

DROP INDEX IF EXISTS uq_leads_phone_key;
DROP INDEX IF EXISTS idx_leads_phone_key;
ALTER TABLE leads DROP COLUMN IF EXISTS phone_key;

DROP INDEX IF EXISTS uq_wa_messages_wa_message_id;
