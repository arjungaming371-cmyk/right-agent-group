-- Rollback for 2026-07-20_loan_edit_requests.sql

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('loan_application', 'escalation', 'login', 'whatsapp_message'));

ALTER TABLE loan_applications DROP COLUMN IF EXISTS last_edited_at;
DROP TABLE IF EXISTS loan_application_edit_requests;
