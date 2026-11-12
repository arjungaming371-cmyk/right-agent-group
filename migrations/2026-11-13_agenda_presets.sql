-- 2026-11-13 — Ask "What should Priya say?" at Queue Time, Not at Start
-- Adds agenda_label to outbound_queue and creates agenda_presets for queue-time brief injection.

ALTER TABLE outbound_queue ADD COLUMN IF NOT EXISTS agenda_label TEXT;

CREATE TABLE IF NOT EXISTS agenda_presets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT NOT NULL,
  text        TEXT NOT NULL,
  product     TEXT,
  language    TEXT,
  branch_id   UUID REFERENCES branches(id) ON DELETE CASCADE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agenda_presets_branch ON agenda_presets(branch_id);

-- Seed default global presets (branch_id = NULL)
INSERT INTO agenda_presets (label, text, product)
SELECT * FROM (VALUES
  ('Standard intro', '', NULL),
  ('New enquiry — send link', 'Reference what they enquired about, offer to send the official bank link, and book a callback.', NULL),
  ('Balance transfer offer', 'Introduce our balance-transfer offer and ask if their current EMI feels heavy. Don''t pitch personal loans.', 'Home Loan'),
  ('Top-up on existing loan', 'Ask if they need extra liquidity or renovation funds with an instant pre-approved top-up on their existing loan.', 'Home Loan'),
  ('Documents pending', 'Politely follow up regarding pending documents needed to proceed with their loan submission.', NULL),
  ('Old lead — still looking?', 'Re-engage regarding their earlier loan enquiry with today''s current competitive bank interest rates.', NULL)
) AS v(label, text, product)
WHERE NOT EXISTS (
  SELECT 1 FROM agenda_presets WHERE label = v.label AND branch_id IS NULL
);
