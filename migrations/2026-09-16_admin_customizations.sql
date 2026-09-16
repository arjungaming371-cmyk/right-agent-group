-- Admin customizations: display_name on allowed_emails and form_configs table
ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE TABLE IF NOT EXISTS form_configs (
  id         TEXT PRIMARY KEY,
  config     JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Initialize default loan form config if not exists
INSERT INTO form_configs (id, config)
VALUES (
  'whatsapp_loan_form',
  '{
    "title": "Loan Application",
    "subtitle": "Complete your application in under 2 minutes",
    "loan_types": ["Home Loan", "Business Loan", "Personal Loan", "Loan Against Property (LAP)", "Education Loan", "Vehicle Loan"],
    "enabled_fields": {
      "city": true,
      "loan_amount": true,
      "loan_tenure": true,
      "employment_type": true,
      "monthly_income": true,
      "pan_number": true,
      "address": true,
      "email": true
    },
    "required_fields": {
      "customer_name": true,
      "whatsapp_number": true,
      "loan_amount": true,
      "loan_tenure": true,
      "employment_type": true,
      "monthly_income": true
    },
    "custom_fields": []
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;
