-- Rollback migration for 2026-09-19_instagram_messages.sql

DROP TABLE IF EXISTS instagram_messages CASCADE;
ALTER TABLE leads DROP COLUMN IF EXISTS instagram_handle;
