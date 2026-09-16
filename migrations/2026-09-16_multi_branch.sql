-- ============================================================
-- MULTI-BRANCH (MULTI-TENANT) ARCHITECTURE — 2026-09-16
--
-- One parent/admin account manages ALL branches. Each branch is a
-- sub-account with its own DLT-approved ExoPhone (caller ID), its own
-- WhatsApp Business number, its own branding, its own usage quotas,
-- and its own script overrides. AI Employees (Priya & co.) can be
-- shared across branches or dedicated to one. Billing stays
-- centralized at the organization level; branch_usage is the
-- per-branch meter that lets the parent allocate costs.
--
-- Rollback: migrations/2026-09-16_multi_branch_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Organizations — the parent account (owns billing)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'standard',
  billing_email TEXT,
  billing_notes JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every deployment keeps ONE organization; a fresh database gets it
-- automatically so admin → branches → data all have a home.
INSERT INTO organizations (name)
SELECT 'Right Agent Group'
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- ------------------------------------------------------------
-- 2. Branches — sub-accounts under the organization
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,          -- short handle, e.g. 'HYD', 'VJA'
  region        TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  -- Telephony: this branch's DLT-approved ExoPhone. When set, it OVERRIDES
  -- the env-level Exotel config for calls made/served by this branch.
  exotel_sid         TEXT,
  exotel_api_key     TEXT,
  exotel_api_token   TEXT,
  exotel_caller_id   TEXT,                      -- e.g. '04047198352' / '+914047198352'
  exotel_flow_app_id TEXT,
  -- WhatsApp: this branch's own WABA number. When set, it OVERRIDES
  -- WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID for the branch's sends and
  -- routes inbound webhooks by metadata.phone_number_id.
  whatsapp_phone_number_id TEXT,
  whatsapp_token           TEXT,
  whatsapp_display_name    TEXT,
  -- White-label (public-safe fields served by /api/branding)
  brand_name         TEXT,
  brand_logo_url     TEXT,
  brand_primary_color TEXT NOT NULL DEFAULT '#4f46e5',
  brand_tagline      TEXT,
  -- Per-branch usage limits (NULL = unlimited)
  monthly_call_limit      INTEGER,
  monthly_whatsapp_limit  INTEGER,
  max_ai_employees        INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_branches_org    ON branches (org_id);
-- Webhook / call-routing lookups (exact match on the routing identity)
CREATE INDEX IF NOT EXISTS idx_branches_caller ON branches (exotel_caller_id);
CREATE INDEX IF NOT EXISTS idx_branches_wa_pid ON branches (whatsapp_phone_number_id);

-- ------------------------------------------------------------
-- 3. AI Employees — the personas (Priya etc.)
--    scope 'shared'    = bookable by every branch of the org
--    scope 'dedicated' = only via explicit branch_ai_employees rows
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  voice_provider TEXT NOT NULL DEFAULT 'sarvam' CHECK (voice_provider IN ('sarvam', 'cartesia')),
  voice_speaker  TEXT,                         -- Sarvam speaker name or Cartesia voice ID
  languages     TEXT[] NOT NULL DEFAULT ARRAY['english','hindi','telugu'],
  scope         TEXT NOT NULL DEFAULT 'dedicated' CHECK (scope IN ('shared', 'dedicated')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_employees_org ON ai_employees (org_id);

CREATE TABLE IF NOT EXISTS branch_ai_employees (
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES ai_employees(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, employee_id)
);

-- ------------------------------------------------------------
-- 4. Per-branch script customization
--    Resolution order for a call/chat in branch B, employee E, language L:
--      1) branch_scripts(branch=B, employee=E, language=L)
--      2) branch_scripts(branch=B, employee=NULL,  language=L)   -- branch-wide
--      3) ai_scripts (the org-level default)
--    NULL employee_id is wildcarded to the zero UUID in the unique index
--    (Postgres UNIQUE treats NULLs as distinct — the COALESCE makes the
--    "one branch-wide override per language" rule enforceable).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branch_scripts (
  id          SERIAL PRIMARY KEY,
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES ai_employees(id) ON DELETE CASCADE,
  language    TEXT NOT NULL,
  content     TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_scripts
  ON branch_scripts (branch_id, COALESCE(employee_id, '00000000-0000-0000-0000-000000000000'::uuid), language);

-- ------------------------------------------------------------
-- 5. branch_usage — per-branch meter for centralized billing
--    month = 'YYYY-MM'. One row per branch per month, upserted.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branch_usage (
  branch_id         UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  month             TEXT NOT NULL,
  calls_made        INTEGER NOT NULL DEFAULT 0,
  call_seconds      INTEGER NOT NULL DEFAULT 0,
  whatsapp_messages INTEGER NOT NULL DEFAULT 0,
  stt_seconds       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tts_characters    INTEGER NOT NULL DEFAULT 0,
  llm_tokens        INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, month)
);

-- ------------------------------------------------------------
-- 6. Branch scoping on the data tables
--    NULL branch_id = HQ / pre-multi-branch data. Admins with no branch
--    selected see everything; branch-scoped users only see their branch.
-- ------------------------------------------------------------
ALTER TABLE leads              ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE voice_calls        ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE whatsapp_messages  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE outbound_queue     ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE loan_applications  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE uploaded_files     ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_leads_branch         ON leads (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_calls_branch   ON voice_calls (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_branch   ON whatsapp_messages (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_branch      ON outbound_queue (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_apps_branch     ON loan_applications (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_branch ON uploaded_files (branch_id, created_at DESC);

-- ------------------------------------------------------------
-- 7. Team binding — allowed_emails gains org/branch membership and the
--    branch_manager role.
--      admin          = parent (org) admin — manages all branches, pays
--      branch_manager = runs ONE branch — sees only that branch's data
--      agent/viewer   = branch-scoped when branch_id is set
--      developer      = unchanged superuser
-- ------------------------------------------------------------
ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS org_id    UUID REFERENCES organizations(id);
ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

ALTER TABLE allowed_emails DROP CONSTRAINT IF EXISTS allowed_emails_role_check;
ALTER TABLE allowed_emails ADD CONSTRAINT allowed_emails_role_check
  CHECK (role IN ('admin', 'agent', 'viewer', 'developer', 'branch_manager'));

-- updated_at maintenance for branches + organizations (same trigger style
-- the leads table already uses).
CREATE EXTENSION IF NOT EXISTS moddatetime;
DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;
CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);
DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);
