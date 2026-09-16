-- Team member profiles — display name + avatar captured automatically from
-- Google at login (no manual entry needed), shown on the profile modal and
-- the /access team management page.
--
-- Kept as its own table rather than columns on allowed_emails:
-- allowed_emails governs WHO CAN LOG IN, a separate concern from what their
-- profile looks like — and the admin (identified via the ADMIN_EMAIL env
-- var, not necessarily a row in allowed_emails) still gets a profile row
-- this way.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-25_team_profiles.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-25_team_profiles_rollback.sql

CREATE TABLE IF NOT EXISTS team_profiles (
  email          TEXT PRIMARY KEY,
  display_name   TEXT,
  avatar_url     TEXT,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);
