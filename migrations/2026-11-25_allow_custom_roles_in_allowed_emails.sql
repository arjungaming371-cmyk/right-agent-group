-- 2026-11-25: Allow custom roles and role titles in allowed_emails
-- Previously allowed_emails_role_check was restricted to ('admin', 'agent', 'viewer', 'developer', 'branch_manager').
-- This caused an error whenever team members were added with standard titles like "Loan Officer" or custom roles.

ALTER TABLE allowed_emails DROP CONSTRAINT IF EXISTS allowed_emails_role_check;
ALTER TABLE allowed_emails ADD CONSTRAINT allowed_emails_role_check CHECK (length(trim(role)) > 0);
