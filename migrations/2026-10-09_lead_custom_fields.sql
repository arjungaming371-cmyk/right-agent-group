-- 2026-10-09 — Outpero-style lead-sheet personalization (custom fields).
--
-- Outpero's flow: an operator hands over a lead sheet ("Lead Source / Sheet
-- → Input: first_name, purchase, plan → Script Editor renders 'Hi {{first_name}}!
-- I see you recently purchased the {{purchase}}...'"), and every call is
-- personalized from THOSE columns. Right Agent Group equivalent:
--
--   * The Upload console now captures every non-standard CSV column
--     (city, budget, plan, campaign, referred_by, …) into
--     leads.custom_fields (JSONB).
--   * The same JSON rides onto outbound_queue.custom_fields when the lead
--     is queued, so the dialer can render {merge_fields} inside
--     talking_points per call WITHOUT a second lookup.
--   * lib/script-studio.ts renders "{field}" tokens at dial time from
--     canonical lead columns + custom_fields.
--
-- Both columns are nullable JSONB (no backfill needed — legacy rows simply
-- have no custom data), and every statement is idempotent.

ALTER TABLE leads          ADD COLUMN IF NOT EXISTS custom_fields JSONB;
ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS custom_fields JSONB;

-- The dialer claims rows ordered by priority/scheduled_at; a GIN index is
-- NOT needed (we never query INTO custom_fields, we only read the column of
-- a claimed row). Cap the JSON size defensively at the application layer
-- (lib/script-studio.ts / api/upload) — Postgres JSONB has no practical
-- limit that matters at 15 fields × 200 chars.
