# Cloud Voice Guide — deploy Priya on AWS without the local STT/TTS stack

This is the guide for moving the voice pipeline off the self-hosted Python
services (self-hosted Whisper + Edge TTS — what you ran in the demo) onto
cloud APIs, so an AWS deployment needs **no GPU, no Python, no venvs, no
model downloads** — just Node 22, PostgreSQL, ffmpeg, and API keys.

Exotel stays exactly as it is: same Voicebot applet, same WebSocket, same
`?key=` auth. What changes is only what happens INSIDE the voicebot between
"caller stopped talking" and "reply audio goes back".

---

## 1. What the providers are

| Stage | Local (demo) | Cloud option 1 | Cloud option 2 |
|---|---|---|---|
| STT (caller audio → text) | self-hosted faster-whisper (`server/stt-service`, ~3GB model, GPU/CPU) | **Sarvam Saaras** (`saaras:v4`) — `STT_PROVIDER=sarvam` | — |
| TTS (reply text → voice) | self-hosted Edge TTS (`server/tts-service`, free) | **Sarvam Bulbul v3** (`bulbul:v3`, speaker `priya`) — `TTS_CALL_PROVIDER=sarvam` | **Cartesia Sonic** (`sonic-3.6`) — `TTS_CALL_PROVIDER=cartesia` (very high quality) |
| LLM (Priya's brain) | Groq (`llama`/`gpt-oss`, free tier) | **Sarvam-105B-conversations** — `LLM_PROVIDER=sarvam` | Groq remains the default and the fastest |

One Sarvam key (`SARVAM_API_KEY`) covers STT + TTS + LLM. Cartesia needs its
own key plus a voice ID picked from <https://play.cartesia.ai/voices>.

**Why Sarvam STT is a drop-in:** the local Whisper pipeline transcribes into
native Telugu/Devanagari script, then transliterates to Roman script
(Tenglish/Hinglish) with `indic-transliteration`, because the whole
conversation layer — LLM language rules, WhatsApp memory, Lead Brain — is
Roman-script based. Sarvam's Saaras does that natively: `mode=translit`
returns Romanized text directly (`mera phone number hai 9840950950`), 8kHz
telephony audio is accepted as-is, and the sync endpoint takes up to 30s of
audio (the voicebot caps utterances at 15s).

**Why the ffmpeg chain stays:** cloud TTS returns studio-quality WAV at
24kHz — which lands just as quiet on a phone line as Edge TTS did. The
band-pass → compressor → makeup gain → limiter → 8kHz chain in
`server/voicebot-server.js` applies to ALL providers identically. Loudness on
the caller's ear is what carries the voice, and it must not depend on where
synthesis happened.

---

## 2. Recommended configurations

### Recipe A — all Sarvam (one key, one vendor) — `LLM_PROVIDER=sarvam`

```env
STT_PROVIDER=sarvam
TTS_CALL_PROVIDER=sarvam
LLM_PROVIDER=sarvam
SARVAM_API_KEY=<your key>
```

Everything Indian-language runs on one vendor. Trade-off: Sarvam-105B is
slower and paid versus Groq's free tier. Pick this if you want a single
invoice and single-vendor support.

### Recipe B — Sarvam voice + Groq brain (RECOMMENDED)

```env
STT_PROVIDER=sarvam
TTS_CALL_PROVIDER=sarvam
LLM_PROVIDER=groq
GROQ_API_KEY=<your key>
SARVAM_API_KEY=<your key>
```

The voice pipeline (the part that costs GPU money to self-host) goes cloud;
the brain stays on Groq's free tier with the best time-to-first-token. This
is the config the README's latency numbers were measured against.

### Recipe C — Cartesia voice (max voice quality)

```env
STT_PROVIDER=sarvam
TTS_CALL_PROVIDER=cartesia
CARTESIA_API_KEY=<your key>
CARTESIA_VOICE_ID=<voice ID from play.cartesia.ai/voices>
LLM_PROVIDER=groq
GROQ_API_KEY=<your key>
```

Cartesia Sonic supports `en-IN`, `hi-IN` and `te-IN`, so all three of Priya's
languages work. One multilingual voice covers all three — set
`CARTESIA_SPEED` (0.6–1.5) to tune pace. Bulbul (`Recipe B`) has more
distinctly Indian per-language voices; Sonic sounds more neutral-polished.

Mix and match freely — each stage is independent. The dashboard "speak"
button follows via `TTS_PROVIDER` (it shares `SARVAM_API_KEY` /
`CARTESIA_*`, so the dashboard can use the same voice as the calls).

---

## 3. Setup

1. Get keys:
   - Sarvam: <https://dashboard.sarvam.ai> (free credits on signup)
   - Cartesia (only if Recipe C): <https://play.cartesia.ai/keys>, then pick
     a voice at <https://play.cartesia.ai/voices> and copy its ID.
   - Groq (if Recipe B): <https://console.groq.com> — free.
2. Fill `.env` (every var is documented in `.env.example`, section
   "Voice pipeline providers"):
   - `STT_PROVIDER=sarvam` (Sarvam STT defaults: model `saaras:v4`,
     mode `translit` — check <https://docs.sarvam.ai> for the current model
     tag and override `SARVAM_STT_MODEL` if a newer one ships).
   - `TTS_CALL_PROVIDER=sarvam|cartesia` and its vars. Bulbul's default
     speaker is `priya` — on the nose for this agent. Full v3 voice list is
     in Sarvam's TTS docs; override with `SARVAM_TTS_SPEAKER`.
   - `LLM_PROVIDER` + the matching key.
3. Skip the Python services entirely — do NOT create `server/stt-service/venv`
   or `server/tts-service/venv`. `START.ps1` reads the provider settings and
   skips both services automatically (it prints `STT: Sarvam cloud API
   (skipping local Whisper)`). On Linux, just don't start them under pm2.
4. `npm install && npm run db:setup && npm run build`, then start the
   voicebot + website the usual way (`START.ps1` on Windows; on AWS Linux:
   pm2 for `server/voicebot-server.js` and `npm start`).
5. Verify: dashboard → `/api/test` (admin) shows `CALL_STT`, `CALL_TTS`,
   `LLM_PROVIDER` and live test results per stage.

The voicebot fails fast at boot if a provider is selected but its key is
missing — you get `FATAL: STT_PROVIDER=sarvam but SARVAM_API_KEY is not set`
instead of a dead call at 9pm.

---

## 4. What this removes from an AWS deployment

| Was needed for the local stack | Cloud setup |
|---|---|
| GPU EC2 (or slow CPU inference) for Whisper large-v3/small | Not needed — Saaras runs on Sarvam's infra |
| ~3GB model download on every new machine | Not needed |
| Python 3.11 + two venvs (stt-service, tts-service) | Not needed |
| Whisper warm-up + Edge TTS rate-limit babysitting (403/429 retries) | Handled by the provider APIs (the voicebot still retries transient 429/5xx once, and the fixed-line TTS cache still absorbs provider outages for greetings/fallbacks) |
| Memory sizing for Whisper | Just Node + Postgres — a small instance (e.g. 1–2 vCPU / 2–4GB) suffices |

What you still need: Node 22, PostgreSQL 17, ffmpeg (the telephony filter
chain), the named Cloudflare tunnel (or nginx + TLS) for Google login, the
Meta webhook, and Exotel callbacks — that part is unchanged; see
DEPLOYMENT-GUIDE.md.

---

## 5. Cost model (structure, not quotes — check the vendors' pricing pages)

Per minute of talk time, a call spends roughly:

- **STT**: caller speech ≈ 15–25s per minute of call → Saaras prices per
  second/minute of audio (8kHz accepted, so no upsampling cost tricks needed).
- **TTS**: Priya speaks ≈ 15–30s per minute → Bulbul prices per character
  (an average 2-sentence call reply is ~120–200 chars). Cartesia prices per
  character/second similarly.
- **LLM**: Groq is free-tier for this volume; Sarvam-105B is paid per token.
- **Exotel**: unchanged, whatever your ExoPhone plan says.

The comparison that matters: a GPU instance for Whisper (e.g. g4dn/g5 on
AWS) costs its hourly rate 24/7 whether calls come in or not, plus your
setup time. The API route costs strictly per call-minute. Below a few hours
of daily call volume the API route is dramatically cheaper; at high volume,
run both numbers against the vendors' current price sheets.

---

## 6. Behaviour notes & small print

- **Transcript script.** `SARVAM_STT_MODE=translit` (default) returns Roman
  Tenglish/Hinglish — the same format callers' WhatsApp chats use, which is
  exactly what the cross-channel memory expects. `mode=transcribe` would
  return native script; don't switch it unless you have a reason.
- **Language detection.** The voicebot passes the call's known language as a
  recognition hint (same as the Whisper path). Mid-call language switching
  still works — Saaras detects the predominant language per utterance and the
  turn API switches Priya from that. If callers mix languages mid-SENTENCE
  so aggressively that the hint hurts, set `SARVAM_STT_AUTO=1`.
- **Low-confidence gate.** The local Whisper service computed per-segment
  confidence (`low_confidence`) and Priya asked the caller to repeat when it
  dipped. Sarvam's batch response carries no equivalent figure, so that gate
  is effectively off on the cloud path — empty transcripts still trigger the
  clarify line, but garbled-sounding transcripts go to the LLM as-is. In
  practice Saaras on 8kHz telephony audio is more robust than small-whisper
  was; watch Voice Logs after go-live and reconsider if needed.
- **Acronym pronunciation.** The Edge TTS service spelled out `KYC`/`ID` with
  hand-measured separators (see `server/tts-service/app.py`). Bulbul and
  Sonic handle common Indian-English acronyms natively — no equivalent list
  exists for them yet. If a specific acronym sounds wrong, fix it in the
  script editing (dashboard → Script) rather than in code.
- **Prewarm cost.** At boot the voicebot synthesizes every fixed caller-facing
  line (greetings, clarify prompts, fallbacks) into its cache, in all three
  languages — with cloud TTS that's a few dozen tiny API calls per restart
  (trivial cost, and it's what guarantees the caller never hears unexplained
  silence if the provider dies mid-day: the cached lines still play).
- **Rate limits.** All providers throttle. The voicebot already serializes
  synthesis per call and tolerates one transient 429/5xx retry; for
  multi-line concurrent campaigns, check your plan's rate limits.
- **Latency expectation.** Per turn: STT ~0.3–1s (Saaras batch) + brain first
  token + TTS ~0.5–1.5s (Bulbul/Sonic) + ffmpeg (~instant). Compared to the
  local CPU-whisper stack, first-audio latency typically DROPS, because you
  remove the whisper decode step entirely.

---

## 7. Verification checklist

```bash
npm run test:voicebot        # barge-in/echo/playback — provider-independent
node scripts/voice-providers-test.js   # provider config, locales, script guard, payloads
npm run build                # Next.js compile check
```

Then one real call, and check:

- voicebot log prints `STT: Sarvam saaras:v4 mode=translit` / `TTS(sarvam ...)`
  with sane timings;
- `/api/test` shows ✅ for `llm` and `tts`;
- Voice Logs show the transcript in Roman script;
- audio loudness on the line is the same as your local demo (the ffmpeg
  chain guarantees it — if it isn't, check `VOICEBOT_TTS_VOLUME`).
