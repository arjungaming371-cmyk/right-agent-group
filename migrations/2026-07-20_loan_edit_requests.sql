-- Loan application edit requests — lets Priya (WhatsApp or voice) PROPOSE a
-- correction to an already-submitted loan application when a customer asks
-- for one, without ever writing to loan_applications directly. Staff review
-- the before/after diff in the dashboard and approve or reject; only an
-- approval actually applies the change.
--
-- Deliberately excludes identity-sensitive fields (pan_number, phone, email,
-- whatsapp_number) from what the AI can propose — those stay manual-only
-- edits via the existing PATCH /api/loans route.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-20_loan_edit_requests.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-20_loan_edit_requests_rollback.sql

CREATE TABLE IF NOT EXISTS loan_application_edit_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_application_id  UUID NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
  lead_id              UUID REFERENCES leads(id),
  proposed_by          TEXT NOT NULL,   -- 'priya_whatsapp' | 'priya_voice'
  reason               TEXT,            -- why the AI thinks this change is needed (from the conversation)
  previous_values      JSONB NOT NULL,  -- snapshot of the fields being changed, BEFORE
  proposed_values      JSONB NOT NULL,  -- the new values being proposed
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by          TEXT,
  reviewed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_edit_requests_pending ON loan_application_edit_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_edit_requests_app ON loan_application_edit_requests (loan_application_id, created_at DESC);

-- Lets the dashboard show an "Edited" badge without a join, and is what
-- "mark as updated" means in practice — set the moment an edit is approved.
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ;

-- notifications.type has a CHECK constraint from local-setup.sql that
-- doesn't know about this new event type — widen it or every
-- createNotification({type: "loan_edit_request", ...}) call silently fails.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('loan_application', 'escalation', 'login', 'whatsapp_message', 'loan_edit_request'));
