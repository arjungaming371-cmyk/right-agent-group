-- One-time login codes for the Two-Factor Authentication toggle (Access
-- Controls). When two_factor_auth is enabled and SMTP is configured, admin
-- sign-ins get a 6-digit code emailed after Google OAuth succeeds; the
-- session cookie is only issued once the code is verified.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-22_login_otps.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-22_login_otps_rollback.sql

CREATE TABLE IF NOT EXISTS login_otps (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,          -- sha256 of the 6-digit code
  attempts   INT NOT NULL DEFAULT 0, -- verification attempts; row invalid after 5
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
