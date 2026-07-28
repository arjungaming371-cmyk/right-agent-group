-- The "developer" role already existed throughout the app code (lib/auth.ts,
-- dashboard nav, /api/developer/logs, the Team Access UI) but was never
-- actually wired up at the database level: allowed_emails.role's CHECK
-- constraint only permitted admin/agent/viewer, and the developer_logs table
-- referenced by app/api/developer/logs never existed. Both meant assigning
-- or using the role would fail outright.

ALTER TABLE allowed_emails DROP CONSTRAINT IF EXISTS allowed_emails_role_check;
ALTER TABLE allowed_emails ADD CONSTRAINT allowed_emails_role_check
  CHECK (role IN ('admin', 'agent', 'viewer', 'developer'));

CREATE TABLE IF NOT EXISTS developer_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_developer_logs_email ON developer_logs(email, created_at DESC);
