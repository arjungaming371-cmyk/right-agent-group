-- Rollback of 2026-10-09_lead_custom_fields.sql
ALTER TABLE leads          DROP COLUMN IF EXISTS custom_fields;
ALTER TABLE outbound_queue DROP COLUMN IF EXISTS custom_fields;
