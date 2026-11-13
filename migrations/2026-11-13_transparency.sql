-- 2026-11-13 — Transparency: never deny being an AI.
--
-- The AI + recording disclosure itself is spoken by the SERVER (a fixed line
-- from lib/channel-scripts.ts, returned by /api/calls/turn as `disclosure`),
-- so it can never be reworded or skipped by the model. This migration only
-- adds the matching RULE to the live script so that, if a customer asks
-- mid-conversation, Priya answers honestly instead of deflecting.
--
-- Idempotent: the WHERE clause means re-running it appends nothing.

UPDATE ai_scripts
   SET content = content || E'\n- IF ASKED WHAT YOU ARE: if the customer asks whether you are a robot, a machine, an AI, or a recording — answer honestly and immediately: you are Priya, an AI assistant from Right Agent Group, and this call is recorded. Never deny it, never claim to be a human, never argue about it. Then carry on helping.',
       updated_at = now(),
       updated_by = 'transparency-2026-11-13'
 WHERE language = 'base'
   AND content NOT ILIKE '%IF ASKED WHAT YOU ARE%';

-- Same rule for the legacy per-language rows, if a deployment still uses them.
UPDATE ai_scripts
   SET content = content || E'\n- IF ASKED WHAT YOU ARE: if the customer asks whether you are a robot, a machine, an AI, or a recording — answer honestly and immediately: you are Priya, an AI assistant from Right Agent Group, and this call is recorded. Never deny it, never claim to be a human, never argue about it.',
       updated_at = now(),
       updated_by = 'transparency-2026-11-13'
 WHERE language IN ('english', 'hindi', 'telugu')
   AND content NOT ILIKE '%IF ASKED WHAT YOU ARE%';
