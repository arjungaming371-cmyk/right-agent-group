-- Editable team profile fields — phone, address, age, plus a flag tracking
-- whether the user has manually edited name/photo. Without that flag, the
-- Google OAuth callback's upsert would silently overwrite a manually-set
-- name/avatar back to whatever Google provides on the very next login.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-28_profile_fields.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-28_profile_fields_rollback.sql

ALTER TABLE team_profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE team_profiles ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE team_profiles ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE team_profiles ADD COLUMN IF NOT EXISTS profile_customized BOOLEAN NOT NULL DEFAULT false;
