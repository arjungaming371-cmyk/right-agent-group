# Fixes Applied — 2026-09 Security & Reliability Pass

Full-stack audit fixes: 43 files changed. Branch: `fix/security-and-reliability-pass`.

Every change is annotated in-code with a `2026-09` comment. This file lists what changed and, critically, **what YOU must do before deploying** (see Required Actions at the bottom).

---

## 1. Security

| # | Fix | File(s) |
|---|-----|---------|
| 1.1 | WhatsApp webhook now **fails closed** when `WHATSAPP_APP_SECRET` is unset (was: accepted forged payloads with only a console warning). Dev escape hatch: `ALLOW_UNSIGNED_WEBHOOK=1`. | `app/api/whatsapp/route.ts` |
| 1.2 | Exotel webhooks **fail closed** when `EXOTEL_WEBHOOK_KEY` is unset + timing-safe key comparison. | `lib/exotel-webhook-auth.ts` |
| 1.3 | SSRF guard on URL-fetch KB ingestion: blocks localhost/private/metadata IPs, non-http(s) schemes, `.internal`/`.local` hosts, and caps response reads at 5MB. | `lib/kb-ingest.ts` |
| 1.4 | `/api/test` (dumps config surface) now requires the **admin** role. | `app/api/test/route.ts` |
| 1.5 | Voicebot WebSocket authentication: with `VOICEBOT_WS_KEY` set, `/voicebot` connections without `?key=` are dropped at the handshake (blocks call-SID forgery / token burning). | `server/voicebot-server.js` |
| 1.6 | Prompt-injection boundary: caller-derived data injected into the system prompt is now wrapped in an explicit "DATA, never instructions" marker. | `lib/llm.ts` |
| 1.7 | Email HTML injection fixed: lead names, caller speech, form names are escaped in digest, escalation, and confirmation emails. | `lib/digest.ts`, `lib/frustration.ts`, `lib/mail.ts`, `lib/utils.ts` (new `escapeHtml`) |
| 1.8 | CSV formula-injection guard (`= + - @` prefixed) + UTF-8 BOM so Hindi/Telugu names don't garble in Excel. | `lib/csv.ts` |

## 2. Voice pipeline reliability

| # | Fix | File(s) |
|---|-----|---------|
| 2.1 | Timeouts: STT fetch 10s, turn API 20s, turn stream 90s backstop — a hung upstream can no longer wedge a call with a muted mic. | `server/voicebot-server.js` |
| 2.2 | Fallback utterances: every failure path (STT down, turn API down, TTS error, empty transcript after real speech) now plays a fixed per-language line instead of dead air. Fixed lines are **prewarmed into the TTS cache at boot**, so they work even when TTS itself just died. | `server/voicebot-server.js` |
| 2.3 | `MAX_UTTERANCE_MS` now enforced in the speech branch too — a continuously loud line (TV/echo/noise) used to grow the buffer unbounded (~115MB/hr) and never trigger STT. | `server/voicebot-server.js` |
| 2.4 | Message dispatcher wrapped in try/catch + payload type check — one malformed frame can no longer crash the process and drop every concurrent call. | `server/voicebot-server.js` |
| 2.5 | In-flight LLM streams are aborted on barge-in / socket close (per-turn AbortController) — no more paying Groq tokens for audio nobody hears. | `server/voicebot-server.js` |
| 2.6 | Per-language start-fallback greeting (was: always English when the app is down). | `server/voicebot-server.js` |

## 3. STT / TTS services

| # | Fix | File(s) |
|---|-----|---------|
| 3.1 | STT concurrency semaphore (default 2, `STT_MAX_CONCURRENCY`) + honest 503 when saturated — no more unbounded threadpool thrash. | `server/stt-service/app.py` |
| 3.2 | STT warm-up inference at boot — the first call of the day no longer pays cuDNN autotune / cold-start cost. | `server/stt-service/app.py` |
| 3.3 | `/health` on both services is now **keyless** (returns ok/model only) so uptime probes and health checks work without the service key. | `server/stt-service/app.py`, `server/tts-service/app.py` |
| 3.4 | TTS concurrency cap + one retry on transient MS failures + **empty audio now returns 502** (a 200-with-silence used to poison the voicebot's TTS cache permanently). Malformed JSON → 400. Mid-word 800-char cut → word-boundary cut. | `server/tts-service/app.py` |
| 3.5 | Constant-time API key comparisons in both Python services. | both `app.py` |
| 3.6 | Pinned requirements (faster-whisper 1.1.0 / ctranslate2 4.5.0 / fastapi / uvicorn / edge-tts 7.0.0) — fresh `pip install` can no longer pull breaking version combos. | both `requirements.txt` |

## 4. Compliance & business logic

| # | Fix | File(s) |
|---|-----|---------|
| 4.1 | **DND gate on WhatsApp**: all three business-initiated sends (form link, call follow-up, missed-call follow-up) now check the suppression list and skip it. Fail-closed: a DB error during the check suppresses the send. Inbound-conversation replies stay ungated by design. | `lib/whatsapp.ts` |
| 4.2 | DND suppression check fails **closed** (treats unverifiable numbers as suppressed). | `lib/compliance.ts` |
| 4.3 | Lead-completion race fixed: the completion UPDATE is conditional on `status = 'new'`, so two overlapping turns can no longer both create a form link and message the customer. | `lib/voice-conversation.ts` |
| 4.4 | Follow-up race fixed in the status webhook: an atomic `UPDATE … WHERE followup_sent IS NOT TRUE` claim means concurrent webhook retries can't double-send. | `app/api/calls/status/route.ts` |
| 4.5 | WhatsApp template fallback only fires on definitive 4xx rejections — timeouts/5xx no longer cause template + fallback double-messages. Number validation tightened to `^91\d{10}$`. | `lib/whatsapp.ts` |
| 4.6 | EMI fix: "my salary is 50k, what's the EMI?" no longer quotes an EMI for a ₹50k *loan* — income-framed numbers are excluded from the principal. | `lib/finance.ts` |
| 4.7 | Silent `.catch(() => {})` on critical writes (call upsert, followup flag, comm logs, voicemail) now log — no more vanishing call records. | `lib/voice-conversation.ts` |

## 5. Database

| # | Fix | File(s) |
|---|-----|---------|
| 5.1 | **Schema drift fixed**: fresh `db:setup` now includes all 8 previously-missing migrations (lead pinning, callbacks, call instructions, login OTPs, loan edit requests, team profiles, developer role, loan tenure). Fresh and migrated installs finally converge. | `local-setup.sql` |
| 5.2 | New migration for existing databases: race-proof `wa_message_id` UNIQUE index (with safe dedupe), normalized `leads.phone_key` + duplicate report, 6 missing hot-path indexes, automatic `leads.updated_at` trigger. | `migrations/2026-09-09_integrity_hardening.sql` (+ rollback) |
| 5.3 | `run-migrations.js` rebuilt: `schema_migrations` tracking table, per-file transactions, stops and **exits non-zero** on failure (was: warn-and-continue, exit 0). | `scripts/run-migrations.js` |
| 5.4 | Fixed unguarded `ADD CONSTRAINT` in the loan-edit-requests migration (made every re-run warn). | `migrations/2026-07-20_loan_edit_requests.sql` |
| 5.5 | Smoke test extended: `allowed_emails.role`, pinning/callback/tenure columns, and all post-July-14 tables — `db:check` can no longer report "in sync" on a half-migrated database. | `scripts/smoke-test.js` |

## 6. Frontend

| # | Fix | File(s) |
|---|-----|---------|
| 6.1 | Leads + Analytics views: real error states with retry (no more infinite skeletons or server errors rendered as "no leads match"). | `leads-view.tsx`, `analytics-view.tsx` |
| 6.2 | Silent background polling in Voice Logs + Comm Log (no more full-list skeleton flash every 15s). | `voice-logs-view.tsx`, `comm-log-view.tsx` |
| 6.3 | **PII leak fixed**: WhatsApp avatars no longer send lead name/phone to dicebear.com — local initials avatars instead. | `whatsapp-view.tsx` |
| 6.4 | Stale-response race guards on WhatsApp chat switching and quick-chat streaming. | `whatsapp-view.tsx`, `quick-chat.tsx` |
| 6.5 | Public loan form: real `<form>` (Enter submits), accessible labels, autocomplete attributes, input length caps, and — most importantly — a network failure now shows "couldn't reach the server + Retry" instead of "Link not valid". | `app/form/[token]/page.tsx` |
| 6.6 | Sidebar status pill is real (polls `/api/system/status`) instead of hardcoded "All systems operational". | `shell.tsx` |
| 6.7 | Mutation handlers reset busy state in `finally` (buttons no longer stick disabled on network errors); errors toast. | `leads-view`, `calendar-view`, `upload-view`, `voice-logs-view` |
| 6.8 | Light-theme dark-on-dark text fixed (toast, command palette, notification bell now use themed tokens). | 3 UI files |
| 6.9 | OTP input has an accessible label; "now ago" rendering bug fixed. | `otp-form.tsx`, `quick-chat.tsx` |

## 7. Config & ops

| # | Fix | File(s) |
|---|-----|---------|
| 7.1 | Removed stale `twilio` from `serverExternalPackages`. | `next.config.mjs` |
| 7.2 | nginx: `client_max_body_size 25m` (PDF/CSV uploads were 413-ing at the proxy), request rate-limit zones for auth + API, gzip. | `nginx.conf` |
| 7.3 | `.env.example` documents the three new REQUIRED secrets with exact Exotel/Meta URL instructions. | `.env.example` |
| 7.4 | Removed the dead `UPGRADE-NOTES-v13.md` reference. | `server/voicebot-server.js` |

---

## ⚠️ REQUIRED ACTIONS BEFORE DEPLOYING

The fail-closed changes protect you but need configuration. **If you deploy without these, Exotel callbacks and the voicebot WebSocket will be rejected** (each service logs a clear reason when that happens).

1. **Generate and set the new secrets** in `.env`:
   ```
   EXOTEL_WEBHOOK_KEY=<openssl rand -hex 32>
   VOICEBOT_WS_KEY=<openssl rand -hex 32>
   ```
2. **Exotel dashboard** — bake the key into both callback URLs:
   - Status callback: `https://YOUR-DOMAIN/api/calls/status?key=EXOTEL_WEBHOOK_KEY_VALUE`
   - Passthru applet: `https://YOUR-DOMAIN/api/calls/passthru?key=EXOTEL_WEBHOOK_KEY_VALUE`
   - Voicebot applet: `wss://YOUR-DOMAIN/voicebot?key=VOICEBOT_WS_KEY_VALUE`
3. **WhatsApp**: confirm `WHATSAPP_APP_SECRET` is set (it is documented as REQUIRED in your README — if it's set, nothing changes for you).
4. **Run the new migration on your existing database**:
   ```
   node scripts/run-migrations.js     # or: psql -f migrations/2026-09-09_integrity_hardening.sql
   npm run db:check                    # extended smoke test
   ```
   It prints a WARNING if duplicate lead phones exist (with the query to list them) — phone uniqueness on existing data is your business decision.
5. **Python services**: `pip install -r requirements.txt` in both venvs (pinned versions; if your current venv works, `pip freeze` first and keep your exact versions).
6. **Local dev without Meta/Exotel?** Set `ALLOW_UNSIGNED_WEBHOOK=1` — dev machines only, never on the public deployment.
7. **One test call** before going live: the voice pipeline changes (timeouts, fallbacks, aborts) are all exercised by `npm run test:voicebot`, but a real call is the final proof.

### Known trade-offs (documented in code)
- Empty-transcript after real speech now plays the "please repeat" line (was: silence) — watch for repeated-clarify loops on very noisy lines.
- Income-framed EMI questions now quote the default-amount EMI and let Priya confirm the amount, rather than risk quoting on the salary figure.
- Barge-in-off playback pacing was left as-is (Infinity lead) — changing it alters live-call timing you've tuned; revisit only with the echo probe.

---

# Fixes Applied — 2026-09-20 Deep-Audit Remediation Pass

Independent line-by-line audit of the hot paths (auth, webhooks, dialer, form
links, voice WebSocket, polling endpoints) found the issues below — including
two regressions inside the 2026-09 pass itself. Every change is annotated
in-code with a `2026-09` comment. `npx tsc --noEmit` and `next build` pass.

## A. Critical / High

| # | Fix | File(s) |
|---|-----|---------|
| A.1 | **Broken integrity migration fixed**: `2026-09-09_integrity_hardening.sql` deduped with `(MAX(id::text))::uuid` on a BIGINT id — invalid UUID cast, migration always errored and (fail-fast) blocked every later migration from running. | `migrations/2026-09-09_integrity_hardening.sql` |
| A.2 | **System-key privilege escalation closed**: `setSystemKeys` accepted ANY key name, so a developer could persist `AUTH_SECRET`/`ADMIN_EMAIL` rows that got hydrated into `process.env` → session forgery. Hard allow-list at write AND hydration time; only the 13 provider keys are legal. | `lib/system-keys.ts` |
| A.3 | **Outbound post-call pipeline un-broken**: `makeExotelCall` registered `StatusCallback` WITHOUT `?key=`, so the moment `EXOTEL_WEBHOOK_KEY` was set (per the 2026-09 pass), every outbound call's terminal status, recording URL and WhatsApp follow-up were silently dropped. The registered URL now carries the key. | `lib/exotel.ts` |
| A.4 | **Dialer double-dial race fixed**: `/api/outbound/process` claimed queue rows with SELECT-then-dial — two concurrent triggers dialed the same real customers twice. Rows are now claimed atomically (`FOR UPDATE SKIP LOCKED`, status `dialing`, `claimed_at` timestamp; crashed claims auto-reclaimed after 15 min; quota aborts release claims). | `app/api/outbound/process/route.ts`, `migrations/2026-09-20_dialer_claim_safety.sql` |
| A.5 | **Arbitrary-lead-overwrite via unparseable phone fixed**: `PHONE_MATCH_SQL` was `LIKE '%' || $1` — with `$1 = ''` it matched EVERY lead. Now exact last-10 equality with `NULLIF($1,'')` (empty matches nothing). | `lib/phone.ts` (+ every call site) |
| A.6 | **Leads POST hardened**: raw-body mass assignment (client could set `score`, `lead_code`, `created_at`…) replaced with a field whitelist; phone-dedupe is now BRANCH-SCOPED so branch staff can't adopt other branches' leads; PATCH strips server-managed columns; GET bounded with LIMIT (polled 15s). | `app/api/leads/route.ts` |
| A.7 | **XFF spoofing fixed**: the IP allowlist (and `clientIp()` rate limiting) read the FIRST `X-Forwarded-For` entry — attacker-controlled. Now prefers `X-Real-IP` (set by our nginx), else the LAST XFF entry. | `middleware.ts`, `lib/rate-limit.ts` |
| A.8 | **Cross-branch IDORs closed**: calendar callbacks (no branch filter + missing `branch_manager` role), send-form (any leadId + WhatsApp target taken from the REQUEST body → arbitrary-number form-link sends), WhatsApp send (comm logs pinned to any lead), upload/confirm (could dial any branch's leads), upload dedupe (cross-branch lead adoption). | `app/api/leads/callbacks`, `app/api/leads/send-form`, `app/api/whatsapp/send`, `app/api/upload`, `app/api/upload/confirm` |
| A.9 | **Global role-catalog write restricted to admin**: `branch_manager` could rewrite `custom_roles_config` for the whole org. | `app/api/roles-config/route.ts` |
| A.10 | **SSRF hardened**: redirects now followed MANUALLY with full re-validation per hop (the old `redirect:"follow"` hopped straight into 127.0.0.1); numeric-form IPv4 (`2130706433`, `0x7f000001`, `0177.0.0.1`) normalized and checked; DNS resolved and refused when ANY record is private. | `lib/kb-ingest.ts` |
| A.11 | **Public `/api/system/status` throttled + cached**: unauthenticated hits fired 2 paid Groq probes + 1 Meta probe per request; now 10 req/min/IP + a 60s shared cache. | `app/api/system/status/route.ts` |
| A.12 | **Voicebot WebSocket fail-closed**: with `VOICEBOT_WS_KEY` unset the server used to accept ANY connection (callSid forgery, transcript injection, token burn). It now rejects everything unless the key is set — or `ALLOW_UNSIGNED_WEBHOOK=1` for local dev. Plus: 1MB `maxPayload` cap, 30s ping/pong dead-socket sweep (half-open sockets used to leak sessions + comfort-noise timers forever), `unhandledRejection` backstop, `uncaughtException` clean-exit handler, and `endUtterance()` rejections caught at both call sites. | `server/voicebot-server.js` |

## B. Medium

| # | Fix | File(s) |
|---|-----|---------|
| B.1 | Instagram comment dedupe made race-proof: `uq_ig_messages_comment_id` unique index (older dups NULLed by migration) + `ON CONFLICT DO NOTHING RETURNING` claim on inbound DMs/comments so concurrent Meta retries can't double-fire PUBLIC AI replies. Outbound comment inserts also `ON CONFLICT DO NOTHING`. Lead binding by exact `instagram_handle` (substring ILIKE bound @john2 to @john's lead). | `app/api/instagram/route.ts`, `migrations/2026-09-20_instagram_comment_dedupe.sql` |
| B.2 | WhatsApp inbound dedupe fallback removed: the old `.catch()` re-inserted duplicates WITHOUT `wa_message_id`, defeating the unique index and causing double AI replies / double sends on retries; replaced with an atomic `ON CONFLICT DO NOTHING RETURNING` claim. | `app/api/whatsapp/route.ts` |
| B.3 | Loan edit-request review made atomic: approve/reject claim via `UPDATE … WHERE status='pending' RETURNING` — concurrent reviewers can no longer both apply the write. | `app/api/loans/edit-requests/[id]/route.ts` |
| B.4 | Lead-memory manual PATCH now runs under the SAME per-lead advisory lock as the Lead Brain pipeline (lost updates between human edits and background analysis). | `app/api/leads/[id]/memory/route.ts` |
| B.5 | Digest double-send fixed: in-app cron AND `DIGEST.ps1` both fired at 08:00 — a DB-backed sent-log (`form_configs` key `digest:<period>:<date>`, atomic INSERT claim) makes it once-per-day; the manual button bypasses the dedupe. Service-key compare now timing-safe. | `app/api/digest/route.ts` |
| B.6 | One-time form link is now crash-safe: claim → application insert → lead backfill run in ONE transaction (a crash mid-submit used to burn the link without saving the application). | `app/api/form/[token]/route.ts` |
| B.7 | Prompt-injection boundary tail sentence added to `chatWithLLMStream` (the non-stream path had it; the stream path — used on live calls — was missing it). | `lib/llm.ts` |
| B.8 | Raw `e.message` leaks replaced with the sanitized `apiError` helper across 14 route files (Postgres/stack details no longer reach clients). | `app/api/**` (14 routes) |
| B.9 | All shared service-key compares (`x-api-key`) and Meta verify-token compares are now constant-time via a shared `safeEqual`. | `lib/security.ts`, 6 routes |
| B.10 | Loans GET bounded with LIMIT; loans PATCH strips `branch_id`/`submitted_at`. | `app/api/loans/route.ts` |
| B.11 | Lead-brain idle-scan overlap fixed: per-lead advisory locks mean the 5-minute cron can't double-analyze leads while the previous scan is still running. | `lib/lead-brain.ts` |

## C. Schema & performance

| # | Fix | File(s) |
|---|-----|---------|
| C.1 | **Schema drift closed**: `system_api_keys`, `api_usage_logs`, `instagram_messages`, `leads.instagram_handle`, `allowed_emails.allowed_modules` existed only as migrations — fresh `db:setup` installs were missing them (Instagram + API-keys admin broken out of the box). Mirrored into `local-setup.sql`. | `local-setup.sql` |
| C.2 | Smoke test now requires the drift-prone columns/tables (`branch_id`, `phone_key`, `instagram_handle`, `claimed_at`, `system_api_keys`, `api_usage_logs`, `instagram_messages`) so a skipped migration fails loudly. | `scripts/smoke-test.js` |
| C.3 | Dashboard polling indexes: partial indexes for the WhatsApp unread badge and Instagram per-conversation unread counts. | `migrations/2026-09-20_dashboard_perf_indexes.sql` |
| C.4 | Script cache staleness fixed: one global TTL timestamp meant each fetch reset freshness for every other branch/channel/language — stale scripts could serve forever. Per-entry timestamps now. | `lib/llm.ts` |
| C.5 | WhatsApp status probe cached 60s (was: one live Meta API call per 8s dashboard poll). | `app/api/whatsapp/status/route.ts` |
| C.6 | Instagram conversations bounded with LIMIT 200 (polled every 5s). | `app/api/instagram/conversations/route.ts` |
| C.7 | `maybeSingle()` added to the DB builders (Supabase-parity: 0 rows → `data:null`, no error) and used by the IDOR fixes. | `lib/db.ts` |

## D. Required actions for THIS pass

1. **Set `VOICEBOT_WS_KEY`** — the voicebot now refuses ALL WebSocket connections without it (fail-closed). Then bake `?key=` into the Exotel Voicebot applet URL. Local-only dev: `ALLOW_UNSIGNED_WEBHOOK=1`.
2. **Run migrations** (`node scripts/run-migrations.js`) — applies the fixed integrity migration (if it previously errored on your DB), the dialer claim column, the Instagram comment unique index, and the polling indexes. Existing duplicate `comment_id` rows are auto-NULLed (oldest rows lose only the dedupe key).
3. **Exotel status callback**: if you configured the dashboard URL manually with `?key=`, nothing changes — outbound calls now register it automatically.
4. Re-run `npm run db:check` — the smoke test now also fails loudly on the schema-drift tables.

### Known trade-offs (documented in code)
- IP allowlist/rate limiting now trusts `X-Real-IP`/last-XFF: correct behind our nginx or Cloudflare; if you expose the app some other way, ensure the nearest proxy sets `X-Real-IP`.
- DNS-rebinding between our pre-check and fetch's own resolution remains theoretically possible (egress filtering is the complete control) — documented in `lib/kb-ingest.ts`.
- Leads/loans lists are capped (default 1000, `?limit=` up to 5000). Very large installs should switch the dashboard to real pagination.
