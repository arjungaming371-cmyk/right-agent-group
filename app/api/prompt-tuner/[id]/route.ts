import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { applySuggestionToScripts } from "@/lib/prompt-tuner"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PATCH — approve or reject a suggestion. Approving is the ONLY code path
// that ever writes a Prompt Tuner suggestion into Priya's real script, and
// it only runs from an authenticated admin action.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(req, ["admin"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const action = body?.action
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 })
  }

  const existing = await query(`SELECT * FROM prompt_suggestions WHERE id = $1`, [id])
  if (existing.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 })
  const suggestion = existing.rows[0]
  if (suggestion.status !== "pending") {
    return NextResponse.json({ error: `already ${suggestion.status}` }, { status: 400 })
  }

  if (action === "reject") {
    await query(
      `UPDATE prompt_suggestions SET status = 'rejected', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
      [id, session.email]
    )
    logAudit("prompt suggestion rejected", session.email, { id, guideline: suggestion.short_guideline })
    return NextResponse.json({ ok: true, status: "rejected" })
  }

  // approve — ONE SCRIPT MODE: suggestions always land in the single 'base'
  // script (per-language voice is appended in code, see lib/llm.ts).
  const languages = ["base"]

  await applySuggestionToScripts(suggestion.short_guideline, languages)
  await query(
    `UPDATE prompt_suggestions SET status = 'approved', applied_to = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
    [id, languages, session.email]
  )
  logAudit("prompt suggestion approved", session.email, { id, guideline: suggestion.short_guideline, languages })
  return NextResponse.json({ ok: true, status: "approved", appliedTo: languages })
}
