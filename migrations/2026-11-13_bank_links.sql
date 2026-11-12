-- Migration: Bank Link Library and Link Sends
CREATE TABLE IF NOT EXISTS link_library (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank          TEXT NOT NULL,
  product       TEXT NOT NULL,
  url           TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS link_sends (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT UNIQUE NOT NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  bank          TEXT NOT NULL,
  product       TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'whatsapp',
  sent_by       TEXT,
  sent_at       TIMESTAMPTZ DEFAULT now(),
  clicked_at    TIMESTAMPTZ,
  applied_at    TIMESTAMPTZ,
  sanctioned_at TIMESTAMPTZ,
  disbursed_at  TIMESTAMPTZ,
  loan_amount   NUMERIC,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'sent',
  branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_link_sends_token ON link_sends(token);
CREATE INDEX IF NOT EXISTS idx_link_sends_lead_id ON link_sends(lead_id);
CREATE INDEX IF NOT EXISTS idx_link_sends_status ON link_sends(status);

-- Seed default bank application links if empty
INSERT INTO link_library (bank, product, url)
SELECT 'SBI', 'Home Loan', 'https://homeloans.sbi/'
WHERE NOT EXISTS (SELECT 1 FROM link_library WHERE bank = 'SBI' AND product = 'Home Loan');

INSERT INTO link_library (bank, product, url)
SELECT 'HDFC Bank', 'Home Loan', 'https://www.hdfcbank.com/personal/borrow/popular-loans/home-loan'
WHERE NOT EXISTS (SELECT 1 FROM link_library WHERE bank = 'HDFC Bank' AND product = 'Home Loan');

INSERT INTO link_library (bank, product, url)
SELECT 'ICICI Bank', 'Home Loan', 'https://www.icicibank.com/personal-banking/loans/home-loan'
WHERE NOT EXISTS (SELECT 1 FROM link_library WHERE bank = 'ICICI Bank' AND product = 'Home Loan');

INSERT INTO link_library (bank, product, url)
SELECT 'IDFC First', 'Personal Loan', 'https://www.idfcfirstbank.com/personal-banking/loans/personal-loan'
WHERE NOT EXISTS (SELECT 1 FROM link_library WHERE bank = 'IDFC First' AND product = 'Personal Loan');

INSERT INTO link_library (bank, product, url)
SELECT 'Axis Bank', 'Personal Loan', 'https://www.axisbank.com/retail/loans/personal-loan'
WHERE NOT EXISTS (SELECT 1 FROM link_library WHERE bank = 'Axis Bank' AND product = 'Personal Loan');

INSERT INTO link_library (bank, product, url)
SELECT 'Bajaj Finserv', 'Business Loan', 'https://www.bajajfinserv.in/business-loan'
WHERE NOT EXISTS (SELECT 1 FROM link_library WHERE bank = 'Bajaj Finserv' AND product = 'Business Loan');

INSERT INTO link_library (bank, product, url)
SELECT 'IIFL Home', 'Loan Against Property', 'https://www.iiflhomeloans.com/loan-against-property'
WHERE NOT EXISTS (SELECT 1 FROM link_library WHERE bank = 'IIFL Home' AND product = 'Loan Against Property');
