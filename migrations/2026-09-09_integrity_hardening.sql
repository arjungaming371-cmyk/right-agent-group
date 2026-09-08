-- Integrity hardening for EXISTING databases (2026-09 reliability pass).
-- Fresh installs get all of this from local-setup.sql directly.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-09-09_integrity_hardening.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-09-09_integrity_hardening_rollback.sql
--
-- What this does and deliberately does NOT do:
--   * wa_message_id UNIQUE — Meta retries webhooks concurrently; the app's
--     SELECT-then-INSERT dedupe is only race-proof with a real unique index.
--     Older duplicate rows are de-duplicated by NULLing the older rows'
--     wa_message_id (data preserved; only the race-proof key is cleared).
--   * leads.phone_key — generated normalized last-10-digits column with a
--     lookup index. It is NOT made UNIQUE here: merged/duplicate leads on a
--     live database are a business decision. A WARNING printed below tells
--     you how many duplicates exist and how to list them; resolve those and
--     then create the unique index manually if you want phone-level dedupe.
--   * Missing hot-path indexes (loan_applications, comm_logs, voice_calls,
--     audit_logs) and an automatic leads.updated_at trigger.

-- ---- 1. WhatsApp message dedupe (race-proof) ----
UPDATE whatsapp_messages
SET wa_message_id = NULL
WHERE wa_message_id IS NOT NULL
  AND id NOT IN (
    SELECT (MAX(id::text))::uuid FROM whatsapp_messages WHERE wa_message_id IS NOT NULL GROUP BY wa_message_id
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_messages_wa_message_id
  ON whatsapp_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

-- ---- 2. Normalized phone key on leads (dedupe-ready, not enforced) ----
ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_key TEXT
  GENERATED ALWAYS AS (right(regexp_replace(phone, '\D', '', 'g'), 10)) STORED;
CREATE INDEX IF NOT EXISTS idx_leads_phone_key ON leads (phone_key);

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT phone_key FROM leads WHERE phone_key <> '' GROUP BY phone_key HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE WARNING 'leads has % duplicate phone_key group(s). Review with: SELECT phone_key, count(*), array_agg(id) FROM leads WHERE phone_key <> '''' GROUP BY phone_key HAVING count(*) > 1; then dedupe and run: CREATE UNIQUE INDEX uq_leads_phone_key ON leads (phone_key) WHERE phone_key <> '''';', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_phone_key ON leads (phone_key) WHERE phone_key <> '';
  END IF;
END $$;

-- ---- 3. Missing hot-path indexes ----
CREATE INDEX IF NOT EXISTS idx_loan_apps_lead   ON loan_applications (lead_id);
CREATE INDEX IF NOT EXISTS idx_loan_apps_phone  ON loan_applications (phone);
CREATE INDEX IF NOT EXISTS idx_loan_apps_status ON loan_applications (status);
CREATE INDEX IF NOT EXISTS idx_comm_logs_lead   ON comm_logs (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_created    ON voice_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_logs (created_at DESC);

-- ---- 4. Automatic leads.updated_at (metrics read this column) ----
CREATE EXTENSION IF NOT EXISTS moddatetime;
DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);
