-- Lead pinning — lets staff keep a specific lead at the top of the Leads
-- and WhatsApp Chat lists regardless of activity/score sort order.
--
-- pinned_at (not just a boolean) so multiple pinned leads sort by most
-- recently pinned first, same pattern as everything else in this app.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-20_lead_pinning.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-20_lead_pinning_rollback.sql

ALTER TABLE leads ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_pinned ON leads (pinned, pinned_at DESC) WHERE pinned = true;
