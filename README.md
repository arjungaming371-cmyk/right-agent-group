# Right Agent Group — Operations Console (FINAL_10.1, Cloud API)

AI-powered loan lead management system. Priya (the AI) handles outbound/inbound calls in English, Hindi, and Telugu, collects lead details, and sends the application form link via the **official Meta WhatsApp Business Cloud API**.

## Quick Start
See **DEPLOYMENT-GUIDE.md** (full deployment) and **SETUP-GUIDE-CLOUD-API.md** (WhatsApp/Meta setup).

1. Install: Node 22 LTS, PostgreSQL 17, Ollama, Python 3.11, ffmpeg
2. `ollama pull llama3.1:8b`
3. Copy `.env.example` → `.env` and fill every ❌ value (Google login keys are REQUIRED; `WHATSAPP_APP_SECRET` is REQUIRED — the webhook is publicly abusable without it)
4. `npm install && npm run db:setup`   ← creates the database + all tables automatically
5. `cd server && npm install && cd stt-service && python -m venv venv && venv\Scripts\pip install -r requirements.txt && cd ..\..`
6. Set up a **named Cloudflare tunnel** (see `cloudflared-config.example.yml`) — a quick tunnel breaks Google login, the Meta webhook, Exotel callbacks, and never exposes the voicebot WebSocket on port 3002
7. `npm run build`
8. `PowerShell -ExecutionPolicy Bypass -File START.ps1`  ← starts everything (Postgres check, Ollama, STT, voicebot, website, tunnel)
9. Complete the Meta webhook handshake (SETUP-GUIDE-CLOUD-API.md, Step 7), then open the dashboard → WhatsApp tab should show **Connected**

## Tech Stack
- **Website**: Next.js 15, TypeScript, Tailwind CSS, PostgreSQL
- **AI Brain**: Ollama (Llama 3.1 8B) — fully local, zero cost
- **Voice**: Exotel telephony → self-hosted WebSocket voicebot
- **STT**: Whisper (faster-whisper) — `small` on CPU, `large-v3` on GPU
- **TTS**: self-hosted IndicF5 (AI4Bharat F5-TTS, `server/tts-service`) — ONE cloned Priya voice across English/Hindi/Telugu; needs a GPU, no fallback provider
- **WhatsApp**: Official Meta WhatsApp Business Cloud API — no QR, no ban risk. Replies inside the 24h service window are free; form-link templates ≈ ₹0.115 + GST per send
- **Login**: Google OAuth with Gmail allowlist

## Built-in Safeguards & Smart Features
- **Webhook signature verification** — every Meta webhook POST is HMAC-verified against `WHATSAPP_APP_SECRET`; message dedupe by `wa_message_id` makes Meta's retries safe.
- **Cross-channel memory** — Priya references the lead's recent WhatsApp chat on calls; the WhatsApp AI continues from recent phone calls. Same lead, one conversation.
- **Frustration radar** — multilingual (EN/HI/TE) detection on every call turn; frustrated callers are flagged as `needs_human` in Voice Logs + Communication Log instantly, with zero added call latency.
- **AI concurrency cap** — `OLLAMA_MAX_CONCURRENT` protects the machine from simultaneous-call overload; excess requests queue briefly instead of timing out.
- **One-time form links** — application links can only ever be submitted once (atomic claim, race-proof) and the public form is rate-limited per IP and per token.
- **Email confirmations** — optional; set the `SMTP_*` vars and applicants with an email get a branded confirmation with a reference number.
- **Backups** — `BACKUP.ps1` does a `pg_dump` with 14-day rotation. Schedule it daily with: `PowerShell -File BACKUP.ps1 -Install`. Point `backups/` at a Google Drive-synced folder.
- **Schema smoke test** — `npm run db:check` verifies every column the code touches exists in the database. Run it after every deployment.
