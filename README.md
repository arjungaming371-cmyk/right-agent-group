# Right Agent Group — Operations Console (FINAL_10.1, Cloud API)

AI-powered loan lead management system. Priya (the AI) handles outbound/inbound calls in English, Hinglish, and Tenglish (Hindi/Telugu spoken naturally, written in Roman script — one consistent en-IN voice), collects lead details, and sends the application form link via the **official Meta WhatsApp Business Cloud API**.

**Multi-branch ready**: one parent admin account manages every branch — each branch is a sub-account with its own DLT-approved ExoPhone, its own WhatsApp Business number, its own white-label branding, quotas, AI-Employee assignments, and script overrides, while billing stays centralized. See **MULTI-BRANCH-GUIDE.md**.

## Quick Start
See **DEPLOYMENT-GUIDE.md** (full deployment), **CLOUD-VOICE-GUIDE.md** (the 100% cloud voice pipeline on AWS — no GPU, no Python), **MULTI-BRANCH-GUIDE.md** (branches, branding, quotas, per-branch scripts), **SETUP-GUIDE-CLOUD-API.md** (WhatsApp/Meta setup), and **MIGRATION-GUIDE.md** (moving an existing install to another machine without losing data).

1. Install: Node 22 LTS, PostgreSQL 17, ffmpeg — **no Python, no GPU**
2. Get API keys: a **Sarvam key** at dashboard.sarvam.ai (REQUIRED — powers STT + default TTS), and a Groq key at console.groq.com (Priya's brain; or use `LLM_PROVIDER=sarvam` with the same Sarvam key)
3. Copy `.env.example` → `.env` and fill every ❌ value (`SARVAM_API_KEY`, `GROQ_API_KEY` per `LLM_PROVIDER`, and Google login keys are REQUIRED; `WHATSAPP_APP_SECRET` is REQUIRED — the webhook is publicly abusable without it)
4. `npm install && npm run db:setup`   ← creates the database + all tables automatically (including the multi-branch schema)
5. `TTS_CALL_PROVIDER=sarvam` (default) or `cartesia` — both flow through the same ffmpeg telephony loudness chain; see CLOUD-VOICE-GUIDE.md
6. Set up a **named Cloudflare tunnel** (see `cloudflared-config.example.yml`) — a quick tunnel breaks Google login, the Meta webhook, Exotel callbacks, and never exposes the voicebot WebSocket on port 3002
7. `npm run build`
8. `PowerShell -ExecutionPolicy Bypass -File START.ps1`  ← starts everything (Postgres check, AI key checks, voicebot, website, tunnel)
9. Complete the Meta webhook handshake (SETUP-GUIDE-CLOUD-API.md, Step 7), then open the dashboard → WhatsApp tab should show **Connected**

## Tech Stack
- **Website**: Next.js 15, TypeScript, Tailwind CSS, PostgreSQL
- **AI Brain**: Groq Cloud API (default, streaming, free tier) or Sarvam-105B-conversations (`LLM_PROVIDER=sarvam`) — both OpenAI-compatible, streaming
- **Voice**: Exotel telephony → self-hosted WebSocket voicebot (one small VM serves every branch)
- **STT**: **Sarvam Saaras cloud STT** (`saaras:v4`) — the only STT; `mode=translit` returns Roman Tenglish/Hinglish directly, 8kHz telephony audio accepted natively (the local Whisper service was removed)
- **TTS**: `TTS_CALL_PROVIDER=sarvam` (Bulbul v3, Indian voices incl. speaker "priya" — default) or `cartesia` (Sonic, very high quality, en-IN/hi-IN/te-IN); both flow through the same ffmpeg telephony loudness chain (the local Edge TTS service was removed); the dashboard "speak" button uses `TTS_PROVIDER` (sarvam default / cartesia / elevenlabs)
- **WhatsApp**: Official Meta WhatsApp Business Cloud API — no QR, no ban risk; every branch can carry its own WABA number. Replies inside the 24h service window are free; form-link templates ≈ ₹0.115 + GST per send
- **Multi-branch**: organizations → branches hierarchy; per-branch Exotel/WhatsApp credentials, white-label branding, quotas, AI-Employee assignments (shared or dedicated), and 3-level script overrides — all enforced server-side from the signed session
- **Login**: Google OAuth with Gmail allowlist (`branch_manager` role pins a user to one branch)

> Deploying on AWS? Read **CLOUD-VOICE-GUIDE.md** — a small 2–4GB instance runs the whole system.

## Built-in Safeguards & Smart Features
- **Webhook signature verification** — every Meta webhook POST is HMAC-verified against `WHATSAPP_APP_SECRET`; message dedupe by `wa_message_id` makes Meta's retries safe.
- **Cross-channel memory** — Priya references the lead's recent WhatsApp chat on calls; the WhatsApp AI continues from recent phone calls. Same lead, one conversation.
- **Frustration radar** — multilingual (EN/HI/TE) detection on every call turn; frustrated callers are flagged as `needs_human` in Voice Logs + Communication Log instantly, with zero added call latency.
- **One-time form links** — application links can only ever be submitted once (atomic claim, race-proof) and the public form is rate-limited per IP and per token.
- **Email confirmations** — optional; set the `SMTP_*` vars and applicants with an email get a branded confirmation with a reference number.
- **Backups** — `BACKUP.ps1` does a `pg_dump` with 14-day rotation. Schedule it daily with: `PowerShell -File BACKUP.ps1 -Install`. Point `backups/` at a Google Drive-synced folder.
- **Schema smoke test** — `npm run db:check` verifies every column the code touches exists in the database. Run it after every deployment.
