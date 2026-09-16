DROP TABLE IF EXISTS developer_logs;

ALTER TABLE allowed_emails DROP CONSTRAINT IF EXISTS allowed_emails_role_check;
ALTER TABLE allowed_emails ADD CONSTRAINT allowed_emails_role_check
  CHECK (role IN ('admin', 'agent', 'viewer'));
