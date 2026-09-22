-- 2026-09-22 — Branch Instagram credentials (completes the multi-branch IG feature).
--
-- lib/instagram.ts's branchInstagramCtx() has read (b as any).instagram_token
-- since the IG multi-branch pass, but NO migration ever created the column —
-- so the value was always undefined → null and every branch-scoped IG send
-- silently fell back to the env-level credentials (or failed outright when
-- those were unconfigured). instagram_account_id already exists (2026-09-20
-- security hardening); it is re-declared here with IF NOT EXISTS so fresh
-- local-setup.sql databases and older deployments both end up complete.
--
-- Also aligns the schema with the branch manager UI/API, which can now set
-- both fields (write-only token, exactly like whatsapp_token).

ALTER TABLE branches ADD COLUMN IF NOT EXISTS instagram_account_id TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS instagram_token TEXT;

-- The webhook resolves the branch by account id on EVERY inbound IG event.
CREATE INDEX IF NOT EXISTS idx_branches_ig_acc ON branches (instagram_account_id);
