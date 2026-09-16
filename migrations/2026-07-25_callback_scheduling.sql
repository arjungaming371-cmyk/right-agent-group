-- Callback scheduling — lets staff record a scheduled follow-up call
-- date/time against a lead, surfaced on the dashboard's Calendar view.
-- Manual/dashboard-set only for now (not Priya parsing spoken dates live
-- on a call — that's a bigger, riskier feature for later if needed).
--
-- callback_at (not just a date) so it sorts/displays precisely and can be
-- compared against "now" (e.g. to flag overdue callbacks), same reasoning
-- as pinned_at in 2026-07-20_lead_pinning.sql.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-25_callback_scheduling.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-25_callback_scheduling_rollback.sql

ALTER TABLE leads ADD COLUMN IF NOT EXISTS callback_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS callback_note TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_callback_at ON leads (callback_at) WHERE callback_at IS NOT NULL;
