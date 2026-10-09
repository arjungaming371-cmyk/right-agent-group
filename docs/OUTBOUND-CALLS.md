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

---

## 8. Outpero-grade upgrades (2026-10)

Six changes tuned the outbound stack against the Outpero benchmark (instant
lead calls, code-switched Telugu/Hindi/English, every detail confirmed, WhatsApp
sent before the call ends, auto-retry that actually retries):

**Speed-to-lead** — a NEW lead (dashboard form, CSV, API) is dialed the moment
it is created, while the person is still holding their phone. Fire-and-forget
from `POST /api/leads` through `lib/speed-to-lead.ts`. Guarded by: the
`dialer_settings.speed_to_lead` kill switch (dashboard-tunable, default ON),
the SAME compliance gate as every other dial (DND, Lead-Brain stage, calling
window — outside the window the lead is queued for the window open instead of
dropped), the double-dial guard, and the dual-channel resolver (`auto` =
WhatsApp when callable there, else the phone line). Only NEW leads trigger it;
dedupe-updates of existing leads never auto-dial.

**Retry matrix** — `lib/dialer-logic.ts` no longer treats every failure the
same: `missed`/busy → retry, `voicemail` → retry, `rejected` (WhatsApp
decline) → NEVER auto-retry (Meta revokes call permission after 4 consecutive
unanswered calls — hammering declined dials burns the permission budget),
`failed`/`resolved` → never. The base delay dropped from 120 to **12 minutes**
with a per-attempt backoff (12 → 24 → …), so a busy lead is re-dialed the same
morning, not the same evening.

**Detail readback** — the anti-repetition prompt rules had accidentally
FORBIDDEN confirming anything ("not even as a confirmation question"), so
Priya never verified what she heard. The one-exception CLOSING READBACK is now
explicitly trained into `CALL_BREVITY` (lib/llm.ts): once all details are
gathered, Priya states everything back in one sentence and lets the customer
correct it before the WhatsApp link goes out.

**Spoken-number capture** — a customer who SAYS their phone number
("nine eight seven six five four three two one") produced zero digits in
translit mode, silently skipping the WhatsApp-link completion for the whole
call. Runs of ≥5 spoken digit words (English + common translit variants,
double/triple) now become digits in the STT post-processor
(`voiceProviders.spokenNumbersToDigits`), and `mightBeComplete` accepts them
too.

**STT accuracy** — per-utterance language AUTO-detect is the default
(`SARVAM_STT_AUTO=1`): a Hindi reply inside a Telugu call no longer gets
decoded with a `te-IN` hint. The turn API ships the lead's name + branch brand
words back on every "start" response; the voicebot canonicalizes near-miss
spellings of those tokens per call ("soresh" → "Suresh") before the transcript
reaches Priya or the Lead Brain.

**Smart reschedule** — "రేపు చెప్తాను" / "call me at 6pm" / "कल शाम को call
करना" now books a REAL callback (`leads.callback_at`, visible on the Calendar)
and Priya confirms it out loud before ending the call — the promise used to
live only in the transcript. Manual operator callbacks are never overwritten.
Implementation: `lib/speech-scheduler.ts`, wired into both turn paths.

**Also tuned**: TTS no longer says Telugu "okka minute" in English/Hindi
replies, times ("6:30pm" → "six thirty p m"), ordinals ("2nd") and dates are
spoken naturally, one Romanized keyword no longer flips the whole reply to the
wrong voice (sticky locale, ≥2 keyword rule), auto-retry re-schedules against
the REAL compliance window (not hardcoded 8:00), and the LLM-failure line no
longer re-asks for the name mid-call.

## 9. The Outpero ops layer (2026-10-09): upload, calendar, queue, scripts, assistant

Section 8 made the CALL as good as Outpero's. This section converts the
OPERATOR EXPERIENCE — "hand a whole list over", the script editor, the
auto-reschedule timeline and the HR-style assistant — into Right Agent
Group's stack.

**Lead upload — the sheet is the script.** Every CSV column that is not a
native column (city, budget, plan, campaign, referred_by, …) is captured
into `leads.custom_fields` / `outbound_queue.custom_fields` JSONB (migration
`2026-10-09_lead_custom_fields`). The Upload console adds a paste-a-list box
(`Name, 98765 43210` per line, bare numbers fine) and a CSV template
download; the review modal shows each lead's sheet data as chips and reports
duplicates/invalid counts. The Upload console is still parse-only — dialing
starts from the Confirm + Start Calling, exactly as before.

**Script Studio (Scripts → Campaign Studio).** The Outpero Script Editor,
Priya-fied: write ONE campaign brief with `{name}`-style merge fields
(canonical lead columns + every custom CSV column ever uploaded), see a live
preview against a sample Hyderabad lead (typos stay visible; the dialer
strips leftover braces so nothing is ever read aloud), and either write it
yourself or generate a complete structured brief (OPENING → DISCOVERY →
PITCH → CAPTURE → READBACK → CLOSE → HARD RULES) with AI in Tenglish /
Hinglish / English. Saved as the `campaign_template` ai_scripts row; the
Upload and Call Queue consoles load it with one click as the campaign
agenda. Implementation: `lib/script-studio.ts` (pure), `/api/script-studio`.

**Dial-time personalization.** `renderInstructionsForLead()` is the single
choke point: when the campaign runner or speed-to-lead dials, `{merge_fields}`
resolve against the lead row + its sheet data, and any lead with custom data
gets a `LEAD DATA ON FILE (use it, never re-ask)` fact sheet appended even to
a plain agenda — the "Hi Ramesh, about your Home Loan in Kukatpally" opener
Outpero demos, inside Priya's persona and safety rules.

**Calendar — the auto-reschedule timeline.** A missed/voicemail call that the
retry engine re-queues now also writes a callback event on the Calendar
("Auto-retry scheduled: <name>", `created_by='retry_engine'`, idempotent per
retry attempt) — "10:00 AM Call 1 (busy) → auto-scheduled 10:12 AM" is a
visible, reschedulable appointment; rescheduling/cancelling it drives the
queue row through the existing bidirectional sync. Customer-promised
callbacks are separate rows and are never clobbered.

**Call queue — hot leads.** "Boost to Front" (selection toolbar) bumps
pending rows to priority 100 — the atomic claim dials them ahead of the
entire backlog on the next campaign tick.

**Assistant — Brief Priya.** The Ops Commander gained the Swara-HR flow:
"write a campaign script for our balance-transfer push" produces a complete
`{merge_field}` brief and proposes `update_campaign_template` (admin
approves → saved into the Studio); "call Ramesh now" proposes
`queue_lead_call` (compliance-gated queueing, `priority: urgent` = front of
the queue); "schedule a callback tomorrow 6pm" proposes `update_lead` with
`callback_at`. Everything else stays proposal + Approve & Execute.
