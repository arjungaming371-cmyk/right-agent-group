# Multi-Branch (Multi-Tenant) Architecture

One parent account runs the whole company; every branch is a sub-account with
its own phone number, WhatsApp number, branding, staff, and limits — while
billing stays centralized at the top.

```
organizations  (parent account — owns billing)
 └── branches  (sub-accounts)
      ├── own DLT-approved ExoPhone (Exotel caller ID)
      ├── own WhatsApp Business number (WABA phone_number_id + token)
      ├── own white-label branding (name / logo / color / tagline)
      ├── own monthly quotas (calls, WhatsApp messages)
      ├── own AI-Employee assignments (shared bench OR dedicated)
      ├── own script overrides (per language, per AI Employee)
      └── branch-scoped data: leads, calls, WhatsApp chats, loans, uploads
```

## The 8 requirements, and where each one lives

| Requirement | Implementation |
|---|---|
| **One parent admin account views/manages all branches** | `admin` role (ADMIN_EMAIL) sees every branch. Branch switcher in the dashboard topbar ("All branches (HQ)" ↔ any branch) re-issues the session with the active scope. Management UI: **Branches & Staff AI** view (`/api/branches`). |
| **Each branch gets its own sub-account + DLT-approved number** | `branches` table carries the branch's own `exotel_caller_id` (the DLT-approved ExoPhone) and optionally its own Exotel account (`exotel_sid/api_key/api_token`). Outbound calls dial with `CallerId = branch number`; inbound calls are routed to the branch by matching the CALLED number (`/api/calls/turn` start event, last-10-digits match). |
| **AI Employees shared across branches or dedicated** | `ai_employees` table with `scope = 'shared' \| 'dedicated'` + `branch_ai_employees` assignment rows. The Branches view lets you toggle which branches a dedicated employee serves. |
| **Centralized billing: parent pays for all branches** | There is ONE Sarvam/Exotel/Meta account set at the deployment level — the parent pays. `branch_usage` meters every branch's consumption (calls, talk-time, WhatsApp sends, STT seconds, TTS characters) so the admin can allocate the shared invoice per branch: **Branches & Staff AI → Usage & Billing**. |
| **Decentralized operations: branch managers see only their branch** | New `branch_manager` role. `allowed_emails.branch_id` pins a user to a branch at invite time (Team Access page); the session carries `branchId` and EVERY data route filters/stamps by it (leads, calls, WhatsApp, loans, uploads, analytics, exports). Branch managers cannot switch branches (`/api/auth/branch` is admin-only). |
| **White-label: each branch has its own branding** | `branches.brand_name / brand_logo_url / brand_primary_color / brand_tagline`. Served publicly (safe fields only) by `GET /api/branding?branch=…`; the AI persona speaks for the branch brand (branch context block in the system prompt) and WhatsApp fallback texts are branded per branch. |
| **Per-branch usage limits and quotas** | `branches.monthly_call_limit` / `monthly_whatsapp_limit`. Enforced by `checkQuota()` BEFORE every outbound call and business-initiated WhatsApp template send; a `suspended` branch is blocked from all outreach. Exceeding a limit returns a clear 403 in the dashboard and silently blocks auto-sends (logged). |
| **Per-branch script customization** | `branch_scripts` (branch → employee → language) with 3-level fallback: **branch+employee override → branch-wide override → org-level `ai_scripts`**. Edit per branch in **Branches & Staff AI → Scripts**. Applied on BOTH channels: calls (`getSystemPrompt`) and WhatsApp replies. |

## WhatsApp — "ALSO WHATSAPP"

Every branch can carry its **own WABA number**:

1. In Meta WhatsApp Manager, add the branch's phone number to your WABA
   (or a separate WABA) and create a permanent System User token for it.
2. In the dashboard (**Branches & Staff AI → Edit branch**) set:
   - `whatsapp_phone_number_id` (the Phone Number ID from WhatsApp Manager)
   - `whatsapp_token`
   - `whatsapp_display_name`
3. Point the webhook at the SAME `/api/whatsapp` URL — inbound payloads carry
   `metadata.phone_number_id`, which routes the conversation to the branch
   automatically (leads created from it get the branch stamped).

Outbound behavior per branch:

| Branch config | Where messages come from |
|---|---|
| No WhatsApp fields | The company's env-level `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` |
| phone_number_id only | Env token, branch phone ID (rare — avoid) |
| phone_number_id + token | **Fully the branch's own number** — sends, templates, media downloads, and quota gating all use it |

All of these flow through the same branch quota + DND gates as before.

## Setup walkthrough

```bash
# 1. Apply the schema (idempotent — safe on an existing database)
npm run db:setup                     # fresh installs
# or on an existing DB:
psql "$DATABASE_URL" -f migrations/2026-09-16_multi_branch.sql

# 2. Restart the app. The dashboard gains:
#    - "Branches & Staff AI" in the System section (admin + branch managers)
#    - a branch switcher in the topbar (admins)

# 3. Create branches and set numbers/branding/quotas.

# 4. Invite branch staff: Team Access → role "Branch Manager" (branch required),
#    or Loan Officer with a branch selected.

# 5. (Optional) Register AI Employees and assign branches / voices.
```

## What stays unchanged in a single-branch deployment

Nothing is required. With no `branches` rows:

- Sessions have `branchId = null` → every route behaves exactly as before.
- Calls/WhatsApp use the env-level Exotel/WABA credentials.
- The quota check short-circuits to "unlimited".
- Scripts resolve straight to the org-level `ai_scripts` table.

## Voice pipeline note (cloud-only)

The voice pipeline is now **100% cloud** (Sarvam STT always; TTS = Sarvam
default or Cartesia) — `server/stt-service` and `server/tts-service` (local
Whisper + Edge TTS) were **removed**. There is no GPU, no Python venv, and no
model download, so one small VM serves every branch; per-branch voice choice
(`ai_employees.voice_provider/voice_speaker`) is applied per call when
employees are registered. See CLOUD-VOICE-GUIDE.md.

## Security model (who can do what)

| Action | admin | branch_manager | agent | viewer |
|---|---|---|---|---|
| Create/edit/delete branches, set numbers & quotas | ✓ | — | — | — |
| Switch active branch | ✓ | — (pinned) | — (pinned) | — (pinned) |
| Edit branch scripts | ✓ (any) | ✓ (own branch) | — | — |
| View branch usage/billing | ✓ | ✓ (own branch) | — | — |
| Manage AI Employees | ✓ | view only | — | — |
| Leads/calls/WhatsApp/loans | all branches | **own branch only** | own branch | read-only, own branch |
| Upload CSVs / start campaigns | ✓ | ✓ (own branch) | — | — |
| Org-level script, security, compliance | ✓ | — | — | — |

Branch scoping is enforced **server-side from the signed session cookie**
(`lib/auth.ts` + `lib/branches.ts → sessionBranchId()`); the UI merely mirrors
it. A branch manager passing another branch's id in a request body gets 403/404,
never the data.

## API surface

| Endpoint | Method(s) | Who |
|---|---|---|
| `/api/branches` | GET, POST | admin/developer (GET also branch-scoped roles) |
| `/api/branches/[id]` | GET, PATCH, DELETE | admin/developer (GET also own manager) |
| `/api/branches/[id]/usage` | GET | admin + own branch manager |
| `/api/branches/[id]/scripts` | GET, PUT | admin + own branch manager (PUT) |
| `/api/ai-employees`, `/api/ai-employees/[id]` | GET/POST/PATCH/DELETE | admin/developer |
| `/api/branding?branch=` | GET | public (safe fields only) |
| `/api/auth/branch` | POST | admin/developer (switch active branch) |
| `/api/auth/me` | GET | adds `branchId`, `canSwitchBranch` |

Secrets (Exotel keys/tokens, WhatsApp tokens) are write-only: responses carry
`*_set: true|false`, never the values.
