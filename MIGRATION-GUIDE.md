# Moving Right Agent Group to a New Machine

### Laptop → PC, without losing a lead or breaking a webhook

Everything below is copy-paste. Lines starting with `#` are comments — don't type them.

**Do the whole thing in one sitting.** Between the final backup and the cutover, any
call or WhatsApp message that arrives is lost. Pick a quiet hour.

---

## What actually has to move

Almost nothing lives on the old machine's disk. Uploaded CSVs and PDFs are parsed
straight into Postgres rather than stored as files, and call recordings are Exotel
URLs, not local audio. So the entire state is **the database plus two files**:

| What | Where it is | How it moves |
|---|---|---|
| All leads, calls, WhatsApp history, applications | PostgreSQL | `pg_dump` → `pg_restore` |
| Every secret and API key | `.env` (gitignored — never in the repo) | copy by hand |
| ngrok reserved domain | your ngrok **account**, not the machine | just log in on the PC |
| Whisper speech model (~3GB) | `server/stt-service` cache | don't move it — it re-downloads |
| Everything else | git | `git clone` |

---

## Before you start — check the PC

| | Minimum | Why |
|---|---|---|
| RAM | 16GB (32GB comfortable) | Postgres + Node + Python + Whisper all at once |
| Disk | 40GB free, SSD | ~3GB of that is the speech model |
| GPU | **NVIDIA, 12GB VRAM** | see below — this is the whole reason to move |
| Internet | stable, always on | Groq and Edge TTS are called on every single turn |
| Power | never sleeps | inbound calls arrive at any hour |

### The GPU is the point of this move

Your laptop runs `STT_MODEL=large-v3` with `STT_FORCE_DEVICE=cpu`. That combination
transcribes **10–30 seconds per utterance**. On an NVIDIA GPU the same model runs in
about 2 seconds.

That is the difference between a caller waiting half a minute in silence and a normal
conversation. If the new PC has no NVIDIA GPU, **do not carry `large-v3` over** — see
Step 6.

---

## Step 1 — On the NEW PC: install everything

Install git and clone the repo first, then:

```powershell
PowerShell -ExecutionPolicy Bypass -File scripts\setup-machine.ps1
```

This installs Node, Python and PostgreSQL, creates both Python virtualenvs, installs
npm packages, and creates the empty database schema. It is safe to re-run — every step
skips itself if already done.

Note the PostgreSQL password you set during install. You need it in Step 4.

Also install **ffmpeg** and put it on PATH (the voicebot shells out to it for every
reply), and **ngrok**.

---

## Step 2 — On the OLD laptop: stop everything, take the final backup

Stop the running services first, so nothing writes to the database mid-dump. Close the
`START.ps1` window, then:

```powershell
PowerShell -ExecutionPolicy Bypass -File BACKUP.ps1
```

This writes a timestamped `.dump` into `backups\`. **Take the backup last** — after
this point, treat the laptop as read-only.

---

## Step 3 — Copy these across

Onto a USB stick or a shared folder:

1. `backups\rag_<newest>.dump` — the file you just created
2. `.env` — from the project root

That is the entire payload. Two files.

> **Do not** copy `node_modules`, `.next`, or the Python `venv` folders. They contain
> machine-specific paths and compiled binaries; Step 1 already made fresh ones.

---

## Step 4 — On the PC: restore the database

Put the `.dump` in the project folder, then:

```powershell
pg_restore -U postgres -d right_agent_group --clean --if-exists rag_<newest>.dump
```

If `pg_restore` isn't found, add `C:\Program Files\PostgreSQL\<version>\bin` to PATH.

Verify immediately:

```powershell
npm run db:check
```

This checks every column the code touches actually exists. It must say
**"Schema is fully in sync with the code."** If it lists missing columns, the restore
didn't finish — stop and fix it before going further.

---

## Step 5 — Put `.env` in place

Copy the `.env` you brought over into the project root. Then change **one** line:

```
PG_PASSWORD=<the password you set in Step 1>
```

Everything else carries over unchanged — all the Groq, Google, Exotel and Meta keys
are tied to your accounts, not to the machine.

---

## Step 6 — Point Whisper at the GPU

**This is the step people forget, and it silently costs you everything the new PC was for.**

`.env` currently says:

```
STT_FORCE_DEVICE=cpu
```

**If the PC has an NVIDIA GPU**, change it to:

```
STT_FORCE_DEVICE=cuda
```

**If it does NOT have an NVIDIA GPU**, leave it as `cpu` and also change:

```
STT_MODEL=small
```

`large-v3` on a CPU takes 10–30 seconds per utterance, which is unusable on a live
call. `small` is less accurate but fast enough to hold a conversation. Accuracy you can
work around; half a minute of dead air you cannot.

---

## Step 7 — ngrok

Your reserved domain belongs to your **ngrok account**, not the laptop, so it follows
you. On the PC:

```powershell
ngrok config add-authtoken <your authtoken from dashboard.ngrok.com>
```

`NGROK_DOMAIN` in `.env` already holds the reserved domain. Because the hostname does
not change, **nothing external needs reconfiguring** — the Meta webhook, the Exotel
voicebot applet URL, and the Google OAuth redirect URIs all point at that hostname, not
at the machine.

> ⚠️ **Never run both machines at once.** A free ngrok account allows one agent on a
> reserved domain, and Meta delivers each webhook to exactly one URL. Two voicebots
> would fight over the same calls. Keep the laptop shut down.

---

## Step 8 — Build and start

```powershell
npm run build
```

```powershell
PowerShell -ExecutionPolicy Bypass -File START.ps1
```

That starts, in order: PostgreSQL check → Groq key check → Whisper STT (port 3003) →
TTS (3004) → voicebot (3002) → website (3000) → tunnel.

**First run downloads the ~3GB speech model.** Let it finish before testing.

---

## Step 9 — Verify, in this order

**1. Whisper is actually on the GPU** — the single most important check:

```powershell
curl -H "x-api-key: <WHATSAPP_SERVICE_KEY from .env>" http://127.0.0.1:3003/health
```

Must report `"device":"cuda"` and `"model":"large-v3"`. If it says `"cpu"` and
`"small"`, CUDA isn't wired up — go back to Step 6 and fix it before the demo.

**2. TTS is alive:**

```powershell
curl -H "x-api-key: <WHATSAPP_SERVICE_KEY from .env>" http://127.0.0.1:3004/health
```

**3. Your data came across** — open the dashboard, sign in with Google, and check the
Leads tab shows your real leads and Voice Logs shows past calls. If the login itself
fails, the OAuth redirect URI doesn't match your ngrok domain.

**4. WhatsApp** — the dashboard's WhatsApp tab should show **Connected**. Send a test
message to a verified recipient.

**5. A real test call** — call the ExoPhone number. Listen for: Priya answers, hears
you, replies in the right language, and the reply arrives without a long silence. Check
Voice Logs afterwards for a transcript and a non-zero duration.

**6. Re-run the echo probe.** Echo depends on the audio path, so the laptop's result
does not transfer:

```powershell
$env:VOICEBOT_ECHO_PROBE=1
```

Restart the voicebot, make one call, stay silent through a full reply, and read the
summary. Only enable `VOICEBOT_BARGE_IN=1` if it reports SAFE.

---

## Step 10 — Set up backups on the new machine

The old schedule stayed on the laptop. Recreate it:

```powershell
PowerShell -ExecutionPolicy Bypass -File BACKUP.ps1 -Install
```

Point `backups\` at a Google Drive or OneDrive synced folder, so a dead PC doesn't take
the customer data with it.

---

## If something goes wrong

**The laptop is your rollback.** Don't wipe it until the PC has handled real calls for a
few days. To fall back: shut the PC down, start the laptop, run `START.ps1`. The ngrok
domain returns to it and everything works as before — you'll only lose whatever arrived
while the PC was live.

| Symptom | Cause |
|---|---|
| `db:check` lists missing columns | restore incomplete — re-run Step 4 |
| Google login fails | OAuth redirect URI doesn't match the ngrok domain |
| Priya answers but never responds | STT down, or `WHATSAPP_SERVICE_KEY` mismatch — check `logs\stt.err.log` |
| Long silence before every reply | Whisper on CPU — Step 6 |
| No voice at all | ffmpeg missing from PATH |
| WhatsApp shows Disconnected | `WHATSAPP_TOKEN` expired, or webhook still pointing elsewhere |

Logs live in `logs\` — `stt.err.log` and `voicebot.log` first when calls misbehave.

---

## The short version

```
PC:      clone repo → scripts\setup-machine.ps1 → install ffmpeg + ngrok
Laptop:  stop services → BACKUP.ps1 → copy the .dump and .env
PC:      pg_restore → npm run db:check → drop .env in → fix PG_PASSWORD
PC:      STT_FORCE_DEVICE=cuda   ← do not skip this
PC:      ngrok config add-authtoken → npm run build → START.ps1
PC:      /health says cuda + large-v3 → test call → re-run echo probe
Laptop:  keep it intact for a week
```
