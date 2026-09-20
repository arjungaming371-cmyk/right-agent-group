-- Rollback of 2026-09-20_instagram_comment_dedupe.sql
DROP INDEX IF EXISTS uq_ig_messages_comment_id;
