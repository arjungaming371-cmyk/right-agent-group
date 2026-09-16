# Right Agent Group — Operations Console (FINAL_10.1, Cloud API)

AI-powered loan lead management system. Priya (the AI) handles outbound/inbound calls in English, Hinglish, and Tenglish (Hindi/Telugu spoken naturally, written in Roman script — one consistent en-IN voice), collects lead details, and sends the application form link via the **official Meta WhatsApp Business Cloud API**.

## Quick Start
See **DEPLOYMENT-GUIDE.md** (full deployment), **CLOUD-VOICE-GUIDE.md** (AWS deployment with cloud STT/TTS/LLM — no GPU, no Python), **SETUP-GUIDE-CLOUD-API.md** (WhatsApp/Meta setup), and **MIGRATION-GUIDE.md** (moving an existing install to another machine without losing data).

1. Install: Node 22 LTS, PostgreSQL 17, ffmpeg
2. Get API keys: a free Groq key at console.groq.com (Priya's brain), and — for the cloud voice pipeline — a Sarvam key at dashboard.sarvam.ai (STT + TTS; Cartesia optional for TTS)
3. Copy `.env.example` → `.env` and fill every ❌ value (`GROQ_API_KEY`/`SARVAM_API_KEY` per `LLM_PROVIDER`, and Google login keys are REQUIRED; `WHATSAPP_APP_SECRET` is REQUIRED — the webhook is publicly abusable without it)
4. `npm install && npm run db:setup`   ← creates the database + all tables automatically
5. Voice pipeline: either keep the free LOCAL stack (`STT_PROVIDER=local`, `TTS_CALL_PROVIDER=edge` — then also do the Python setup: `cd server && npm install && cd stt-service && python -m venv venv && venv\Scripts\pip install -r requirements.txt && cd ..\tts-service && python -m venv venv && venv\Scripts\pip install -r requirements.txt && cd ..\..`), or go CLOUD (`STT_PROVIDER=sarvam`, `TTS_CALL_PROVIDER=sarvam`) and skip Python entirely — see CLOUD-VOICE-GUIDE.md
6. Set up a **named Cloudflare tunnel** (see `cloudflared-config.example.yml`) — a quick tunnel breaks Google login, the Meta webhook, Exotel callbacks, and never exposes the voicebot WebSocket on port 3002
7. `npm run build`
8. `PowerShell -ExecutionPolicy Bypass -File START.ps1`  ← starts everything (Postgres check, AI key check, STT, voicebot, website, tunnel — skipping the Python services automatically when cloud providers are set)
9. Complete the Meta webhook handshake (SETUP-GUIDE-CLOUD-API.md, Step 7), then open the dashboard → WhatsApp tab should show **Connected**

## Tech Stack
- **Website**: Next.js 15, TypeScript, Tailwind CSS, PostgreSQL
- **AI Brain**: Groq Cloud API (default, streaming, free tier) or Sarvam-105B-conversations (`LLM_PROVIDER=sarvam`) — both OpenAI-compatible, streaming
- **Voice**: Exotel telephony → self-hosted WebSocket voicebot
- **STT**: provider-selectable — `STT_PROVIDER=local` self-hosted Whisper (faster-whisper; `small` on CPU, `large-v3` on GPU) or `STT_PROVIDER=sarvam` (Sarvam Saaras cloud STT, `mode=translit` returns Roman Tenglish/Hinglish directly, 8kHz telephony audio natively)
- **TTS**: provider-selectable — `TTS_CALL_PROVIDER=edge` self-hosted Edge TTS (free Microsoft neural voices, no GPU/API key needed), `sarvam` (Bulbul v3, Indian voices incl. speaker "priya"), or `cartesia` (Sonic, very high quality, en-IN/hi-IN/te-IN); all flow through the same ffmpeg telephony loudness chain; the dashboard "speak" button selects its own provider with `TTS_PROVIDER` (edge/elevenlabs/sarvam/cartesia)
- **WhatsApp**: Official Meta WhatsApp Business Cloud API — no QR, no ban risk. Replies inside the 24h service window are free; form-link templates ≈ ₹0.115 + GST per send
- **Login**: Google OAuth with Gmail allowlist

> Deploying on AWS? Read **CLOUD-VOICE-GUIDE.md** — switch STT/TTS (and optionally the LLM) to cloud APIs and skip the GPU + Python services entirely.

## Built-in Safeguards & Smart Features
- **Webhook signature verification** — every Meta webhook POST is HMAC-verified against `WHATSAPP_APP_SECRET`; message dedupe by `wa_message_id` makes Meta's retries safe.
- **Cross-channel memory** — Priya references the lead's recent WhatsApp chat on calls; the WhatsApp AI continues from recent phone calls. Same lead, one conversation.
- **Frustration radar** — multilingual (EN/HI/TE) detection on every call turn; frustrated callers are flagged as `needs_human` in Voice Logs + Communication Log instantly, with zero added call latency.
- **One-time form links** — application links can only ever be submitted once (atomic claim, race-proof) and the public form is rate-limited per IP and per token.
- **Email confirmations** — optional; set the `SMTP_*` vars and applicants with an email get a branded confirmation with a reference number.
- **Backups** — `BACKUP.ps1` does a `pg_dump` with 14-day rotation. Schedule it daily with: `PowerShell -File BACKUP.ps1 -Install`. Point `backups/` at a Google Drive-synced folder.
- **Schema smoke test** — `npm run db:check` verifies every column the code touches exists in the database. Run it after every deployment.
