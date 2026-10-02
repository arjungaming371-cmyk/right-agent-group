import { NextRequest, NextResponse } from "next/server"
import { getLiveSession } from "@/lib/auth"
import { query } from "@/lib/db"
import { sessionBranchId } from "@/lib/branches"
import { isAiPaused } from "@/lib/ai-pause"

export const dynamic = "force-dynamic"

// ONBOARDING CHECKLIST — "Complete your setup" computed from live system
// state, not from a stored progress row. Each step maps to the dashboard
// view that completes it (the shell dispatches rag:navigate to jump there).
//
// Steps:
//   branch    → at least one branch exists
//   employee  → at least one ACTIVE AI employee
//   phone     → Exotel configured (env, or the branch's own credentials)
//   whatsapp  → WhatsApp connected (env token, or the branch's own)
//   knowledge → at least one active knowledge-base entry
//   leads     → at least one lead imported/captured
//   test      → at least one voice call has run (test or real)
//   launch    → AI automation is not paused (and everything else is done)

export async function GET(req: NextRequest) {
  const session = await getLiveSession(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  try {
    const [branches, employees, kb, leads, calls] = await Promise.all([
      query(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE exotel_caller_id IS NOT NULL OR $2::text IS NOT NULL)::int AS phone
           FROM branches WHERE ($1::uuid IS NULL OR id = $1::uuid)`,
        [branchId, process.env.EXOTEL_SID || null]
      ).catch(() => ({ rows: [{ n: 0, phone: 0 }] })),
      query(`SELECT count(*)::int AS n FROM ai_employees WHERE is_active`).catch(() => ({ rows: [{ n: 0 }] })),
      query(`SELECT count(*)::int AS n FROM knowledge_base WHERE is_active`).catch(() => ({ rows: [{ n: 0 }] })),
      query(`SELECT count(*)::int AS n FROM leads WHERE ($1::uuid IS NULL OR branch_id = $1::uuid)`, [branchId]).catch(() => ({ rows: [{ n: 0 }] })),
      query(`SELECT count(*)::int AS n FROM voice_calls WHERE ($1::uuid IS NULL OR branch_id = $1::uuid)`, [branchId]).catch(() => ({ rows: [{ n: 0 }] })),
    ])

    const envWhatsapp = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
    let whatsapp = envWhatsapp
    let phone = (branches.rows[0]?.phone ?? 0) > 0
    if (branchId) {
      const b = await query(
        `SELECT whatsapp_token IS NOT NULL AS wa, exotel_caller_id IS NOT NULL AS exo FROM branches WHERE id = $1 LIMIT 1`,
        [branchId]
      ).catch(() => ({ rows: [] as any[] }))
      whatsapp = whatsapp || !!b.rows[0]?.wa
      phone = phone || !!b.rows[0]?.exo
    }

    const steps = [
      { key: "branch", label: "Create your first branch", done: (branches.rows[0]?.n ?? 0) > 0, view: "branches" },
      { key: "employee", label: "Create an AI employee", done: (employees.rows[0]?.n ?? 0) > 0, view: "branches" },
      { key: "phone", label: "Connect phone calling (Exotel)", done: phone, view: "branches" },
      { key: "whatsapp", label: "Connect WhatsApp", done: whatsapp, view: "branches" },
      { key: "knowledge", label: "Add knowledge Priya can use", done: (kb.rows[0]?.n ?? 0) > 0, view: "knowledge" },
      { key: "leads", label: "Import or capture leads", done: (leads.rows[0]?.n ?? 0) > 0, view: "upload" },
      { key: "test", label: "Make a test call with Priya", done: (calls.rows[0]?.n ?? 0) > 0, view: "queue" },
    ]
    const othersDone = steps.every(s => s.done)
    const paused = await isAiPaused("calls", branchId)
    steps.push({ key: "launch", label: "Launch automation", done: othersDone && !paused, view: "security" })

    const done = steps.filter(s => s.done).length
    return NextResponse.json({ steps, done, total: steps.length, complete: done === steps.length })
  } catch (e: any) {
    console.error("onboarding status failed:", e?.message)
    return NextResponse.json({ steps: [], done: 0, total: 8, complete: false }, { status: 200 })
  }
}
