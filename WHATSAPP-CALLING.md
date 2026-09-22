# WhatsApp Voice Calling — Setup Guide

Customers can now call the business's WhatsApp number and **Priya answers
automatically** — the same AI agent that handles Exotel phone calls, running
over WhatsApp. One brain, two networks:

| | Exotel (phone calls) | WhatsApp Calling |
|---|---|---|
| Audio | PSTN phone line (8 kHz) | WhatsApp WebRTC (wideband, 48 kHz) |
| STT | Sarvam Saaras | Sarvam Saaras (same) |
| LLM (Priya) | Groq via `/api/calls/turn` | Groq via `/api/calls/turn` (same) |
| TTS | Sarvam Bulbul / Cartesia (`TTS_CALL_PROVIDER`) | **Cartesia Sonic** (default), Sarvam fallback |
| Cost | per-minute airtime | **FREE** — Meta charges only for business-initiated calls, and this integration is inbound-only by design |
| Logs | Voice Logs | Voice Logs (tagged **WhatsApp**) + a call row in the WhatsApp chat |

Nothing about the message bot changes: texts, media, reactions and
follow-ups keep working exactly as before, calls ride the same webhook.

---

## 1. Enable voice calling on the WhatsApp number (Meta dashboard)

1. **Meta Developer Console** → your app → **WhatsApp → Configuration →
   Phone Numbers → Manage Phone Numbers**
2. Select the business number → **Calls** tab → enable **Allow voice calls**
3. Save.

Requirements / gotchas:

- The number must be **registered/connected** (status "Connected" in WhatsApp
  Manager). On an unverified test number the Calls tab doesn't appear —
  register the number first (`POST /<PHONE_NUMBER_ID>/register` with a 2FA
  pin), or use a production number.
- Business verification is required for production calling.
- Meta's US-based **test numbers are restricted from calling users in some
  countries** (error 130497). Test from a number/customer in a supported
  country.

## 2. Subscribe the webhook to the `calls` field

The webhook URL does **not** change — Meta sends call events to the same
`/api/whatsapp` endpoint that already receives messages:

1. **WhatsApp → Configuration → Webhooks**
2. Under **Webhook fields**, additionally enable **`calls`**
3. Verify + save. (Keep the existing messages/fields enabled.)

Signature verification, dedupe and the 200-fast contract are shared with the
message path — no extra webhook setup.

## 3. Server configuration (.env)

```ini
# Voice pipeline for WhatsApp calls
CARTESIA_API_KEY=...            # console.cartesia.ai
CARTESIA_VOICE_ID=...           # pick at https://play.cartesia.ai/voices
VOICEBOT_WA_TTS_PROVIDER=cartesia   # default; "sarvam" flips the channel back

# Bridge between the app and the voicebot (both processes, same machine)
VOICEBOT_HTTP_PORT=3003             # voicebot side
VOICEBOT_INTERNAL_URL=http://127.0.0.1:3003   # app side

# Optional tuning
VOICEBOT_WA_BARGE_IN=1                              # default on (safe: client-side AEC)
VOICEBOT_WA_ENERGY_THRESHOLD=300                    # endpointing sensitivity
VOICEBOT_WA_ICE_SERVERS=stun:stun.l.google.com:19302
WHATSAPP_VOICE_CALLS=1                              # 0 = decline all WhatsApp calls
```

`WHATSAPP_SERVICE_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and
`WHATSAPP_APP_SECRET` are already required by the message bot — the calling
path reuses them. If `CARTESIA_API_KEY` is missing, WhatsApp calls
automatically fall back to Sarvam TTS instead of failing.

## 4. Install + restart the voicebot

```bash
cd server
npm install        # adds: werift (pure-JS WebRTC), @discordjs/opus (codec)
pm2 restart voicebot   # or: node voicebot-server.js
```

On startup the voicebot logs the bridge line:

```
WhatsApp calling bridge on http://127.0.0.1:3003 — STT: Sarvam Saaras (cloud) | LLM: via app /api/calls/turn | TTS: Cartesia (default) | barge-in: on | ICE: stun:stun.l.google.com:19302
```

Health check: `curl http://127.0.0.1:3003/health` → `{"ok":true,"activeCalls":0}`

Networking notes:

- The voicebot's WhatsApp bridge binds to **127.0.0.1** — nothing to expose
  in nginx; only the Next.js app talks to it.
- WebRTC media uses **UDP** directly from the voicebot process to Meta's
  media servers. On AWS, allow outbound UDP (default security groups do) and
  ensure the instance has a public IP. STUN is configured by default; no TURN
  relay is needed for this topology.
- The app must be able to reach `VOICEBOT_INTERNAL_URL` (same box → works
  out of the box).

## 5. Test

1. From a customer WhatsApp account, tap the **call button** on the business
   number's chat.
2. Within a second or two the call should connect and Priya greets (the
   same greeting rules as Exotel: lead language, branch voice).
3. Speak — she runs the full conversation loop (lead capture, EMI,
   eligibility, form link). Barge-in is on: talk over her and she stops.
4. Hang up. Expect in the dashboard:
   - **Voice Logs**: a new row (tagged WhatsApp when the lead's source is
     `whatsapp_call`), real duration, transcript, sentiment, AI summary.
   - **WhatsApp chat**: a centered call row (`📞 Voice call · 2m 14s`) —
     missed/declined calls show red and bump the unread badge.
   - Follow-ups: completed calls with real conversation → `call_followup`
     template; missed → `missed_call_followup` (same once-per-call guard as
     Exotel calls).
   - **comm_logs**: the call + follow-up entries; **Lead Brain** runs its
     post-call analysis.

Logs to watch (pm2 logs voicebot / app):

```
📞 WhatsApp voice call connect from=***4321 ...
✅ WhatsApp call accepted (***xxxxxxxx) — Priya is live on WhatsApp
⏱ wa brain (time to first sentence): 612ms
⏱ wa TOTAL turn (silence → reply fully sent): 2871ms
📴 WhatsApp call terminate ... outcome=resolved
```

## How a call flows (for developers)

```
customer → Meta SFU ──webhook "calls" (connect + SDP offer)──▶ /api/whatsapp
                                                                │
                                       POST /whatsapp/connect   │  (loopback, service key)
                                           ▼                    │
                                    voicebot: werift answers ──▶ answer SDP
                                           │                    │
                        ◀── pre_accept + accept (Graph /calls) ──┘
                                           │
              RTP/opus 48 kHz ◀═══ SRTP media ═══▶ Meta SFU
                                           │
   Sarvam STT ◀─ endpointing ◀─ opus decode ┘
        │
   /api/calls/turn  (Groq = Priya, DB, Lead Brain)  → sentences (NDJSON stream)
        │
   Cartesia TTS → WAV 24 kHz → 48 kHz → opus encode → RTP pacer (20 ms)
```

Key files:

| File | Role |
|---|---|
| `server/whatsapp-calls.js` | WebRTC answer + per-call session (endpointing, barge-in, TTS pipeline, duration report) |
| `server/voicebot-server.js` | mounts the loopback HTTP bridge (`/whatsapp/connect`, `/whatsapp/terminated`, `/health`) |
| `app/api/whatsapp/route.ts` | `calls` field handling: bridge, pre_accept/accept, terminate finalize |
| `lib/whatsapp.ts` | Graph API call control (`answer/reject/terminateWhatsAppCall`) |
| `lib/whatsapp-call-finalize.ts` | post-call flow (bubble row, follow-ups, sentiment, summary, Lead Brain) |
| `app/api/calls/turn/route.ts` | unchanged contract + `branchId`/`source` passthrough for WhatsApp calls |

## Outbound (business-initiated) WhatsApp calls — deliberately not implemented

Meta requires a **call-permission template** flow before a business may ring
a customer (the customer must accept a consent template), pricing is
per-minute, and the user experience is heavier. Inbound calls are free and
are this business's actual flow, so the integration is inbound-only. The
call-control helpers in `lib/whatsapp.ts` (`terminateWhatsAppCall`) and the
voicebot's session registry already cover what an outbound flow would need
if it's ever added.
