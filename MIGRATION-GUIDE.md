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
| All leads, calls, WhatsApp history, applications, branches | PostgreSQL | `pg_dump` → `pg_restore` |
| Every secret and API key | `.env` (gitignored — never in the repo) | copy by hand |
| ngrok reserved domain | your ngrok **account**, not the machine | just log in on the PC |
| Everything else | git | `git clone` |

> The old Whisper model cache row is gone because the local Whisper service is
> gone — the voice pipeline is 100% cloud (Sarvam STT/TTS), so there is no
> model to move or re-download on the new machine.

---

## Before you start — check the PC

| | Minimum | Why |
|---|---|---|
| RAM | 8GB (16GB comfortable) | Postgres + Next.js + the voicebot, nothing else |
| Disk | 20GB free, SSD | the app is small — no models to store |
| GPU | not needed | STT/TTS are cloud APIs now |
| Internet | stable, always on | Sarvam (STT + TTS) and the LLM are called on every single turn |
| Power | never sleeps | inbound calls arrive at any hour |

### Voice speed is no longer a hardware question

The old laptop ran local Whisper on CPU, which transcribed **10–30 seconds per
utterance** — the whole reason big GPUs mattered. That service is gone: STT and
TTS are Sarvam cloud calls now, so a plain office PC (or a small VPS) keeps call
latency at a couple of seconds. What matters instead is a **stable internet
connection**, because every turn is an API round-trip.

---

## Step 1 — On the NEW PC: install everything

Install git and clone the repo first, then:

```powershell
PowerShell -ExecutionPolicy Bypass -File scripts\setup-machine.ps1
```

This installs Node and PostgreSQL, installs npm packages, and creates the empty
database schema. It is safe to re-run — every step skips itself if already done.
There is no Python step any more: the voice pipeline is 100% cloud.

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

> **Do not** copy `node_modules` or `.next`. They contain
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

## Step 6 — Check the cloud voice keys

The voice pipeline is cloud-only, so the one thing that can silently break the
first call is a missing/expired **SARVAM_API_KEY**. In `.env` verify:

```
SARVAM_API_KEY=<set, and paid up on dashboard.sarvam.ai>
```

`START.ps1` warns at boot if it is missing — don't ignore that line. (The old
`STT_PROVIDER` / `STT_MODEL` / `STT_FORCE_DEVICE` lines are obsolete; the local
Whisper service no longer exists.)

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

That starts, in order: PostgreSQL check → provider key checks → voicebot (3002) →
website (3000) → tunnel. There is no STT/TTS process and no model download — the
cloud providers are prewarmed from the voicebot instead.

---

## Step 9 — Verify, in this order

**1. The voicebot is up and its cloud providers validate:**

```powershell
type logs\voicebot.log | Select-String "pipeline"
```

Must show `STT: Sarvam ... (cloud) | TTS: Sarvam ... (cloud)` (or Cartesia). A
missing Sarvam key would have exited at boot instead.

**2. Your data came across** — open the dashboard, sign in with Google, and check the
Leads tab shows your real leads and Voice Logs shows past calls. If the login itself
fails, the OAuth redirect URI doesn't match your ngrok domain.

**3. WhatsApp** — the dashboard's WhatsApp tab should show **Connected**. Send a test
message to a verified recipient.

**4. A real test call** — call the ExoPhone number. Listen for: Priya answers, hears
you, replies in the right language, and the reply arrives without a long silence. Check
Voice Logs afterwards for a transcript and a non-zero duration.

**5. Re-run the echo probe.** Echo depends on the audio path, so the laptop's result
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
| Priya answers but never responds | Sarvam key missing/expired, or no internet — check `logs\voicebot.log` |
| Long silence before every reply | Sarvam rate limit or slow network — check the STT timings in `logs\voicebot.log` |
| No voice at all | ffmpeg missing from PATH |
| WhatsApp shows Disconnected | `WHATSAPP_TOKEN` expired, or webhook still pointing elsewhere |

Logs live in `logs\` — `voicebot.log` first when calls misbehave.

---

## The short version

```
PC:      clone repo → scripts\setup-machine.ps1 → install ffmpeg + ngrok
Laptop:  stop services → BACKUP.ps1 → copy the .dump and .env
PC:      pg_restore → npm run db:check → drop .env in → fix PG_PASSWORD
PC:      verify SARVAM_API_KEY in .env   ← do not skip this
PC:      ngrok config add-authtoken → npm run build → START.ps1
PC:      voicebot.log shows the cloud pipeline → test call → re-run echo probe
Laptop:  keep it intact for a week
```
