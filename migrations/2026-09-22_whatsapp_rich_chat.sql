-- 2026-09-22 — WhatsApp rich chat (real-WhatsApp parity for the console UI).
--
-- The WhatsApp view was rebuilt to match the real WhatsApp Web experience:
-- reply/quote, reactions, photo/video/document attachments, archive, mute.
-- Every one of those features needs data the schema never stored:
--
--   whatsapp_messages
--     msg_type     text | image | video | audio | document | sticker
--     media_id     Meta media id (download via /api/whatsapp/media/[id])
--     media_mime   mime type for rendering/download decisions
--     media_name   original filename (documents)
--     quoted_wa_id wa_message_id of the message being replied to
--     quoted_text  cached text of the quoted message (no extra query at read time)
--     quoted_from  direction of the quoted message (inbound/outbound)
--     reaction     last reaction emoji on the message (1:1 chat = one actor per side)
--
--   leads
--     wa_archived  WhatsApp-style archived chat (default list excludes it)
--     wa_muted     muted notifications for this chat
--
-- All columns are IF NOT EXISTS so fresh local-setup.sql databases and older
-- deployments both end up complete. NULL-safe: every consumer treats NULL
-- msg_type as 'text' and NULL archived/muted as false.

-- ---- whatsapp_messages: media / replies / reactions ----
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS msg_type    TEXT NOT NULL DEFAULT 'text';
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_id    TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_mime  TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_name  TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS quoted_wa_id TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS quoted_text  TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS quoted_from  TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS reaction     TEXT;

-- Reaction writes hit the target message by wa_message_id on every reaction
-- toggle; the conversation poll also selects by lead. Both are already
-- indexed (idx_wa_messages_lead, wa_message_id unique partial) — no new
-- indexes needed.

-- ---- leads: archive + mute ----
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wa_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wa_muted    BOOLEAN NOT NULL DEFAULT false;

-- Conversations list filters archived chats out of the default view on every
-- 4s poll — partial index keeps that scan cheap as history grows.
CREATE INDEX IF NOT EXISTS idx_leads_wa_active
  ON leads (wa_archived, pinned DESC, pinned_at DESC)
  WHERE phone IS NOT NULL AND phone != '';
