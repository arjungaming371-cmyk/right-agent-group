# Right Agent Group — Client Deployment Guide
### From a blank server to a live AI calling system, step by step

**What you need before starting:**
- A server (client's own machine or VPS) with Ubuntu 22.04 / 24.04, minimum 16GB RAM, an NVIDIA GPU (recommended) or strong CPU, and 40GB free disk
- A domain name pointed at the server's IP (e.g. `console.rightgroupeagent.com` → A record)
- An Exotel account with an ExoPhone number and API access
- A Google account (for creating the login credentials)
- A phone with WhatsApp for the business number

Everything below is copy-paste. Lines starting with `#` are comments — don't type them.

---

## STEP 1 — Base system packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git unzip nginx ffmpeg python3 python3-venv python3-pip postgresql postgresql-contrib
```

Install Node.js 20:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # should print v20.x
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

## STEP 3 — Ollama (the AI brain)

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1:8b
# verify it answers:
ollama run llama3.1:8b "say hello"    # then /bye to exit
```
On a GPU machine, confirm with `ollama ps` during a chat — it should say **100% GPU**.

Fine for development and low call volume. Ollama serves **one conversation at a time** by
design (`OLLAMA_MAX_CONCURRENT` in `.env`) — if you need several simultaneous live calls,
skip to STEP 3b instead.

---

## STEP 3b — vLLM instead of Ollama (only if you need real concurrency)

Use this when you expect **multiple simultaneous live calls** (roughly 5+ at once). vLLM does
continuous batching across in-flight requests, so one GPU serves many concurrent conversations
far more efficiently than Ollama, which was built for single-user/dev use, not a call center.

Skip this step entirely if Ollama (STEP 3) is enough for your call volume — it's the simpler
setup and this app runs on either one without any code changes, just an `.env` switch.

```bash
# On the GPU box (needs a real NVIDIA GPU, 16GB+ VRAM for llama3.1:8b comfortably):
pip install vllm

# Launch the OpenAI-compatible server. --max-num-seqs controls how many
# requests it'll batch together — start around 10-16 and raise it once
# you've load-tested actual latency at that concurrency.
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Meta-Llama-3.1-8B-Instruct \
  --port 8000 \
  --max-num-seqs 16

# verify it's up:
curl http://localhost:8000/v1/models
```

Run it under `pm2` or `systemd` like everything else in STEP 8 — it needs to survive restarts too.

In `.env` on the **app server** (not the GPU box, unless they're the same machine):

```bash
LLM_PROVIDER=vllm
VLLM_URL=http://<gpu-box-ip>:8000
VLLM_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct      # must match --model above exactly
OLLAMA_MAX_CONCURRENT=10                              # raise to match real GPU throughput — start conservative, load-test, raise
```

That's the entire switch — nothing else in the app changes. Confirm it's talking to vLLM (not
Ollama) via the dashboard's system status, or:

```bash
curl -H "Cookie: rag_session=..." https://your-domain.com/api/system/status
# {"ollama":{"running":true,"message":"vLLM ready with meta-llama/Meta-Llama-3.1-8B-Instruct"}, ...}
```

---

## STEP 4 — The project

Copy `right-agent-group_v14.zip` to the server (e.g. with `scp` or any file transfer), then:

```bash
cd ~
unzip right-agent-group_v14.zip
cd right-agent-group
npm install
```

Create the database tables:
```bash
PGPASSWORD='YOUR_PG_PASSWORD' psql -U postgres -h localhost -d right_agent_group -f local-setup.sql
PGPASSWORD='YOUR_PG_PASSWORD' psql -U postgres -h localhost -d right_agent_group -f local-setup-v2.sql 2>/dev/null || true
PGPASSWORD='YOUR_PG_PASSWORD' psql -U postgres -h localhost -d right_agent_group -f 002_phase1.sql 2>/dev/null || true
PGPASSWORD='YOUR_PG_PASSWORD' psql -U postgres -h localhost -d right_agent_group -f 003_auth_whatsapp.sql
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
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_GPU=true              # set false only if no NVIDIA GPU

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

# --- Internal services ---
WHATSAPP_SERVICE_URL=http://127.0.0.1:3001
WHATSAPP_SERVICE_PORT=3001
WHATSAPP_SERVICE_KEY=RUN_openssl_rand_-hex_32
STT_SERVICE_URL=http://127.0.0.1:3003
VOICEBOT_PORT=3002
```

Save (Ctrl+O, Enter, Ctrl+X).

---

## STEP 7 — Build and start the website

```bash
cd ~/right-agent-group
npm run build
pm2 start npm --name web -- start
```

---

## STEP 8 — Start the three helper services

**WhatsApp** — official Meta Cloud API: there is NO local WhatsApp service and NO QR
scan anymore. Follow **SETUP-GUIDE-CLOUD-API.md** to get the 4 Meta values into `.env`
(`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET`) and complete the webhook handshake.

**Voicebot** (the live call engine):
```bash
cd ~/right-agent-group/server
npm install
pm2 start voicebot-server.js --name voicebot
```

**STT service** (speech recognition — first start downloads a ~3GB model, be patient):
```bash
cd ~/right-agent-group/server/stt-service
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
STT_API_KEY=PASTE_YOUR_WHATSAPP_SERVICE_KEY pm2 start "./venv/bin/uvicorn app:app --host 127.0.0.1 --port 3003" --name stt
```
(If the GPU isn't picked up: `./venv/bin/pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` and `pm2 restart stt`.)

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
pm2 list                                  # all 4 green: web, whatsapp, voicebot, stt
curl -s https://YOUR-DOMAIN/api/test      # env + service health report
```

## If something breaks
| Symptom | Fix |
|---|---|
| Website down | `pm2 restart web`, check `pm2 logs web` |
| Priya silent on calls | `pm2 logs voicebot` — usually STT or Ollama down |
| Slow replies | `ollama ps` must say 100% GPU; check `OLLAMA_GPU=true` |
| WhatsApp not sending | Dashboard → WhatsApp tab shows Meta's error; check `WHATSAPP_TOKEN` validity and template approval status in WhatsApp Manager |
| Login says "not authorized" | Add that Gmail on `/access`, or check `ADMIN_EMAIL` spelling |
