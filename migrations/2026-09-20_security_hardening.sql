-- Security & reliability hardening (2026-09-20 pass).
-- Companion migration for the 2026-09-20 code fixes: every column/index the
-- hardened code paths reference is created here, so the graceful "column not
-- found → fall back to legacy behaviour" branches in the app become the
-- fast/atomic paths instead.
--
-- Apply:    psql -U postgres -d right_agent_group -f migrations/2026-09-20_security_hardening.sql
-- Rollback: psql -U postgres -d right_agent_group -f migrations/2026-09-20_security_hardening_rollback.sql
--
-- Contents:
--   1. allowed_emails.session_epoch   — logout revokes every outstanding
--                                       session cookie for that user.
--   2. form_links.expires_at          — one-time application links stop
--                                       serving PII forever.
--   3. idx_outbound_claim              — index serving the dialer's atomic
--                                       claim query (claimed_at column comes
--                                       from 2026-09-20_dialer_claim_safety.sql).
--   4. leads.ig_user_id               — EXACT Instagram identity matching
--                                       (replaces substring matching on
--                                       attacker-controlled usernames).
--   5. branches.instagram_account_id  — inbound IG webhook → branch routing.
--   6. wa_message_id unique index (fresh-DB safety; 09-09 migration creates
--      it on upgraded DBs).
--   7. digest_sent_log                — idempotent digest sending (in-app cron
--                                       and Windows Task Scheduler can both
--                                       fire at 08:00 without double emails).
--   8. Hot-path index for the dialer claim query.
--
-- NOTE: instagram comment dedupe, outbound_queue.claimed_at and the dashboard
-- unread partial indexes live in the separate 2026-09-20 Instagram/dialer/
-- perf migrations — they are intentionally NOT repeated here.

-- ---- 1. Session revocation epoch ----
ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS session_epoch INTEGER NOT NULL DEFAULT 0;

-- ---- 2. One-time form links get a TTL ----
ALTER TABLE form_links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_form_links_expires ON form_links (expires_at) WHERE expires_at IS NOT NULL;

-- ---- 3. Outbound dialer claim bookkeeping ----
-- (claimed_at column itself comes from 2026-09-20_dialer_claim_safety.sql;
-- this index serves its claim subquery.)
CREATE INDEX IF NOT EXISTS idx_outbound_claim
  ON outbound_queue (status, scheduled_at);

-- ---- 4. Exact Instagram identity on leads ----
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ig_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_ig_user_id ON leads (ig_user_id) WHERE ig_user_id IS NOT NULL;

-- ---- 5. Branch routing for inbound Instagram webhooks ----
ALTER TABLE branches ADD COLUMN IF NOT EXISTS instagram_account_id TEXT;

-- ---- 6. Race-proof webhook dedupe ----
-- WhatsApp inbound: partial unique index (already created by the 2026-09-09
-- hardening on existing DBs; IF NOT EXISTS keeps fresh installs + re-runs safe).
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_messages_wa_message_id
  ON whatsapp_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

-- (Instagram comment partial-unique index comes from
-- 2026-09-20_instagram_comment_dedupe.sql.)

-- ---- 7. Digest idempotency ----
-- period_key examples: 'daily-2026-09-20', 'weekly-2026-W38'.
-- INSERT … ON CONFLICT DO NOTHING returning rowCount is the atomic claim.
CREATE TABLE IF NOT EXISTS digest_sent_log (
  period_key TEXT PRIMARY KEY,
  recipient  TEXT,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- 8. Dashboard poll indexes ----
-- (Covered by 2026-09-20_dashboard_perf_indexes.sql.)
