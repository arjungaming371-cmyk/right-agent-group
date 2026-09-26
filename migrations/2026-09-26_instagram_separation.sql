-- Instagram Leads Separation (2026-09-26)
--
-- Every Instagram DM/comment auto-creates a phone-less leads row. Those rows
-- used to sit in the same pipeline as callable CRM leads — telecallers saw
-- them, bulk-dialer selections hit them, conversion metrics counted them.
-- This migration gives them their own lane WITHOUT moving any rows:
--
--   is_social_prospect = true   → Instagram inquirer, no phone yet, lives in
--                                 the "Instagram Prospects" tab only
--   is_social_prospect = false  → real CRM lead (callable) — the default
--
-- Foreign keys (instagram_messages.lead_id, comm_logs.lead_id,
-- ai_conversations.lead_id) keep pointing at the SAME row — promotion is a
-- flag flip, never a row move, so conversation history survives promotion.
--
-- Mirror of the fresh-install schema in local-setup.sql.
-- Rollback: 2026-09-26_instagram_separation_rollback.sql

ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_social_prospect BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS promoted_to_crm_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ig_phone_extracted TEXT;

-- Branch-scoped lane scans (both directions are hot paths: the CRM list and
-- the prospects tab each hit one of these partial indexes).
CREATE INDEX IF NOT EXISTS idx_leads_crm_pipeline
  ON leads (branch_id, created_at DESC)
  WHERE is_social_prospect = false;
CREATE INDEX IF NOT EXISTS idx_leads_social_pipeline
  ON leads (branch_id, created_at DESC)
  WHERE is_social_prospect = true;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- 1) Phone-less Instagram rows become social prospects.
--    phone LIKE 'IG%' catches the pre-2026-09-20 era, when the webhook
--    fabricated placeholder phones ("IG_12345678") — those are just as
--    uncallable as NULL and must leave the CRM lane too.
UPDATE leads
   SET is_social_prospect = true
 WHERE source IN ('Instagram DM', 'Instagram Comment')
   AND (phone IS NULL OR phone LIKE 'IG%');

-- 2) Strip the fabricated placeholders entirely so they can never collide in
--    phone_key or confuse matching (real phones are never touched).
UPDATE leads
   SET phone = NULL
 WHERE source IN ('Instagram DM', 'Instagram Comment')
   AND phone LIKE 'IG%';

-- 3) Instagram-source rows that ALREADY carry a real phone were promoted the
--    manual way (operator edited the phone on). Stamp them promoted so the
--    Instagram-origin badge in the CRM tab is uniform for every path.
UPDATE leads
   SET promoted_to_crm_at = COALESCE(updated_at, created_at, now())
 WHERE source IN ('Instagram DM', 'Instagram Comment')
   AND phone IS NOT NULL
   AND phone NOT LIKE 'IG%'
   AND is_social_prospect = false
   AND promoted_to_crm_at IS NULL;
