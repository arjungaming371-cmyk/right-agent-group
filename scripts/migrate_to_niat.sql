-- Migration to NIAT branding and lead codes
ALTER TABLE leads ALTER COLUMN lead_code SET DEFAULT 'NIAT-' || lpad(nextval('lead_code_seq')::text, 4, '0');

UPDATE leads SET lead_code = replace(lead_code, 'RAG-', 'NIAT-') WHERE lead_code LIKE 'RAG-%';
