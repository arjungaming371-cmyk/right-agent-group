-- 2026-09-20 — Race-proof Instagram comment dedupe.
--
-- instagram_messages.comment_id had no UNIQUE constraint. Meta retries
-- webhooks concurrently and the app's SELECT-then-INSERT dedupe is only
-- race-proof with a real unique index. Without it, two concurrent retries
-- could BOTH trigger a public AI reply to the same post comment (visible
-- duplicate replies on the customer's Instagram page).
--
-- Older duplicate rows are de-duplicated by NULLing the older rows'
-- comment_id (data preserved; only the race-proof key is cleared).
--
-- Rollback: migrations/2026-09-20_instagram_comment_dedupe_rollback.sql

UPDATE instagram_messages
SET comment_id = NULL
WHERE comment_id IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (comment_id) id
    FROM instagram_messages
    WHERE comment_id IS NOT NULL
    ORDER BY comment_id, created_at DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_ig_messages_comment_id
  ON instagram_messages (comment_id) WHERE comment_id IS NOT NULL;

