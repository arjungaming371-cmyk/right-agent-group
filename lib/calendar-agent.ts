// Autonomous Calendar Agent (lib/calendar-agent.ts)
//
// Discovers appointments, branch visits, callbacks, document deadlines,
// and follow-ups across Voice Calls, WhatsApp, Call Queue, and Leads CRM.
//
// Safeguards enforced:
//   1. AI confidence grading (high -> auto-confirmed, medium/low -> needs_review queue)
//   2. Categorization: branch_visit (in-person, never dials), callback (links with Call Queue),
//      document_deadline (WhatsApp reminder eligible), reminder.
//   3. Temporal resolution relative to the source conversation timestamp (sourceAt in IST).
//   4. Idempotency & deduplication: unique source constraint prevents duplicate events.
//   5. Bidirectional sync with outbound_queue and leads.callback_at.

import { query, withTransaction } from "./db"
import { runCompletion } from "./llm"
import { normalizePhone, phoneLast10 } from "./phone"

// Concurrency guard: prevents simultaneous execution of extraction for the same call
const activeCallLocks = new Set<string>()

export type CalendarEventType = "branch_visit" | "callback" | "document_deadline" | "reminder"
export type CalendarChannel = "in_person" | "phone" | "whatsapp_voice" | "whatsapp_text"
export type CalendarConfidence = "high" | "medium" | "low"
export type CalendarStatus = "confirmed" | "needs_review" | "completed" | "rescheduled" | "cancelled"

export type DiscoveredEvent = {
  title: string
  eventType: CalendarEventType
  eventAt: string // ISO string
  endAt?: string | null
  location?: string | null
  channel: CalendarChannel
  confidence: CalendarConfidence
  confidenceScore: number
  status: CalendarStatus
  reviewReason?: string | null
  rawQuote: string
  notes?: string | null
  sourceType: "voice_call" | "whatsapp_message" | "outbound_queue" | "leads_crm" | "manual"
  sourceId: string
  sourceAt: string // ISO string
  leadId?: string | null
  leadName?: string | null
  leadPhone?: string | null
  branchId?: string | null
  outboundQueueId?: string | null
}

export type CalendarEventRow = {
  id: string
  lead_id: string | null
  title: string
  event_type: CalendarEventType
  event_at: string
  original_event_at: string
  end_at: string | null
  location: string | null
  channel: CalendarChannel
  confidence: CalendarConfidence
  confidence_score: number
  status: CalendarStatus
  review_reason: string | null
  raw_quote: string | null
  source_type: string
  source_id: string | null
  source_at: string
  outbound_queue_id: string | null
  branch_id: string | null
  notes: string | null
  reminder_enabled: boolean
  reminder_status: string
  reminder_sent_at: string | null
  reminder_error: string | null
  created_by: string
  created_at: string
  updated_at: string
  // Joined fields
  lead_name?: string | null
  lead_phone?: string | null
}

const TEMPORAL_KEYWORDS = [
  "today", "tomorrow", "repu", "nedu", "morning", "evening", "afternoon",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "somavaram", "mangalavaram", "budhavaram", "guruvaram", "sukravaram", "sanivaram", "adivaram",
  "next week", "next month", "meeting", "visit", "appointment", "call back", "remind",
  "gym", "branch", "office", "documents", "upload", "submit", "vastha", "kalustha", "matladadam"
]

function hasTemporalIntent(text: string): boolean {
  if (!text || text.length < 15) return false
  const lower = text.toLowerCase()
  return TEMPORAL_KEYWORDS.some((kw) => lower.includes(kw))
}

const IST_OFFSET_MS = 5.5 * 3600 * 1000

function formatIstContext(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  const dayName = weekdays[ist.getUTCDay()]
  const day = ist.getUTCDate()
  const monthName = months[ist.getUTCMonth()]
  const year = ist.getUTCFullYear()
  const h24 = ist.getUTCHours()
  const m = ist.getUTCMinutes().toString().padStart(2, "0")
  const ampm = h24 >= 12 ? "PM" : "AM"
  const h12 = h24 % 12 || 12
  return `${dayName}, ${day} ${monthName} ${year} at ${h12}:${m} ${ampm} IST`
}

/**
 * AI Calendar Extraction Engine:
 * Analyzes conversation text and resolves relative dates strictly against sourceAt in IST.
 */
export async function extractCalendarEventsFromText(opts: {
  conversationText: string
  sourceAt: Date
  sourceType: "voice_call" | "whatsapp_message"
  sourceId: string
  leadId?: string | null
  leadName?: string | null
  leadPhone?: string | null
  branchId?: string | null
}): Promise<DiscoveredEvent[]> {
  const { conversationText, sourceAt, sourceType, sourceId, leadId, leadName, leadPhone, branchId } = opts

  if (!hasTemporalIntent(conversationText)) {
    return []
  }

  const istDateString = formatIstContext(sourceAt)

  const prompt = `Return ONLY valid JSON, no markdown code blocks, no other text.

You are the Autonomous Calendar & Scheduling Extraction Agent for Right Agent Group (lending platform in Hyderabad, India).
Analyze the customer conversation below.

CONVERSATION ANCHOR TIMESTAMP (CRITICAL):
This conversation occurred on: ${istDateString} (${sourceAt.toISOString()}).

YOUR OBJECTIVE:
Identify whether the customer and AI agent agreed on or requested any future appointment, branch visit, phone callback, document submission deadline, or reminder.

EVENT CLASSIFICATION:
1. "branch_visit": Customer or agent confirmed an in-person physical meeting at a branch, office, or specific location. (Location MUST be extracted).
2. "callback": Customer or agent confirmed a telephone / WhatsApp voice call at a specific future date/time.
3. "document_deadline": Customer promised to submit or upload documents by a specific date/time.
4. "reminder": Customer asked for a reminder before an event (e.g., "call me Monday-Wednesday to remind me before Thursday").

TEMPORAL RESOLUTION RULES:
- All relative dates ("tomorrow", "next Thursday", "repu", "Monday morning") MUST be resolved relative to the ANCHOR DATE above (${istDateString}).
- Output exact ISO 8601 strings in UTC format (e.g., "2026-10-15T05:30:00.000Z" for 11:00 AM IST).
- If the time is approximate (e.g. "morning" -> 10:00 AM IST, "afternoon" -> 3:00 PM IST, "evening" -> 5:00 PM IST).
- Never set a date that occurred before the conversation anchor date.

CONFIDENCE RULES:
- "high" (score 0.85 - 1.0): An unambiguous date/time and commitment was explicitly agreed by both parties.
- "medium" (score 0.60 - 0.84): Clear intent was stated, but the exact time is approximate or conditional (e.g. "call me sometime Monday"). Requires human review.
- "low" (score 0.20 - 0.59): Tentative or speculative statement (e.g. "maybe I can visit", "I might come next week"). Requires human review.

JSON OUTPUT STRUCTURE:
{
  "events": [
    {
      "title": string,
      "event_type": "branch_visit" | "callback" | "document_deadline" | "reminder",
      "event_at": string, // ISO 8601 UTC timestamp
      "location": string or null,
      "channel": "in_person" | "phone" | "whatsapp_voice" | "whatsapp_text",
      "confidence": "high" | "medium" | "low",
      "confidence_score": number,
      "review_reason": string or null,
      "raw_quote": string, // Exact quote evidence from conversation
      "notes": string
    }
  ]
}

If no appointment or time commitment exists, return {"events": []}.`

  try {
    const raw = await runCompletion(
      [
        { role: "system", content: prompt },
        { role: "user", content: `CUSTOMER CONVERSATION:\n\n${conversationText.slice(0, 5000)}` },
      ],
      { timeoutMs: 20000, temperature: 0.1, numPredict: 1000, json: true }
    )

    const parsed = JSON.parse(raw || "{}")
    const rawEvents: any[] = Array.isArray(parsed?.events) ? parsed.events : []
    const validated: DiscoveredEvent[] = []

    for (const ev of rawEvents) {
      if (!ev.title || !ev.event_type || !ev.event_at) continue

      const eventDate = new Date(ev.event_at)
      if (isNaN(eventDate.getTime())) continue

      let confidence: CalendarConfidence = ["high", "medium", "low"].includes(ev.confidence) ? ev.confidence : "medium"
      let confidenceScore = Number(ev.confidence_score) || (confidence === "high" ? 0.9 : 0.7)
      let reviewReason = ev.review_reason || null

      // Guard: if event is in the past relative to the conversation
      if (eventDate.getTime() < sourceAt.getTime() - 60000) {
        confidence = "low"
        confidenceScore = 0.3
        reviewReason = `Resolved date (${eventDate.toISOString()}) is before conversation timestamp`
      }

      const status: CalendarStatus = confidence === "high" ? "confirmed" : "needs_review"

      validated.push({
        title: String(ev.title).slice(0, 150),
        eventType: ev.event_type,
        eventAt: eventDate.toISOString(),
        endAt: new Date(eventDate.getTime() + 30 * 60000).toISOString(),
        location: ev.location ? String(ev.location).slice(0, 200) : null,
        channel: ["in_person", "phone", "whatsapp_voice", "whatsapp_text"].includes(ev.channel) ? ev.channel : "phone",
        confidence,
        confidenceScore,
        status,
        reviewReason,
        rawQuote: String(ev.raw_quote || "").slice(0, 300),
        notes: ev.notes ? String(ev.notes).slice(0, 300) : null,
        sourceType,
        sourceId,
        sourceAt: sourceAt.toISOString(),
        leadId: leadId || null,
        leadName: leadName || null,
        leadPhone: leadPhone || null,
        branchId: branchId || null,
      })
    }

    return validated
  } catch (err: any) {
    console.error("[calendar-agent] LLM extraction error:", err.message)
    return []
  }
}

/**
 * Persists a discovered event into calendar_events with deduplication & Call Queue synchronization.
 */
export async function persistCalendarEvent(
  event: DiscoveredEvent,
  opts: { dryRun?: boolean; autoSyncQueue?: boolean } = {}
): Promise<{ persisted: boolean; eventId?: string; queueId?: string; action: "created" | "skipped_duplicate" | "preview" }> {
  if (opts.dryRun) {
    return { persisted: false, action: "preview" }
  }

  // Atomically check, insert calendar_events and sync outbound_queue + leads in a single transaction
  return await withTransaction(async (client) => {
    // 1. Idempotency check: does this source already have this event_type and original_event_at?
    const existing = await client.query(
      `SELECT id, outbound_queue_id FROM calendar_events 
       WHERE source_type = $1 AND source_id = $2 AND event_type = $3 AND original_event_at = $4 LIMIT 1`,
      [event.sourceType, event.sourceId, event.eventType, event.eventAt]
    )

    if (existing.rows.length > 0) {
      return {
        persisted: false,
        eventId: existing.rows[0].id,
        queueId: existing.rows[0].outbound_queue_id,
        action: "skipped_duplicate" as const,
      }
    }

    let outboundQueueId: string | null = null

    // 2. Strict Purpose Separation & Synchronized Call Queue creation:
    // Only callbacks and reminders ever link with outbound_queue. Branch visits NEVER link.
    if (opts.autoSyncQueue !== false && event.status === "confirmed" && (event.eventType === "callback" || event.eventType === "reminder") && event.leadPhone) {
      const last10 = phoneLast10(normalizePhone(event.leadPhone))
      if (last10) {
        // Check if an active queue item already exists to avoid duplicate stacking
        const activeQueue = await client.query(
          `SELECT id FROM outbound_queue 
           WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1 AND status IN ('pending', 'dialing')
           LIMIT 1`,
          [last10]
        )

        if (activeQueue.rows.length > 0) {
          outboundQueueId = activeQueue.rows[0].id
          await client.query(
            `UPDATE outbound_queue SET scheduled_at = $1, talking_points = COALESCE($2, talking_points) WHERE id = $3`,
            [event.eventAt, event.notes, outboundQueueId]
          )
        } else {
          // Insert new linked queue row
          const newQueue = await client.query(
            `INSERT INTO outbound_queue (
              lead_id, name, phone, language, product_interest, notes, status, channel, priority, scheduled_at, talking_points, branch_id
            ) VALUES ($1, $2, $3, 'telugu', 'Follow-up', $4, 'pending', 'whatsapp_voice', 100, $5, $6, $7)
            RETURNING id`,
            [
              event.leadId,
              event.leadName || "Lead",
              event.leadPhone,
              `Scheduled via Calendar Agent: ${event.title}`,
              event.eventAt,
              event.notes || event.title,
              event.branchId,
            ]
          )
          outboundQueueId = newQueue.rows[0]?.id || null
        }
      }
    }

    // 3. Insert into calendar_events with ON CONFLICT DO NOTHING on (source_type, source_id, event_type, original_event_at)
    const inserted = await client.query(
      `INSERT INTO calendar_events (
        lead_id, title, event_type, event_at, end_at, location, channel,
        confidence, confidence_score, status, review_reason, raw_quote,
        source_type, source_id, source_at, outbound_queue_id, branch_id, notes,
        original_event_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      )
      ON CONFLICT (source_type, source_id, event_type, original_event_at) DO NOTHING
      RETURNING id`,
      [
        event.leadId,
        event.title,
        event.eventType,
        event.eventAt,
        event.endAt,
        event.location,
        event.channel,
        event.confidence,
        event.confidenceScore,
        event.status,
        event.reviewReason,
        event.rawQuote,
        event.sourceType,
        event.sourceId,
        event.sourceAt,
        outboundQueueId,
        event.branchId,
        event.notes,
        event.eventAt, // original_event_at
      ]
    )

    if (inserted.rows.length === 0) {
      // Unique conflict hit concurrently — query existing row
      const conflictRow = await client.query(
        `SELECT id, outbound_queue_id FROM calendar_events 
         WHERE source_type = $1 AND source_id = $2 AND event_type = $3 AND original_event_at = $4 LIMIT 1`,
        [event.sourceType, event.sourceId, event.eventType, event.eventAt]
      )
      return {
        persisted: false,
        eventId: conflictRow.rows[0]?.id,
        queueId: conflictRow.rows[0]?.outbound_queue_id,
        action: "skipped_duplicate" as const,
      }
    }

    // 4. Sync to leads.callback_at if callback and leadId is present
    if (event.leadId && event.eventType === "callback" && event.status === "confirmed") {
      await client.query(
        `UPDATE leads SET callback_at = $1, callback_note = COALESCE($2, callback_note) WHERE id = $3`,
        [event.eventAt, event.title, event.leadId]
      )
    }

    return {
      persisted: true,
      eventId: inserted.rows[0]?.id,
      queueId: outboundQueueId || undefined,
      action: "created" as const,
    }
  })
}

/**
 * Updates a calendar event with bidirectional queue synchronization and branch-level verification.
 */
export async function updateCalendarEvent(
  eventId: string,
  updates: {
    status?: CalendarStatus
    eventAt?: string
    location?: string
    notes?: string
    reminderEnabled?: boolean
  },
  operatorEmail?: string,
  enforceBranchId?: string | null
): Promise<{ success: boolean; error?: string; event: CalendarEventRow | null }> {
  return await withTransaction(async (client) => {
    // Row-level lock (FOR UPDATE) to prevent race conditions during updates
    const currentRes = await client.query(`SELECT * FROM calendar_events WHERE id = $1 FOR UPDATE`, [eventId])
    if (!currentRes.rows.length) return { success: false, error: "not_found", event: null }
    const current = currentRes.rows[0] as CalendarEventRow

    // Branch Authorization Gate:
    if (enforceBranchId && current.branch_id && current.branch_id !== enforceBranchId) {
      return { success: false, error: "forbidden_branch", event: null }
    }

    const newStatus = updates.status || current.status
    const newEventAt = updates.eventAt || current.event_at
    const newLocation = updates.location !== undefined ? updates.location : current.location
    const newNotes = updates.notes !== undefined ? updates.notes : current.notes
    const newReminder = updates.reminderEnabled !== undefined ? updates.reminderEnabled : current.reminder_enabled

    const updated = await client.query(
      `UPDATE calendar_events
       SET status = $1, event_at = $2, location = $3, notes = $4, reminder_enabled = $5, updated_at = now()
       WHERE id = $6
       RETURNING *`,
      [newStatus, newEventAt, newLocation, newNotes, newReminder, eventId]
    )

    // Bidirectional sync with linked outbound_queue item:
    if (current.outbound_queue_id) {
      if (newStatus === "cancelled") {
        await client.query(
          `UPDATE outbound_queue SET status = 'cancelled', cancelled_at = now(), cancelled_by = $1 WHERE id = $2`,
          [operatorEmail || "calendar_agent", current.outbound_queue_id]
        )
      } else if (newStatus === "confirmed" && updates.eventAt) {
        await client.query(
          `UPDATE outbound_queue SET scheduled_at = $1, status = 'pending' WHERE id = $2`,
          [updates.eventAt, current.outbound_queue_id]
        )
      }
    } else if (newStatus === "confirmed" && (current.event_type === "callback" || current.event_type === "reminder") && current.lead_id) {
      // If approving an item that was in needs_review, now create the queue item!
      const leadRes = await client.query(`SELECT name, phone FROM leads WHERE id = $1`, [current.lead_id])
      const lead = leadRes.rows[0]
      if (lead?.phone) {
        const last10 = phoneLast10(normalizePhone(lead.phone))
        if (last10) {
          const newQueue = await client.query(
            `INSERT INTO outbound_queue (
              lead_id, name, phone, language, product_interest, notes, status, channel, priority, scheduled_at, talking_points, branch_id
            ) VALUES ($1, $2, $3, 'telugu', 'Follow-up', $4, 'pending', 'whatsapp_voice', 100, $5, $6, $7)
            RETURNING id`,
            [
              current.lead_id,
              lead.name || "Lead",
              lead.phone,
              `Approved via Review Queue: ${current.title}`,
              newEventAt,
              current.notes || current.title,
              current.branch_id,
            ]
          )
          const queueId = newQueue.rows[0]?.id
          if (queueId) {
            await client.query(`UPDATE calendar_events SET outbound_queue_id = $1 WHERE id = $2`, [queueId, eventId])
            updated.rows[0].outbound_queue_id = queueId
          }
        }
      }
    }

    // Sync with leads.callback_at if callback
    if (current.lead_id && current.event_type === "callback") {
      if (newStatus === "cancelled") {
        await client.query(`UPDATE leads SET callback_at = NULL WHERE id = $1`, [current.lead_id])
      } else if (newEventAt && newStatus === "confirmed") {
        await client.query(`UPDATE leads SET callback_at = $1 WHERE id = $2`, [newEventAt, current.lead_id])
      }
    }

    return { success: true, event: updated.rows[0] }
  })
}

/**
 * Batch scanner across voice call records.
 */
export async function scanVoiceCalls(opts: {
  limit?: number
  dryRun?: boolean
  branchId?: string | null
}): Promise<{
  scanned: number
  discovered: DiscoveredEvent[]
  confirmed: number
  needsReview: number
  skippedDuplicates: number
}> {
  const limit = Math.min(Math.max(opts.limit || 50, 1), 200)
  const dryRun = !!opts.dryRun

  const callsRes = await query(
    `SELECT v.id, v.lead_id, v.phone, v.direction, v.status, v.transcript, v.created_at, v.branch_id,
            l.name as lead_name
     FROM voice_calls v
     LEFT JOIN leads l ON v.lead_id = l.id
     WHERE v.transcript IS NOT NULL AND jsonb_array_length(CASE WHEN jsonb_typeof(v.transcript::jsonb) = 'array' THEN v.transcript::jsonb ELSE '[]'::jsonb END) >= 2
       AND ($1::uuid IS NULL OR v.branch_id = $1)
     ORDER BY v.created_at DESC
     LIMIT $2`,
    [opts.branchId || null, limit]
  )

  const discovered: DiscoveredEvent[] = []
  let confirmed = 0
  let needsReview = 0
  let skippedDuplicates = 0

  const errors: string[] = []

  for (const call of callsRes.rows) {
    const callLockKey = `call:${call.id}`
    if (activeCallLocks.has(callLockKey)) {
      continue // Skip call currently in-flight by live webhook hook
    }
    activeCallLocks.add(callLockKey)

    try {
      const turns = Array.isArray(call.transcript) ? call.transcript : []
      const transcriptText = turns.map((t: any) => `${t.role === "ai" ? "Priya" : "Customer"}: ${t.text}`).join("\n")

      const events = await extractCalendarEventsFromText({
        conversationText: transcriptText,
        sourceAt: new Date(call.created_at),
        sourceType: "voice_call",
        sourceId: call.id,
        leadId: call.lead_id,
        leadName: call.lead_name,
        leadPhone: call.phone,
        branchId: call.branch_id,
      })

      for (const ev of events) {
        discovered.push(ev)
        if (ev.status === "confirmed") confirmed++
        else needsReview++

        if (!dryRun) {
          const res = await persistCalendarEvent(ev, { dryRun: false })
          if (res.action === "skipped_duplicate") skippedDuplicates++
        }
      }
    } catch (callErr: any) {
      errors.push(`Call ${call.id}: ${callErr?.message || callErr}`)
    } finally {
      activeCallLocks.delete(callLockKey)
    }
  }

  // Audit log scan
  await query(
    `INSERT INTO calendar_scans (
      scan_type, dry_run, records_scanned, events_discovered,
      events_auto_confirmed, events_needs_review, events_skipped_duplicate,
      details, completed_at
    ) VALUES (
      'voice_calls', $1, $2, $3, $4, $5, $6, $7, now()
    )`,
    [
      dryRun,
      callsRes.rows.length,
      discovered.length,
      confirmed,
      needsReview,
      skippedDuplicates,
      JSON.stringify({ dryRun, limit, errors: errors.length > 0 ? errors : undefined }),
    ]
  ).catch(() => {})

  return {
    scanned: callsRes.rows.length,
    discovered,
    confirmed,
    needsReview,
    skippedDuplicates,
  }
}

/**
 * Fire-and-forget background extraction for a freshly finalized voice call.
 * Uses in-memory activeCallLocks to prevent race conditions with background scans.
 */
export function runCalendarExtractionForCall(callSid: string): void {
  if (!callSid) return
  const sidLock = `call:${callSid}`
  if (activeCallLocks.has(sidLock)) return
  activeCallLocks.add(sidLock)

  ;(async () => {
    let callDbId: string | null = null
    try {
      const res = await query(
        `SELECT v.id, v.lead_id, v.phone, v.direction, v.status, v.transcript, v.created_at, v.branch_id,
                l.name as lead_name
         FROM voice_calls v
         LEFT JOIN leads l ON v.lead_id = l.id
         WHERE v.twilio_call_sid = $1 OR v.id::text = $1
         LIMIT 1`,
        [callSid]
      )
      if (!res.rows.length) return
      const call = res.rows[0]
      callDbId = String(call.id)
      activeCallLocks.add(`call:${callDbId}`)

      const turns = Array.isArray(call.transcript) ? call.transcript : []
      if (turns.length < 2) return

      const transcriptText = turns.map((t: any) => `${t.role === "ai" ? "Priya" : "Customer"}: ${t.text}`).join("\n")
      const events = await extractCalendarEventsFromText({
        conversationText: transcriptText,
        sourceAt: new Date(call.created_at),
        sourceType: "voice_call",
        sourceId: call.id,
        leadId: call.lead_id,
        leadName: call.lead_name,
        leadPhone: call.phone,
        branchId: call.branch_id,
      })

      for (const ev of events) {
        await persistCalendarEvent(ev, { dryRun: false, autoSyncQueue: true })
      }
    } catch (err: any) {
      console.error("[calendar-agent] runCalendarExtractionForCall background error:", err?.message || err)
    } finally {
      activeCallLocks.delete(sidLock)
      if (callDbId) activeCallLocks.delete(`call:${callDbId}`)
    }
  })()
}
