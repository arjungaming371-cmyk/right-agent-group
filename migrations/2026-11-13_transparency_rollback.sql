-- Rollback for 2026-11-13_transparency.sql — removes the appended rule lines.
UPDATE ai_scripts
   SET content = regexp_replace(content, E'\n- IF ASKED WHAT YOU ARE:[^\n]*', '', 'g'),
       updated_at = now(),
       updated_by = 'transparency-2026-11-13 (rolled back)'
 WHERE content ILIKE '%IF ASKED WHAT YOU ARE%';
