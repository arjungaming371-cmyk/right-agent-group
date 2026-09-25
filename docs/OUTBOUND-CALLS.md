# Outbound Calling — the complete machine (Phone + WhatsApp)

One document, the whole picture. If you have ever asked "I placed an outbound
call — what exactly happens now, and where do I see the result?", this is the
answer. Every statement here matches the code as of 2026-09-26.

---

## 1. The one decision that matters: which channel?

| Situation | Channel | Why |
|---|---|---|
| Cold lead, never called you | **Phone** (Exotel) | WhatsApp business-initiated calls require Meta call permission the lead never gave. Phone needs nothing but DND clearance. |
| Lead called your WhatsApp number in the last 30 days | **WhatsApp** (callback) | Meta grants implicit callback permission — calling them back is allowed and lands in the app they already used. |
| Lead accepted a call-permission request (template flow) | **WhatsApp** | Explicit Meta permission. |
| You are not sure | **Smart Dial** (`auto`) | The code checks the WhatsApp-call history itself: callback-eligible → WhatsApp, else → phone. The toast tells you what it picked. |

That logic lives in **one place**: `POST /api/calls/dial`
(`app/api/calls/dial/route.ts`). Every outbound entry point in the dashboard
(Leads table call modal — Phone / WhatsApp / Smart Dial buttons, the WhatsApp
Calls tab "call back" button) goes through it, so compliance, quota, logging
and instructions behave identically on every path.

```
                ┌────────────────────────────┐
dial request ──▶│  POST /api/calls/dial      │
{leadId,        │  auth → branch scope       │
 channel,       │  compliance (fail-closed)  │
 instructions}  │  branch quota → usage      │
                └──────────┬─────────────────┘
                           │ channel resolution
        ┌──────────────────┴───────────────────┐
        ▼                                      ▼
   whatsapp                                phone (Exotel)
   1. voicebot holds werift OFFER          1. makeCall → Exotel rings the
   2. Graph action=connect                    lead, bridges to the voicebot
      (Meta rings the lead's WhatsApp)     2. voice_calls row (initiated)
   3. register call_id → offer             3. Exotel status webhook →
   4. voice_calls row (ringing)               terminal status + recording
   5. answer SDP webhook → live            4. follow-up WhatsApp template
   6. terminate webhook → terminal            on resolve/miss
      status + bubble + follow-up
```

Hard kill switch: `WHATSAPP_OUTBOUND_CALLS=0` disables the whatsapp/auto
WhatsApp leg (phone keeps working) for deployments that have not enabled
Business Calling on their WABA number.

---

## 2. Gating order (why a dial can be refused)

`/api/calls/dial` refuses in this exact order — the error message tells you
which gate fired:

1. **Auth** — voice-module session, roles admin / agent / branch_manager.
2. **Lead scope** — branch-scoped users can only dial their own leads.
3. **Compliance** (`checkCallCompliance`, fail-CLOSED) — do-not-call flags,
   DND, calling-window rules.
4. **Branch quota** — monthly call cap per branch.
5. **Channel availability** — WhatsApp disabled via env, or Meta rejects the
   connect (Meta's raw error text is surfaced verbatim; the usual cause is
   missing call permission for that user).

Every accepted dial also writes a `comm_logs` row
("Outbound … call initiated to …") on the lead's timeline, and the optional
"What should Priya talk about?" text is stored on the call row and fed to
Priya on every turn — on BOTH channels.

---

## 3. Status lifecycle (what each status means and who writes it)

### Phone (Exotel)

| status | meaning | written by |
|---|---|---|
| `initiated` | dialed, not yet answered | `/api/calls/dial` |
| `in-progress` | customer picked up, Priya talking | voicebot → `/api/calls/turn` start |
| `completed` | hung up after connecting | Exotel status webhook / turn end |
| `busy` / `no-answer` / `failed` | outcome of the ring | Exotel status webhook |

### WhatsApp (business-initiated)

| status | meaning | written by |
|---|---|---|
| `ringing` | Meta is ringing the lead's WhatsApp | `/api/calls/dial` (pre-dial) |
| `in-progress` | they answered, negotiation done, Priya live | turn start |
| `completed` | talked, then hung up | voicebot end-report |
| `no-answer` | never picked up (also: terminate webhook lost > 15 min) | WhatsApp finalizer / self-healing sweep |
| `rejected` | lead explicitly declined | WhatsApp finalizer |
| `failed` | network/carrier failure | WhatsApp finalizer |

Terminal-status guarantees (the "ghost Ringing forever" bug class):

- `lib/whatsapp-call-finalize.ts` writes the terminal status whenever a
  terminate event arrives for an outbound call that never talked.
- `GET /api/calls` runs a once-a-minute self-healing sweep that promotes any
  `ringing/initiated` outbound WhatsApp row older than 15 minutes to
  `no-answer` — a lost webhook can no longer leave a call "Ringing" forever.

Where you SEE each of these: **Voice Logs** (all calls, outcome column),
**WhatsApp → Calls tab** (WhatsApp calls only, missed painted red),
**lead's Comm Log** (initiated → result trail), **WhatsApp chat**
(call bubble on the correct side: our dials are outgoing).

---

## 4. Scripts — what Priya says on an outbound call

The body of every conversation is the live script (dashboard → Script
Manager, seeded from `lib/default-scripts.ts`) plus per-channel length rules
(`lib/llm.ts`). What this repo adds is the FIRST LINE, chosen by context:

| Context | Opener source (`lib/voice-conversation.ts`) |
|---|---|
| Outbound phone, first call | `GREETINGS` / personalized by name — intro + open floor |
| Outbound phone, repeat call | `RETURNING_GREETINGS` — "following up on your loan interest" |
| **Outbound WhatsApp callback, first call** | `WA_CALLBACK_GREETINGS` — "you had reached out to us on WhatsApp earlier, so I'm calling you back" |
| Outbound WhatsApp, repeat call | `RETURNING_GREETINGS` |
| Inbound (either network) | `INBOUND_GREETINGS` — receptionist, not telemarketer |

The WhatsApp-callback opener exists because the lead called us first —
opening with the cold pitch on a callback sounds like Priya does not know
who she is calling. Openers are written in native script (Telugu/Devanagari)
so the TTS voice stays consistent for the whole call.

Language resolution: lead's language → mid-call auto-switch from the
transcript (`resolveSpokenLanguage`) → persisted on the call row AND the
lead.

After the call: resolved+talked → `sendCallFollowUp` template; missed →
`sendMissedCallFollowUp` ("we tried calling you"); failed → nothing. Exactly
once per call, atomically claimed (`followup_sent`).

---

## 5. Campaign queue (bulk dialing)

`POST /api/outbound {contacts:[…]}` (CSV upload) → `outbound_queue` rows
`pending`. `POST /api/outbound/process` (admin/branch_manager) claims rows
**atomically** (`FOR UPDATE SKIP LOCKED`, 10-min reaper for crashed runs) and
dials phone only, in bounded concurrency, with per-row compliance skipping
(`skipped_dnd`, `skipped_outside_window`, …) written on the queue row.

Queue statuses: `pending → dialing → called | failed | skipped_*`.

Why the queue is phone-only by design: a CSV campaign is cold outreach, and
cold WhatsApp calls are Meta-gated per user. WhatsApp outbound is for
*callbacks* — which the unified dialer handles one lead at a time.

---

## 6. Failure modes — "my dial did nothing" checklist

| Symptom | Actual cause | Where to look |
|---|---|---|
| Toast: "lead not found" / "another branch" | scope mismatch | dial route response |
| Toast: compliance reason | DND / do-not-call / window | lead compliance panel |
| Toast: quota | branch monthly cap | branches → usage |
| WhatsApp dial → Meta error text | no call permission for that user, or Business Calling disabled on the WABA number | toast + app logs; fall back to phone |
| WhatsApp dial → "voicebot did not return a call offer" | voicebot (pm2) down | `pm2 status`, voicebot logs |
| WhatsApp row stuck "Ringing" (old rows) | pre-fix data or lost webhook — sweep self-heals after 15 min | Voice Logs, app logs |
| Phone call, no status update | `EXOTEL_WEBHOOK_KEY` missing → makeCall refuses at dial time | app logs at dial time |

---

## 7. Environment

| Variable | Effect |
|---|---|
| `WHATSAPP_OUTBOUND_CALLS=0` | disable WhatsApp leg of outbound (phone still works) |
| `VOICEBOT_WA_OUTBOUND_TTL_MS` | how long a held WebRTC offer survives without an answer (default 180000) |
| `EXOTEL_SID/API_KEY/API_TOKEN/CALLER_ID/FLOW_APP_ID` | phone channel credentials + voicebot flow |
| `EXOTEL_WEBHOOK_KEY` | REQUIRED for status callbacks to be accepted (fail-closed) |
| `NEXT_PUBLIC_APP_URL` | base URL Exotel calls back to |

Deployment after pulling this code: `git pull && npm install (root) &&
pm2 restart all`. No DB migration is required — every feature here uses
existing columns.
