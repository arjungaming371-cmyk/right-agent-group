-- Persists the optional "What should Priya talk about?" instructions typed
-- into the dashboard's Call modal so they actually reach the AI during the
-- real call — previously they were only logged to comm_logs as a note and
-- silently dropped, because Exotel's voicebot bridge only ever knows the
-- call SID, not any custom text; the turn handler now reads it back from
-- this column when the bridge doesn't (and can't) supply it per-request.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-07-22_call_instructions.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-07-22_call_instructions_rollback.sql

ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS instructions TEXT;
