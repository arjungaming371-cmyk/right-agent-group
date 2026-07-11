# FINAL_10.1 — Fixes over FINAL_10

## Security
- **`WHATSAPP_APP_SECRET` is now treated as REQUIRED.** `.env.example` marks it ❌,
  START.ps1 prints a red warning if it's missing, and `/api/whatsapp` logs a loud
  warning on every unsigned request it accepts. Without the secret, the public
  webhook accepts forged payloads from anyone (junk leads, wasted Ollama
  generations, spam outbound sends).
- `middleware.ts` comment corrected: the webhook is HMAC-signature-verified,
  not "key-protected".
- `lib/exotel.ts`: flow URL switched from `http://my.exotel.com` to
  `https://my.exotel.com` (the URL carries your SID).

## Voice pipeline reliability
- **`STT_API_KEY` added to `.env.example`** (same value as `WHATSAPP_SERVICE_KEY`).
  Previously it only existed inside START.ps1's injection logic — running the STT
  service manually or via pm2 made it reject every request with HTTP 500.
- **`server/stt-service/app.py` now self-loads the project `.env`** (real
  environment variables still win), and falls back to `WHATSAPP_SERVICE_KEY`
  if `STT_API_KEY` isn't set. Manual/pm2 startup can no longer lose the key.
- **START.ps1 now propagates `STT_MODEL`, `STT_FORCE_DEVICE`, `STT_API_KEY`,
  `WHATSAPP_SERVICE_KEY`, and `CF_TUNNEL_NAME` from `.env`** to child processes.
  Previously `STT_MODEL` / `STT_FORCE_DEVICE` in `.env` never reached the STT
  process, and `CF_TUNNEL_NAME` only worked as a system environment variable.
- `STT_FORCE_DEVICE=cpu` defaulted in `.env.example` (IdeaPad Slim 3 has no
  NVIDIA GPU; explicit beats auto-detect).

## Tunnel / networking
- **New `cloudflared-config.example.yml`** with the ingress rules for a named
  tunnel. A quick tunnel only forwards port 3000, so the Exotel Voicebot applet
  (`wss://your-domain/voicebot` → port 3002) could NEVER connect. The ingress
  config routes `/voicebot` → 3002 and everything else → 3000.
- `CF_TUNNEL_NAME=rag` uncommented in `.env.example` — the named tunnel is
  effectively mandatory (quick tunnels also break Google OAuth, the Meta
  webhook, and Exotel status callbacks on every restart).

## Documentation (stale whatsapp-web.js era content removed)
- `README.md` rewritten: Cloud API stack, no QR-scan step, named-tunnel step
  added, webhook signature verification listed under safeguards.
- `START.ps1` final banner no longer says "scan QR".
- `DEPLOYMENT-GUIDE.md`: removed the whatsapp-service.js QR section (that file
  no longer exists); troubleshooting row updated for Cloud API.
- `.gitignore`: removed stale `.wwebjs_auth` / `.wwebjs_cache` entries.
- `lib/tts.ts`: removed a comment comparing to whatsapp-web.js.

## No behavioral changes to
- Webhook dedupe, delivery receipts, advisory-lock lead creation, atomic
  one-time form links, rate limiting, cross-channel memory, frustration
  detection, Ollama concurrency cap — all untouched from FINAL_10.

---

# Second-pass audit (same release)

## CRITICAL security fix — public /api/calls prefix
`middleware.ts` exempted the entire `/api/calls/` prefix from login. That
silently exposed, WITHOUT authentication:
- **GET /api/calls** — dumped the last 100 voice calls with lead names and
  phone numbers (PII leak).
- **POST /api/calls** — let anyone trigger outbound Exotel calls to ANY
  number on your account (toll fraud / harassment risk).
- **GET /api/calls/recording?url=** — proxied call-recording audio using
  your Exotel API credentials (privacy leak).
- **/api/tts** — unauthenticated compute-burner (nothing public uses it).

Fixed: only `/api/calls/turn` (voicebot bridge, x-api-key-protected inside)
and `/api/calls/status` (Exotel status webhook) remain public. Everything
else under /api/calls, plus /api/tts, now requires a login session. This is
the same bug class as the FINAL_10 /api/whatsapp subroute fix — now closed
on the calls side too.

## Hardening & correctness
- `/api/warmup` (public) now rate-limited (5/min per IP) so it can't be
  spammed to keep Ollama busy.
- The pre-call warmup ping in `/api/calls` POST now uses `APP_INTERNAL_URL`
  loopback instead of round-tripping through the public Cloudflare tunnel.
- `ai_scripts` table added to `local-setup.sql` (was only created lazily by
  /api/script) and to the `db:check` smoke test.

## Verified
- Full schema (`local-setup.sql` + `scripts/smoke-test.js`) executed against
  a real PostgreSQL 16: all 13 tables, every column the code reads/writes ✅
- Python (STT service), Node (voicebot, setup-db, smoke-test) syntax ✅

---

# Third-pass audit (same release)

## Bugs fixed
- **`/api/security` audit trail never worked**: the route queried a
  non-existent `audit_log` table (schema has `audit_logs`) with wrong
  columns (`details` vs `metadata`). Fixed to use the real table, and it
  now records WHO made the change (session email) instead of nothing.
  Verified with a live write/read against PostgreSQL 16.
- **`BACKUP.ps1` scheduled backups silently produced nothing**: it read
  `PG_PASSWORD` from .env but never passed it to pg_dump, so the hidden
  2 AM task hung forever on a password prompt. Now sets `PGPASSWORD`
  non-interactively (and clears it afterwards).
- **`nginx.conf` was missing the `/voicebot` WebSocket proxy** that
  `lib/exotel.ts` documents as required — on the VPS deployment path,
  Exotel's Voicebot applet could never reach the voicebot server. Added
  with 1-hour read/send timeouts so long calls aren't cut.
- Removed the leftover empty `app/api/whatsapp/qr/` directory
  (whatsapp-web.js era).

## Verified in this pass
- Every API endpoint referenced by the dashboard UI (20+ fetch calls in
  components/) maps to an existing route.
- Public form flow re-checked: field whitelist, atomic one-time claim,
  token release on failed insert, per-IP + per-token rate limits — all sound.
- Schema smoke test re-run against real PostgreSQL 16 after changes: ✅

---

# Final pass — build + live runtime verification

- **Full production build passes**: `next build` (Next.js 15.2.4) compiles
  every route, page, and the middleware with zero errors.
- **Runtime-verified with the real server running against PostgreSQL 16**:
  - Unauthenticated GET /api/calls, /api/calls/recording, POST /api/tts → 401 ✅
  - Meta webhook handshake echoes hub.challenge (200); wrong verify token → 403 ✅
  - /api/calls/turn: wrong x-api-key → 401; correct key → Priya's greeting ✅
  - /api/warmup rate limit trips on the 6th rapid request → 429 ✅
  - /dashboard without login → 307 redirect to /login ✅
  - Unauthenticated /api/leads → 401 ✅
- **Public form 500 fixed**: `form_links.token` is a UUID column, so any
  malformed token (bot scans, typos) caused a Postgres cast error → HTTP 500
  on the customer-facing endpoint. GET and POST /api/form/[token] now
  validate UUID format first and return a clean 404. Verified live.
- Removed leftover empty dirs (app/api/whatsapp/qr, app/upload).
