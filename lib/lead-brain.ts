// Lead Brain — persistent, structured, self-updating memory per lead.
//
// Upgrade over lib/memory.ts's simple context injection: instead of reading
// raw rows fresh every time, a background pipeline distills every call and
// WhatsApp conversation into a structured lead_memory row (facts, rolling
// summary, sentiment, stage) plus a unified lead_interactions timeline. The
// live call/WhatsApp path only ever does ONE cheap read (buildLeadBrief) —
// all the expensive Ollama analysis happens after the fact, in the
// background, and can never slow down or break a live conversation.
//
// lib/memory.ts's getKnownLeadContext / getPastCallContext / getWhatsAppContext
// / getVoiceContext are UNCHANGED and still work — buildLeadBrief supersedes
// them but nothing here deletes or breaks them.

import { db, query } from "./db"
import { analyzeLeadTranscript, type LeadFacts, type LeadAnalysisResult } from "./ollama"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isValidUUID(id: any): id is string {
  return typeof id === "string" && UUID_RE.test(id)
}

// Inbound calls/WhatsApp auto-create leads with a placeholder like "Caller
// 8090" or "WA 8090" before the real name is known — never present that as
// a known fact to confirm. (Same guard as lib/memory.ts, duplicated here
// since that module's copy isn't exported and this module must stay
// independent of it.)
const PLACEHOLDER_NAME_RE = /^(Caller|WA) \d+$/

function clip(s: string, n: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n) + "…" : t
}

function daysAgoShort(d: string | Date): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000)
  if (diff <= 0) return "today"
  if (diff === 1) return "1d ago"
  return `${diff}d ago`
}

// ---------------------------------------------------------------------------
// Fact merging — never overwrite a non-null value with null, never touch a
// key the human has manually locked. Arrays (objections_raised,
// competitors_mentioned) union + dedupe instead of replacing outright, so
// a later analysis pass doesn't forget an objection raised earlier.
// ---------------------------------------------------------------------------
export function mergeFacts(existing: LeadFacts, incoming: LeadFacts, lockedKeys: string[]): LeadFacts {
  const locked = new Set(lockedKeys || [])
  const merged: any = { ...existing }
  for (const [key, value] of Object.entries(incoming || {})) {
    if (locked.has(key)) continue
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      const prev = Array.isArray(merged[key]) ? merged[key] : []
      merged[key] = Array.from(new Set([...prev, ...value])).slice(0, 15)
    } else {
      merged[key] = value
    }
  }
  return merged
}

type ExistingMemory = {
  facts: LeadFacts
  locked: string[]
  summary: string
  sentiment_history: { sentiment: string; at: string }[]
  stage: string
  last_analysis_at: string | null
}

async function getExistingMemory(leadId: string): Promise<ExistingMemory> {
  const res = await query(
    `SELECT facts, locked_facts, summary, sentiment_history, stage, last_analysis_at FROM lead_memory WHERE lead_id = $1`,
    [leadId]
  )
  if (res.rows.length === 0) {
    return { facts: {}, locked: [], summary: "", sentiment_history: [], stage: "new", last_analysis_at: null }
  }
  const row = res.rows[0]
  return {
    facts: row.facts || {},
    locked: row.locked_facts || [],
    summary: row.summary || "",
    sentiment_history: row.sentiment_history || [],
    stage: row.stage || "new",
    last_analysis_at: row.last_analysis_at,
  }
}

/** Merge one analysis result into lead_memory. Idempotent-ish upsert, safe to call repeatedly. */
async function applyAnalysis(leadId: string, result: LeadAnalysisResult): Promise<void> {
  const existing = await getExistingMemory(leadId)
  const mergedFacts = mergeFacts(existing.facts, result.new_facts, existing.locked)
  const history = [...existing.sentiment_history, { sentiment: result.sentiment, at: new Date().toISOString() }].slice(-20)
  // Once do_not_call is set (customer said stop, or a human set it), the
  // automated pipeline can never silently un-set it — only a manual dashboard
  // edit can move a lead off that stage. Everything else follows the AI.
  const nextStage = existing.stage === "do_not_call" ? "do_not_call" : result.stage_suggestion

  await query(
    `INSERT INTO lead_memory (lead_id, facts, summary, sentiment, sentiment_history, stage, last_analysis_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, $6, now(), now())
     ON CONFLICT (lead_id) DO UPDATE SET
       facts = $2::jsonb, summary = $3, sentiment = $4, sentiment_history = $5::jsonb,
       stage = $6, last_analysis_at = now(), updated_at = now()`,
    [leadId, JSON.stringify(mergedFacts), result.updated_summary || existing.summary, result.sentiment, JSON.stringify(history), nextStage]
  )
}

/** Insert one timeline entry. ON CONFLICT DO NOTHING — (channel, ref_id) is unique, so re-running analysis on the same source row never duplicates history. */
export async function insertInteraction(
  leadId: string,
  channel: "voice" | "whatsapp" | "manual",
  direction: "in" | "out",
  occurredAt: string | Date,
  refId: string | null,
  oneLineSummary: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO lead_interactions (lead_id, channel, direction, occurred_at, ref_id, one_line_summary)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (channel, ref_id) DO NOTHING`,
      [leadId, channel, direction, occurredAt, refId, clip(oneLineSummary || "", 140)]
    )
  } catch (e: any) {
    console.error("insertInteraction error:", e.message)
  }
}

// ---------------------------------------------------------------------------
// Post-call analysis — fired after every call ends (app/api/calls/status).
// Never awaited by the caller; wraps its own try/catch so a bad transcript
// or a Ollama hiccup can never surface as an error in the call-status
// webhook response.
// ---------------------------------------------------------------------------
export function runPostCallAnalysis(callSid: string): void {
  ;(async () => {
    try {
      const { data: call } = await db
        .from("voice_calls")
        .select("id, lead_id, transcript, outcome, duration, direction, created_at")
        .eq("twilio_call_sid", callSid)
        .single()
      if (!call?.lead_id || !isValidUUID(call.lead_id)) return

      let turns: any[] = []
      try {
        turns = typeof call.transcript === "string" ? JSON.parse(call.transcript) : call.transcript || []
      } catch {}
      if (!Array.isArray(turns) || turns.length === 0) return // nothing said, nothing to analyze

      const transcriptText = turns.map((t: any) => `${t.role === "ai" ? "Priya" : "Customer"}: ${t.text}`).join("\n")
      const existing = await getExistingMemory(call.lead_id)
      const result = await analyzeLeadTranscript(transcriptText, existing.summary)
      if (!result) {
        console.error(`[lead-brain] analysis failed for call ${callSid} (lead ${call.lead_id}) — skipping merge, will retry on next call`)
        return
      }

      await applyAnalysis(call.lead_id, result)
      await insertInteraction(
        call.lead_id,
        "voice",
        call.direction === "inbound" ? "in" : "out",
        call.created_at,
        call.id,
        result.one_line_summary || `Call — ${call.outcome}, ${call.duration}s`
      )
    } catch (e: any) {
      console.error("runPostCallAnalysis error:", e.message)
    }
  })()
}

// ---------------------------------------------------------------------------
// Post-WhatsApp analysis — fired when a conversation has gone idle 10+ min
// (app/api/lead-brain/scan-idle, on a cron). Only looks at messages since
// the last analysis, so re-scans of an already-analyzed thread are cheap
// no-ops (nothing new to read).
// ---------------------------------------------------------------------------
export async function runPostWhatsAppAnalysis(leadId: string): Promise<void> {
  try {
    if (!isValidUUID(leadId)) return
    const existing = await getExistingMemory(leadId)
    const since = existing.last_analysis_at || new Date(0).toISOString()
    const res = await query(
      `SELECT id, direction, content, created_at FROM whatsapp_messages WHERE lead_id = $1 AND created_at > $2 ORDER BY created_at ASC`,
      [leadId, since]
    )
    if (res.rows.length === 0) return

    const transcriptText = res.rows.map((m: any) => `${m.direction === "inbound" ? "Customer" : "Priya"}: ${m.content}`).join("\n")
    const result = await analyzeLeadTranscript(transcriptText, existing.summary)
    if (!result) {
      console.error(`[lead-brain] WhatsApp analysis failed for lead ${leadId} — skipping merge, will retry next scan`)
      return
    }

    await applyAnalysis(leadId, result)
    const last = res.rows[res.rows.length - 1]
    await insertInteraction(
      leadId,
      "whatsapp",
      last.direction === "inbound" ? "in" : "out",
      last.created_at,
      String(last.id),
      result.one_line_summary || "WhatsApp conversation"
    )
  } catch (e: any) {
    console.error("runPostWhatsAppAnalysis error:", e.message)
  }
}

/**
 * Finds leads whose WhatsApp thread went idle 10+ minutes ago and hasn't
 * been analyzed since the last message arrived. Called from a cron tick
 * (lib/scheduler.ts) via app/api/lead-brain/scan-idle. Capped to 10 leads
 * per scan and processed sequentially — Ollama's own concurrency queue
 * (lib/ollama.ts) is the real bottleneck, no point racing it.
 */
export async function scanIdleWhatsAppConversations(): Promise<{ scanned: number }> {
  const res = await query(
    `WITH last_msg AS (
       SELECT lead_id, MAX(created_at) AS last_msg_at
       FROM whatsapp_messages
       WHERE lead_id IS NOT NULL
       GROUP BY lead_id
     )
     SELECT lm_.lead_id
     FROM last_msg lm_
     LEFT JOIN lead_memory mem ON mem.lead_id = lm_.lead_id
     WHERE lm_.last_msg_at < now() - interval '10 minutes'
       AND (mem.last_analysis_at IS NULL OR mem.last_analysis_at < lm_.last_msg_at)
     LIMIT 10`
  )
  for (const row of res.rows) {
    await runPostWhatsAppAnalysis(row.lead_id).catch((e) => console.error("scanIdleWhatsAppConversations item error:", e.message))
  }
  return { scanned: res.rows.length }
}

// ---------------------------------------------------------------------------
// Safety gate — checked by every outbound-calling code path (app/api/calls,
// app/api/outbound, app/api/outbound/process) before dialing. Fails OPEN on
// a DB error: this is a bolt-on safety check on top of the core calling
// feature, and a transient query failure here must never silently disable
// outbound calling for the whole app. Errors are logged loudly instead.
// ---------------------------------------------------------------------------
export async function isDoNotCall(opts: { leadId?: string | null; phone?: string | null }): Promise<boolean> {
  try {
    if (opts.leadId && isValidUUID(opts.leadId)) {
      const res = await query(`SELECT stage FROM lead_memory WHERE lead_id = $1`, [opts.leadId])
      if (res.rows[0]?.stage === "do_not_call") return true
    }
    if (opts.phone) {
      const res = await query(
        `SELECT lm.stage FROM leads l JOIN lead_memory lm ON lm.lead_id = l.id WHERE l.phone = $1 LIMIT 1`,
        [opts.phone]
      )
      if (res.rows[0]?.stage === "do_not_call") return true
    }
    return false
  } catch (e: any) {
    console.error("isDoNotCall check error (failing open — call proceeds):", e.message)
    return false
  }
}

// ---------------------------------------------------------------------------
// buildLeadBrief — the ONLY thing the live call/WhatsApp path calls. One
// query (leads LEFT JOIN lead_memory + a LATERAL-free json_agg subquery for
// the last 3 interactions), hard-capped output size so it stays cheap for
// llama3.1:8b regardless of how much history a lead has. ~4 chars/token is
// the same rough budget lib/memory.ts already uses (MAX_SNIPPET) — no real
// tokenizer in the loop, just a conservative char cap.
// ---------------------------------------------------------------------------
const CHAR_BUDGET = 2400 // ~600 tokens at ~4 chars/token
const FACT_KEYS = [
  "loan_amount_needed", "loan_type", "employment_type", "monthly_income", "existing_loans",
  "cibil_mentioned", "property_details", "urgency_level", "preferred_language",
  "best_time_to_call", "family_references", "objections_raised", "competitors_mentioned",
] as const

export async function buildLeadBrief(leadId: string): Promise<string> {
  if (!isValidUUID(leadId)) return ""
  try {
    const res = await query(
      `SELECT
         l.name, l.address, l.language,
         lm.facts, lm.summary, lm.sentiment, lm.stage,
         COALESCE(
           (SELECT json_agg(t) FROM (
             SELECT channel, direction, occurred_at, one_line_summary
             FROM lead_interactions li
             WHERE li.lead_id = l.id
             ORDER BY occurred_at DESC
             LIMIT 3
           ) t), '[]'::json
         ) AS recent_interactions
       FROM leads l
       LEFT JOIN lead_memory lm ON lm.lead_id = l.id
       WHERE l.id = $1`,
      [leadId]
    )
    if (res.rows.length === 0) return ""
    const row = res.rows[0]
    const facts: LeadFacts = row.facts || {}
    const stage: string = row.stage || "new"
    const sentiment: string = row.sentiment || "neutral"
    const summary: string = row.summary || ""
    const interactions: any[] = row.recent_interactions || []

    const lines: string[] = []

    // IDENTITY
    const safeName = row.name && !PLACEHOLDER_NAME_RE.test(row.name) ? row.name : null
    const identity = [
      safeName ? `name: ${safeName}` : null,
      row.address ? `city: ${row.address}` : null,
      row.language ? `language: ${row.language}` : null,
      `stage: ${stage}`,
    ].filter(Boolean).join(", ")
    if (identity) lines.push(`IDENTITY — ${identity}`)

    // KNOWN FACTS — only non-null, one compact line
    const factLines = FACT_KEYS
      .map((k) => {
        const v: any = (facts as any)[k]
        if (v === undefined || v === null) return null
        if (Array.isArray(v)) return v.length ? `${k}: ${v.slice(0, 3).join("; ")}` : null
        return `${k}: ${clip(String(v), 60)}`
      })
      .filter(Boolean) as string[]
    if (factLines.length) lines.push(`KNOWN FACTS — ${factLines.join(" | ")}`)

    // RELATIONSHIP SUMMARY
    if (summary.trim()) lines.push(`RELATIONSHIP SUMMARY — ${clip(summary, 400)}`)

    // LAST 3 INTERACTIONS
    if (interactions.length) {
      const rows = interactions.map(
        (i: any) => `${daysAgoShort(i.occurred_at)} [${i.channel} ${i.direction}] ${clip(i.one_line_summary || "", 90)}`
      )
      lines.push(`LAST INTERACTIONS —\n${rows.join("\n")}`)
    }

    // WARNINGS
    const warnings: string[] = []
    if (sentiment === "frustrated") warnings.push("customer was frustrated last time — be extra polite, do not push")
    if (sentiment === "hostile") warnings.push("customer was hostile previously — proceed carefully, offer to end the call/chat if asked")
    const objections = Array.isArray(facts.objections_raised) ? facts.objections_raised : []
    if (objections.length) warnings.push(`previously objected to: ${objections.slice(0, 3).join(", ")} — don't reopen unless they do`)
    if (stage === "do_not_call") warnings.push("this lead is marked DO NOT CALL — do not initiate new outreach, only respond if they reach out")
    if (warnings.length) lines.push(`WARNINGS — ${warnings.join("; ")}`)

    // DO/DON'T
    if (factLines.length || interactions.length) {
      lines.push(
        "DO/DON'T — Do NOT re-ask known facts, CONFIRM them instead. Reference past contact naturally in ONE short phrase max, never recite this brief verbatim."
      )
    }

    let brief = lines.join("\n")
    if (brief.length > CHAR_BUDGET) brief = brief.slice(0, CHAR_BUDGET) + "…"
    return brief ? `CROSS-CHANNEL LEAD BRIEF (internal — never read this aloud/verbatim):\n${brief}` : ""
  } catch (e: any) {
    console.error("buildLeadBrief error:", e.message)
    return ""
  }
}
