-- Rollback of 2026-09-22_whatsapp_rich_chat.sql.
-- Drops the rich-chat columns and the archived-view index. Message rows and
-- leads themselves are untouched.

ALTER TABLE whatsapp_messages DROP COLUMN IF EXISTS msg_type;
ALTER TABLE whatsapp_messages DROP COLUMN IF EXISTS media_id;
ALTER TABLE whatsapp_messages DROP COLUMN IF EXISTS media_mime;
ALTER TABLE whatsapp_messages DROP COLUMN IF EXISTS media_name;
ALTER TABLE whatsapp_messages DROP COLUMN IF EXISTS quoted_wa_id;
ALTER TABLE whatsapp_messages DROP COLUMN IF EXISTS quoted_text;
ALTER TABLE whatsapp_messages DROP COLUMN IF EXISTS quoted_from;
ALTER TABLE whatsapp_messages DROP COLUMN IF EXISTS reaction;

DROP INDEX IF EXISTS idx_leads_wa_active;
ALTER TABLE leads DROP COLUMN IF EXISTS wa_archived;
ALTER TABLE leads DROP COLUMN IF EXISTS wa_muted;
