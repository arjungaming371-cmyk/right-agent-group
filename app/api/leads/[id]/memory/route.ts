import { NextRequest, NextResponse } from "next/server"
import pool, { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"
import { isValidUUID } from "@/lib/lead-brain"

const VALID_STAGES = [
  "new", "contacted", "interested", "docs_pending", "negotiating", "converted", "lost", "do_not_call",
]

// GET — read-only, any logged-in role with leads module access.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isValidUUID(id)) return NextResponse.json({ error: "invalid lead id" }, { status: 400 })

  const branchId = sessionBranchId(session)
  if (branchId) {
    const leadCheck = await query(`SELECT branch_id FROM leads WHERE id = $1 LIMIT 1`, [id])
    if (leadCheck.rows.length === 0 || leadCheck.rows[0].branch_id !== branchId) {
      return NextResponse.json({ error: "lead not found in your branch" }, { status: 404 })
    }
  }

  const [leadRes, memoryRes, timelineRes] = await Promise.all([
    query(`SELECT id, name, phone, address, whatsapp_number, product_interest FROM leads WHERE id = $1`, [id]),
    query(
      `SELECT facts, locked_facts, summary, sentiment, sentiment_history, stage, last_analysis_at, updated_at
       FROM lead_memory WHERE lead_id = $1`,
      [id]
    ),
    query(
      `SELECT channel, direction, occurred_at, one_line_summary FROM lead_interactions
       WHERE lead_id = $1 ORDER BY occurred_at DESC LIMIT 20`,
      [id]
    ),
  ])

  if (leadRes.rows.length === 0) return NextResponse.json({ error: "lead not found" }, { status: 404 })

  const memory = memoryRes.rows[0] || {
    facts: {}, locked_facts: [], summary: "", sentiment: "neutral",
    sentiment_history: [], stage: "new", last_analysis_at: null, updated_at: null,
  }

  return NextResponse.json({
    lead: leadRes.rows[0],
    memory,
    timeline: timelineRes.rows,
  })
}

// PATCH — manual edit. Every key present in `facts` gets written AND locked
// (added to locked_facts) so the background AI pipeline can never silently
// overwrite a human correction. Pass `unlockKeys` to release a fact back to
// AI control. Pass `facts: { someKey: null }` to explicitly clear a fact
// (still locks it — AI won't refill it until unlocked).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isValidUUID(id)) return NextResponse.json({ error: "invalid lead id" }, { status: 400 })

  const branchId = sessionBranchId(session)
  if (branchId) {
    const leadCheck = await query(`SELECT branch_id FROM leads WHERE id = $1 LIMIT 1`, [id])
    if (leadCheck.rows.length === 0 || leadCheck.rows[0].branch_id !== branchId) {
      return NextResponse.json({ error: "lead not found in your branch" }, { status: 404 })
    }
  }

  const body = await req.json().catch(() => ({}))
  const factEdits: Record<string, any> | undefined = body?.facts && typeof body.facts === "object" ? body.facts : undefined
  const unlockKeys: string[] = Array.isArray(body?.unlockKeys) ? body.unlockKeys.filter((k: any) => typeof k === "string") : []
  const summary: string | undefined = typeof body?.summary === "string" ? body.summary.slice(0, 1200) : undefined
  const stage: string | undefined = typeof body?.stage === "string" ? body.stage : undefined

  if (stage && !VALID_STAGES.includes(stage)) {
    return NextResponse.json({ error: `invalid stage — must be one of: ${VALID_STAGES.join(", ")}` }, { status: 400 })
  }

  // FIX (2026-09-20): read-modify-write ran with no lock — a manual edit
  // racing the background Lead Brain analysis (which takes
  // pg_advisory_xact_lock(hashtext(lead_id)) for the same purpose) silently
  // lost one side's facts/locked_facts. Same advisory lock, so human edits
  // and AI analyses now serialize per lead.
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [id])

    const existingRes = await client.query(
      `SELECT facts, locked_facts, summary, sentiment, sentiment_history, stage FROM lead_memory WHERE lead_id = $1`,
      [id]
    )
    const existing = existingRes.rows[0] || { facts: {}, locked_facts: [], summary: "", sentiment: "neutral", sentiment_history: [], stage: "new" }

    const nextFacts = { ...existing.facts }
    const lockedSet = new Set<string>(existing.locked_facts || [])
    if (factEdits) {
      for (const [key, value] of Object.entries(factEdits)) {
        nextFacts[key] = value
        lockedSet.add(key)
      }
    }
    for (const key of unlockKeys) lockedSet.delete(key)

    const nextSummary = summary !== undefined ? summary : existing.summary
    const nextStage = stage !== undefined ? stage : existing.stage

    await client.query(
      `INSERT INTO lead_memory (lead_id, facts, locked_facts, summary, stage, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, now())
       ON CONFLICT (lead_id) DO UPDATE SET
         facts = $2::jsonb, locked_facts = $3, summary = $4, stage = $5, updated_at = now()`,
      [id, JSON.stringify(nextFacts), Array.from(lockedSet), nextSummary, nextStage]
    )
    await client.query("COMMIT")
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {})
    throw e
  } finally {
    client.release()
  }

  logAudit("lead memory manually edited", session.email, {
    leadId: id,
    factKeysEdited: factEdits ? Object.keys(factEdits) : [],
    unlockKeys,
    summaryEdited: summary !== undefined,
    stageChanged: stage !== undefined ? stage : undefined,
  })

  const updated = await query(
    `SELECT facts, locked_facts, summary, sentiment, sentiment_history, stage, last_analysis_at, updated_at FROM lead_memory WHERE lead_id = $1`,
    [id]
  )
  return NextResponse.json({ ok: true, memory: updated.rows[0] })
}
