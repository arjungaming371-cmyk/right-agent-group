-- Instagram Leads Separation (2026-09-26) — rollback
-- Drops the social-prospect lane. Every promoted/social row returns to a
-- plain lead (the columns carry no data the CRM depends on).

DROP INDEX IF EXISTS idx_leads_social_pipeline;
DROP INDEX IF EXISTS idx_leads_crm_pipeline;
ALTER TABLE leads DROP COLUMN IF EXISTS ig_phone_extracted;
ALTER TABLE leads DROP COLUMN IF EXISTS promoted_to_crm_at;
ALTER TABLE leads DROP COLUMN IF EXISTS is_social_prospect;
