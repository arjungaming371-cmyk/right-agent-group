-- Rollback: Remove allowed_modules column from allowed_emails table

ALTER TABLE allowed_emails DROP COLUMN IF EXISTS allowed_modules;
