# Outbound Calling — the complete machine (Phone + WhatsApp)

One document, the whole picture. If you have ever asked "I placed an outbound
call — what exactly happens now, and where do I see the result?", this is the
answer. Every statement here matches the code as of 2026-09-26.

---

## 1. The one decision that matters: which channel?

| Situation | Channel | Why |
|---|---|---|
| Cold lead, never called you | **Phone** (Exotel) — or ASK first | WhatsApp business-initiated calls need Meta call permission the lead never gave. Phone needs nothing but DND clearance. To go WhatsApp instead: send a call-permission request (`POST /api/whatsapp/call-permission`, or the shield button on the WhatsApp Calls tab) — inside the 24h service window it is a free-form interactive message; the lead taps **Allow**, and the channel unlocks. |
| Lead called your WhatsApp number in the last 30 days | **WhatsApp** (callback) | Meta grants implicit callback permission — calling them back is allowed and lands in the app they already used, for FREE. The WhatsApp Calls tab's teal button does exactly this. |
| Lead accepted a call-permission request | **WhatsApp** | Explicit Meta permission (interactive `call_permission_request` → webhook `call_permission_reply`). Requests expire after 7 days, and 4 consecutive unanswered calls revoke the permission — Meta's rule, not ours. |
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
  terminate event arrives for an outbound call that never talked. Meta's
  terminate `status` may be a single string OR an array of the statuses the
  call went through (`["Failed", "Completed"]`) — `mapCallOutcome` scans
  every entry with priority (completed > rejected > failed), so a talked
  call can never be finalized as a miss.
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
dials per row channel (`phone` / `whatsapp_voice` / `auto`), in bounded
concurrency, with per-row compliance skipping (`skipped_dnd`,
`skipped_outside_window`, …) written on the queue row.

Queue statuses: `pending → dialing → called | failed | skipped_*`.

### Talking points — "What should Priya talk about?" (2026-10-01)

Every queue row carries `talking_points` — the operator's agenda for the
call. It is stamped at queueing time (CSV confirm modal / Add Single Number
send one campaign-level text with the contacts), or across every pending row
when a campaign starts (`Start Campaign` textarea on the Call Queue view and
the Upload console → `POST /api/outbound/process {action:"start",
talking_points}` — a new offer can be pushed to an existing queue without
re-uploading the CSV). Left blank at start, rows keep what they were queued
with. The runner forwards the row's text to `placeOutboundCall({instructions})`,
which persists it on the voice_calls row — from there the EXISTING brain path
(`/api/calls/turn` → `buildTurnInstructions`) feeds it to Priya EVERY TURN on
both channels, framed as "WHAT THIS CALL IS ABOUT" with a never-recite-verbatim
rule. "Dial now" on a queue row sends the same agenda through `/api/calls/dial`.
Migration: `2026-10-01_queue_talking_points.sql` (`outbound_queue.talking_points`).

Cold WhatsApp calls are Meta-gated per user, so CSV campaigns default to
phone; `whatsapp_voice`/`auto` rows fall back to phone when Meta refuses
(the DialError text is stamped on the row's `outcome_detail`).

### Outcome feedback loop (2026-10-01)

`called` on a queue row means **dialed**, not answered. The REAL result is
stamped onto the row by `lib/queue-outcome.ts` from the two terminal
webhooks — Exotel `/api/calls/status` and the WhatsApp `terminate` event —
as `outcome` (resolved / missed / rejected / failed) + `outcome_at` +
`outcome_detail` (the raw provider status or Meta's rejection text). A
dial-time failure (DialError) stamps `failed` with the operator-facing
reason immediately. First report wins (idempotent under webhook retries);
re-queue / reset-failed / auto-redial clear the stamp so the next attempt
starts clean. The Call Queue view shows the verdict as a chip under the
status, the Campaign Radar splits "dialed" into answered / no-answer /
declined / in-flight, and the CSV export carries the three columns.
Deployment needs `node scripts/run-migrations.js` once
(`2026-10-01_call_queue_outcomes.sql` — also backfills existing campaigns
from voice_calls).

The auto-redial fix in the same change: the WhatsApp terminate path used to
pass a hardcoded `duration: 0` into the requeue decision even though the
voicebot had already reported real talk time — an odd terminate status
mapped to "missed" could re-queue a customer Priya had JUST finished
talking to. The real duration is read from the voice_calls row first now.

---

## 6. Failure modes — "my dial did nothing" checklist

| Symptom | Actual cause | Where to look |
|---|---|---|
| Toast: "lead not found" / "another branch" | scope mismatch | dial route response |
| Toast: compliance reason | DND / do-not-call / window | lead compliance panel |
| Toast: quota | branch monthly cap | branches → usage |
| WhatsApp dial → Meta error text | no call permission for that user, or Business Calling disabled on the WABA number (Graph 138006 at WABA level) | toast + app logs; ask permission (shield button / POST /api/whatsapp/call-permission) or fall back to phone |
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
pm2 restart all`. Talking points need one migration:
`node scripts/run-migrations.js` (adds `outbound_queue.talking_points`).
