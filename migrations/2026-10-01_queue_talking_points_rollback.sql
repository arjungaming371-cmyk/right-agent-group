-- Rollback of 2026-10-01_queue_talking_points.sql
ALTER TABLE outbound_queue DROP COLUMN IF EXISTS talking_points;
