-- Rollback: migrations/2026-09-16_multi_branch.sql
-- Drops the multi-branch layer. Column drops are kept AFTER table drops in
-- case this runs on a partially-migrated database.

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;

ALTER TABLE allowed_emails DROP CONSTRAINT IF EXISTS allowed_emails_role_check;
ALTER TABLE allowed_emails ADD CONSTRAINT allowed_emails_role_check
  CHECK (role IN ('admin', 'agent', 'viewer', 'developer'));

ALTER TABLE allowed_emails     DROP COLUMN IF EXISTS branch_id;
ALTER TABLE allowed_emails     DROP COLUMN IF EXISTS org_id;
ALTER TABLE uploaded_files     DROP COLUMN IF EXISTS branch_id;
ALTER TABLE loan_applications  DROP COLUMN IF EXISTS branch_id;
ALTER TABLE outbound_queue     DROP COLUMN IF EXISTS branch_id;
ALTER TABLE whatsapp_messages  DROP COLUMN IF EXISTS branch_id;
ALTER TABLE voice_calls        DROP COLUMN IF EXISTS branch_id;
ALTER TABLE leads              DROP COLUMN IF EXISTS branch_id;

DROP TABLE IF EXISTS branch_usage;
DROP TABLE IF EXISTS branch_scripts;
DROP TABLE IF EXISTS branch_ai_employees;
DROP TABLE IF EXISTS ai_employees;
DROP TABLE IF EXISTS branches;
DROP TABLE IF EXISTS organizations;
