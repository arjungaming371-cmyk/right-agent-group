-- Human-readable lead code (RAG-0001) — a short display ID staff can read
-- out on a call, search by, and quote to a customer.
--
-- leads.id is ALREADY a UUID primary key and stays the real key: every
-- foreign key (voice_calls, whatsapp_messages, form_links, ...) keeps
-- pointing at it. lead_code is purely the human-facing handle, because
-- nobody can read "550e8400-e29b-41d4-a716-446655440000" down a phone.
--
-- Backed by a sequence rather than a counter query so two concurrent
-- inserts can never race onto the same code — nextval() is atomic and
-- never hands the same value to two transactions. Codes are never reused,
-- including after a delete, which is what you want for something a
-- customer may have written down.
--
-- LPAD pads but never truncates, so the format widens by itself after
-- 9999 leads (RAG-10000) with no migration needed.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-31_lead_code.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-31_lead_code_rollback.sql

CREATE SEQUENCE IF NOT EXISTS lead_code_seq START 1;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_code TEXT;

-- Backfill in creation order so the oldest lead becomes RAG-0001 and the
-- numbering matches the order staff already think of these leads in.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM leads
  WHERE lead_code IS NULL
)
UPDATE leads
SET lead_code = 'RAG-' || LPAD(ordered.rn::text, 4, '0')
FROM ordered
WHERE leads.id = ordered.id;

-- Park the sequence past everything just backfilled. The is_called flag
-- handles the empty-table case: with 0 rows we set (1, false) so the first
-- nextval() returns 1 rather than skipping RAG-0001. setval() cannot take
-- 0 here because the sequence minimum value is 1.
SELECT setval(
  'lead_code_seq',
  GREATEST((SELECT COUNT(*) FROM leads), 1),
  (SELECT COUNT(*) > 0 FROM leads)
);

-- New rows get a code automatically, so no insert path has to know about
-- this column (app/api/leads POST inserts the request body as-is).
ALTER TABLE leads
  ALTER COLUMN lead_code SET DEFAULT 'RAG-' || LPAD(nextval('lead_code_seq')::text, 4, '0');

ALTER TABLE leads ALTER COLUMN lead_code SET NOT NULL;

-- Unique + the index that makes code lookup an index hit rather than a scan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_lead_code ON leads (lead_code);
