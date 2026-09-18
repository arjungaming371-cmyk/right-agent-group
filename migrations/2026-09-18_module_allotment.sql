-- Add allowed_modules (TEXT[]) column to allowed_emails table
-- Defaults to NULL (meaning full default permissions for the role apply)

ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS allowed_modules TEXT[] DEFAULT NULL;
