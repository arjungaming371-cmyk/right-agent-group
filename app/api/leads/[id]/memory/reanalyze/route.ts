import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { analyzeLeadTranscript } from "@/lib/llm"
import { isValidUUID, mergeFacts } from "@/lib/lead-brain"

// POST — rebuilds lead_memory from the FULL cross-channel history (every
// call transcript + every WhatsApp message), not just what's changed since
// the last analysis. Manual dashboard action, not on any hot path, so a
// real (awaited) Groq call here is fine — the live call/WhatsApp path
// never hits this route.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(req, ["admin", "agent"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isValidUUID(id)) return NextResponse.json({ error: "invalid lead id" }, { status: 400 })

  const leadRes = await query(`SELECT id FROM leads WHERE id = $1`, [id])
  if (leadRes.rows.length === 0) return NextResponse.json({ error: "lead not found" }, { status: 404 })

  const [callsRes, waRes, memRes] = await Promise.all([
    query(`SELECT created_at, transcript FROM voice_calls WHERE lead_id = $1 AND transcript IS NOT NULL ORDER BY created_at ASC`, [id]),
    query(`SELECT created_at, direction, content FROM whatsapp_messages WHERE lead_id = $1 ORDER BY created_at ASC`, [id]),
    query(`SELECT facts, locked_facts, stage FROM lead_memory WHERE lead_id = $1`, [id]),
  ])

  // Interleave every call + message chronologically into one narrative.
  type Line = { at: number; text: string }
  const lines: Line[] = []
  for (const call of callsRes.rows) {
    let turns: any[] = []
    try {
      turns = typeof call.transcript === "string" ? JSON.parse(call.transcript) : call.transcript || []
    } catch {}
    if (!Array.isArray(turns)) continue
    const at = new Date(call.created_at).getTime()
    for (const t of turns) {
      lines.push({ at, text: `[call] ${t.role === "ai" ? "Priya" : "Customer"}: ${t.text}` })
    }
  }
  for (const m of waRes.rows) {
    lines.push({ at: new Date(m.created_at).getTime(), text: `[whatsapp] ${m.direction === "inbound" ? "Customer" : "Priya"}: ${m.content}` })
  }
  lines.sort((a, b) => a.at - b.at)

  if (lines.length === 0) {
    return NextResponse.json({ error: "no call or WhatsApp history to analyze yet" }, { status: 400 })
  }

  const transcriptText = lines.map((l) => l.text).join("\n")
  // Fresh narrative from the WHOLE history, not an incremental delta —
  // that's the point of "re-analyze". Locked facts are still respected below.
  const result = await analyzeLeadTranscript(transcriptText, "")
  if (!result) return NextResponse.json({ error: "analysis failed — the model did not return valid JSON, try again" }, { status: 502 })

  const existing = memRes.rows[0] || { facts: {}, locked_facts: [], stage: "new" }
  const mergedFacts = mergeFacts(existing.facts || {}, result.new_facts, existing.locked_facts || [])
  const nextStage = existing.stage === "do_not_call" ? "do_not_call" : result.stage_suggestion

  await query(
    `INSERT INTO lead_memory (lead_id, facts, summary, sentiment, sentiment_history, stage, last_analysis_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, $6, now(), now())
     ON CONFLICT (lead_id) DO UPDATE SET
       facts = $2::jsonb, summary = $3, sentiment = $4,
       sentiment_history = lead_memory.sentiment_history || $5::jsonb,
       stage = $6, last_analysis_at = now(), updated_at = now()`,
    [id, JSON.stringify(mergedFacts), result.updated_summary, result.sentiment, JSON.stringify([{ sentiment: result.sentiment, at: new Date().toISOString() }]), nextStage]
  )

  logAudit("lead memory re-analyzed", session.email, { leadId: id, sourceLines: lines.length })

  const updated = await query(
    `SELECT facts, locked_facts, summary, sentiment, sentiment_history, stage, last_analysis_at, updated_at FROM lead_memory WHERE lead_id = $1`,
    [id]
  )
  return NextResponse.json({ ok: true, memory: updated.rows[0] })
}
