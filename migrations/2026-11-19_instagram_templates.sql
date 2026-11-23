-- 2026-11-19 — Customizable Instagram Quick-Reply Templates
-- Persistent templates for Instagram DMs and comment replies with placeholder support ({username}, {phone}, {apply_link}).

CREATE TABLE IF NOT EXISTS instagram_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT NOT NULL,
  text        TEXT NOT NULL,
  category    TEXT DEFAULT 'General',
  branch_id   UUID REFERENCES branches(id) ON DELETE CASCADE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instagram_templates_branch ON instagram_templates(branch_id);

-- Seed default global templates (branch_id = NULL)
INSERT INTO instagram_templates (label, text, category)
SELECT * FROM (VALUES
  ('📱 Ask WhatsApp', 'Could you please share your WhatsApp number so our loan advisor can send you the exact loan details and rate chart?', 'WhatsApp'),
  ('💬 WhatsApp 1-Tap', 'You can also chat directly with our loan desk on WhatsApp here: https://wa.me/916301689511?text=Hi%20Right%20Agent%20Group,%20I%20am%20interested%20in%20a%20loan', 'WhatsApp'),
  ('⚡ Instant Check', 'Check your instant eligibility & loan offers in 2 minutes: https://13.201.0.111.sslip.io/apply', 'Offers'),
  ('🏠 Home Loan', 'Home loan interest rates start from 7.25% p.a. through 20+ banking partners in Hyderabad. Are you looking for purchase or construction?', 'Loans'),
  ('💼 Business Loan', 'Business loans up to ₹75 Lakhs available with fast approval and minimal documentation. What loan amount do you require?', 'Loans'),
  ('📍 Office Address', 'Our head office is at Gandimaisamma, Hyderabad. We never charge any advance fees or ask for OTP/PIN.', 'General'),
  ('🇮🇳 Telugu Offer', 'Namaskaram {username} garu! Right Agent Group nundi... Hyderabad lo 7.25% starting rate tho Home Loan available. Meeku details kavala?', 'Telugu')
) AS v(label, text, category)
WHERE NOT EXISTS (
  SELECT 1 FROM instagram_templates WHERE label = v.label AND branch_id IS NULL
);
