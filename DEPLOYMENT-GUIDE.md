# Right Agent Group — Client Deployment Guide
### From a blank server to a live AI calling system, step by step

**What you need before starting:**
- A server (client's own machine or VPS) with Ubuntu 22.04 / 24.04. **The voice pipeline is 100% cloud** (Sarvam Saaras STT + Sarvam/Cartesia TTS — there are no local voice services, no GPU, no Python), so a small **2–4GB RAM instance with 20GB disk** runs the whole system (see CLOUD-VOICE-GUIDE.md for sizing and provider setup)
- A domain name pointed at the server's IP (e.g. `console.rightgroupeagent.com` → A record)
- An Exotel account with an ExoPhone number and API access
- A Google account (for creating the login credentials)
- A phone with WhatsApp for the business number

Everything below is copy-paste. Lines starting with `#` are comments — don't type them.

---

## STEP 1 — Base system packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git unzip nginx ffmpeg python3 build-essential postgresql postgresql-contrib
```

Install Node.js 22 LTS:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # should print v22.x
```

Install pm2 (keeps all services running forever + on reboot):
```bash
sudo npm install -g pm2
```

**If the server has an NVIDIA GPU** (strongly recommended):
```bash
sudo ubuntu-drivers autoinstall
sudo reboot
# after reboot, verify:
nvidia-smi    # should show the GPU
```

---

## STEP 2 — PostgreSQL database

```bash
sudo -u postgres psql -c "CREATE DATABASE right_agent_group;"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'CHOOSE_A_STRONG_PASSWORD';"
```
Write that password down — it goes in `.env` as `PG_PASSWORD`.

---

## STEP 3 — Groq (the AI brain)

Priya's brain is the **Groq Cloud API** (llama-3.3-70b, streaming, generous free tier) —
nothing to install or run locally.

1. Create a free account at **console.groq.com**
2. Enable **Zero Data Retention** in Data Controls (recommended for customer conversations)
3. Create an API key (`gsk_...`) and put it in `.env` as `GROQ_API_KEY`

Verify from the app server:

```bash
curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models
```

Concurrency, batching, and model serving are all handled by Groq — simultaneous live calls
need no extra setup. Confirm the app sees it via the dashboard's system status, or:

```bash
curl -H "Cookie: rag_session=..." https://your-domain.com/api/system/status
# {"llm":{"running":true,"message":"Groq ready with llama-3.3-70b-versatile"}, ...}
```

---

## STEP 4 — The project

Copy the release archive to the server (e.g. with `scp` or any file transfer), then:

```bash
cd ~
unzip right-agent-group-release.zip
cd right-agent-group
npm ci
```

Create the database tables:
```bash
npm run db:setup
```

---

## STEP 5 — Google login credentials

1. Go to https://console.cloud.google.com/apis/credentials
2. Create a project (any name) → **Create Credentials → OAuth client ID**
3. If asked, configure the consent screen first: External, app name "Right Agent Group", add your email, save through the steps.
4. Application type: **Web application**
5. Authorized redirect URI: `https://YOUR-DOMAIN/api/auth/google/callback`
6. Copy the **Client ID** and **Client Secret** — they go in `.env` next.

---

## STEP 6 — The .env file

```bash
cd ~/right-agent-group
nano .env
```

Fill in every value (generate the two secrets with `openssl rand -hex 32`):

```env
# --- App ---
NEXT_PUBLIC_APP_URL=https://YOUR-DOMAIN

# --- Database ---
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=right_agent_group
PG_USER=postgres
PG_PASSWORD=YOUR_PG_PASSWORD

# --- AI ---
GROQ_API_KEY=gsk_...         # console.groq.com — REQUIRED, Priya's brain

# --- Login ---
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx
AUTH_SECRET=RUN_openssl_rand_-hex_32
ADMIN_EMAIL=client-email@gmail.com    # this Gmail can ALWAYS log in

# --- Exotel ---
EXOTEL_SID=
EXOTEL_API_KEY=
EXOTEL_API_TOKEN=
EXOTEL_SUBDOMAIN=api.exotel.com
EXOTEL_CALLER_ID=            # the ExoPhone number
EXOTEL_FLOW_APP_ID=          # filled in STEP 9

# --- Internal service auth ---
WHATSAPP_SERVICE_KEY=RUN_openssl_rand_-hex_32
VOICEBOT_PORT=3002
APP_INTERNAL_URL=http://127.0.0.1:3000
TTS_CALL_PROVIDER=sarvam
```

Save (Ctrl+O, Enter, Ctrl+X).

---

## STEP 7 — Build and start the website

```bash
cd ~/right-agent-group
npm run build
pm2 start npm --name web -- start
```

Load Priya's knowledge base (the curated company facts — rates, products,
documents, office address — that ground her answers on calls and chats):
```bash
npm run seed:kb
```
This is idempotent — safe to re-run on every deploy; it only inserts what is
missing and updates what changed. Every seeded row passes the script-compliance
check (no approval guarantees, no invented phone/email/address) before it can
enter the knowledge base.

---

## STEP 8 — Start the helper services

> **Cloud voice setup (AWS / no GPU):** set
> `TTS_CALL_PROVIDER=sarvam` (or `cartesia`) and the matching provider keys in
> `.env` — then **skip any local STT and TTS services**. The
> voicebot transcribes and synthesizes through the cloud APIs; no Python,
> no venvs, no ~3GB model, no GPU. Full comparison, costs and knobs:
> **CLOUD-VOICE-GUIDE.md**. The local-services path below remains the free
> default and works exactly as before.

**WhatsApp** — official Meta Cloud API: there is NO local WhatsApp service and NO QR
scan anymore. Follow **SETUP-GUIDE-CLOUD-API.md** to get the 4 Meta values into `.env`
(`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET`) and complete the webhook handshake.

**Voicebot** (the live call engine):
```bash
cd ~/right-agent-group/server
npm ci
pm2 start voicebot-server.js --name voicebot
```

> There is no STT/TTS service to install — the voice pipeline is 100% cloud
> (Sarvam Saaras STT + Sarvam/Cartesia TTS, see CLOUD-VOICE-GUIDE.md). If you
> are migrating an OLD install that still has `server/stt-service` or
> `server/tts-service` folders, delete them; the app no longer starts them.

Make everything survive reboots:
```bash
pm2 save && pm2 startup
# run the sudo command pm2 prints
```

---

## STEP 9 — Exotel dashboard setup

1. Log in to https://my.exotel.com
2. **App Bazaar → Create a new Call Flow**
3. Drag in a **Voicebot applet** as the first (and only) step
4. Set its URL to: `wss://YOUR-DOMAIN/voicebot`
5. In the flow settings, **enable call recording**
6. Save. The flow's **App ID** is the number in the flow's URL — put it in `.env` as `EXOTEL_FLOW_APP_ID`
7. Go to your ExoPhone settings → point **incoming calls** to this same flow (so inbound callers also reach Priya)
8. Restart the web app to pick up the new env value: `pm2 restart web`

---

## STEP 10 — nginx + free HTTPS certificate

```bash
sudo nano /etc/nginx/sites-available/rightagent
```
Paste (replace YOUR-DOMAIN, twice):
```nginx
server {
    listen 80;
    server_name YOUR-DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /voicebot {
        proxy_pass http://127.0.0.1:3002/voicebot;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```
Enable it and add HTTPS:
```bash
sudo ln -s /etc/nginx/sites-available/rightagent /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR-DOMAIN
```
Certbot auto-renews the certificate forever.

---

## STEP 11 — First login and team access

1. Open `https://YOUR-DOMAIN` → you land on the login page
2. Sign in with the Gmail you set as `ADMIN_EMAIL`
3. Go to `https://YOUR-DOMAIN/access` → add teammates' Gmail addresses — only these accounts can ever log in

---

## STEP 12 — THE TEST CALL (do this before anything else)

```bash
pm2 logs voicebot
```
From the dashboard, trigger an outbound call to your own mobile (or just call the ExoPhone). Watch the logs:

- `▶ call start sid=...` → Exotel reached your server ✅
- Priya's greeting plays in your ear ✅
- `👂 [english] "..."` → your speech was transcribed ✅
- Priya replies, collects name → city → WhatsApp number, and the application link arrives on WhatsApp ✅
- The recording appears in the dashboard's voice logs a minute after hangup ✅

**If `call start` never appears:** the Exotel Voicebot message format on this account differs slightly. Add `console.log(raw.toString())` inside the `ws.on("message")` handler in `server/voicebot-server.js`, make one call, and compare the field names — the fix is a one-line rename. This is the only step that can't be pre-verified outside a live Exotel account.

---

## Daily health check (30 seconds)

```bash
pm2 list                                  # all 5 green: web, whatsapp, voicebot, stt, tts
curl -s https://YOUR-DOMAIN/api/test      # env + service health report
```

## If something breaks
| Symptom | Fix |
|---|---|
| Website down | `pm2 restart web`, check `pm2 logs web` |
| Priya silent on calls | `pm2 logs voicebot` — usually STT/TTS down or `GROQ_API_KEY` invalid/rate-limited |
| Priya mispronounces English words mid-sentence | `pm2 logs tts` — check the word is in `_LOANWORDS` in `server/tts-service/app.py`; add it and restart `tts` if not |
| Slow replies | Check Groq status at groqstatus.com; verify `GROQ_API_KEY` free-tier limits aren't exhausted |
| WhatsApp not sending | Dashboard → WhatsApp tab shows Meta's error; check `WHATSAPP_TOKEN` validity and template approval status in WhatsApp Manager |
| Login says "not authorized" | Add that Gmail on `/access`, or check `ADMIN_EMAIL` spelling |

This guide covers a Linux/VPS deployment. For the recommended path — a
dedicated on-premise Windows machine the customer owns outright — see the
"Running Priya on the Client's Own Server" field guide instead, and
`scripts\setup-machine.ps1` for the automated setup.
