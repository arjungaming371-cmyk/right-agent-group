-- 2026-09-20 — Dashboard polling indexes.
--
-- The dashboard polls unread counters (8s) and the Instagram conversation
-- list (5s). Both filtered on (direction, status) combinations that no
-- existing index served, so every poll re-scanned whatsapp_messages /
-- instagram_messages and got slower linearly with history.
--
-- Rollback: migrations/2026-09-20_dashboard_perf_indexes_rollback.sql

-- Unread WhatsApp badge: inbound, not yet read (status 'received' is the
-- app's "unread" marker; <> 'read' implies it and keeps the index useful
-- even if other inbound statuses appear later).
CREATE INDEX IF NOT EXISTS idx_wa_messages_unread
  ON whatsapp_messages (branch_id, created_at DESC)
  WHERE direction = 'inbound' AND status <> 'read';

-- Per-conversation unread counts for the Instagram inbox view.
CREATE INDEX IF NOT EXISTS idx_ig_messages_unread
  ON instagram_messages (ig_user_id, created_at DESC)
  WHERE direction = 'inbound' AND status <> 'read';
