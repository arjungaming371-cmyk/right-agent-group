-- Rollback migration for 2026-09-19_system_api_keys.sql

DROP TABLE IF EXISTS system_api_keys CASCADE;
DROP TABLE IF EXISTS api_usage_logs CASCADE;
