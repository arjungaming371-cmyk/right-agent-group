import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest, requireModuleOrRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

const DEFAULT_PROMPTS = [
  {
    label: "General Loan Offer",
    text: "Hello {name}, greetings from Right Agent Group! We provide fast-track approval on Personal, Business, and Home Loans with minimal documentation and attractive interest rates.",
  },
  {
    label: "Application Follow-up",
    text: "Hello {name}, this is a gentle follow-up regarding your recent loan inquiry with Right Agent Group. Our loan officer is ready to process your file. Please complete your application below.",
  },
  {
    label: "Document Checklist",
    text: "Hello {name}, to fast-track your loan file approval, please keep your PAN Card, Aadhaar, and 6 months bank statement ready. Our advisor will guide you through instant sanction.",
  },
  {
    label: "Festive Rate Offer",
    text: "Hello {name}, special festive offer! Avail Home and Business Loans starting from 7.25% p.a. through 20+ partner banks in Hyderabad with minimal documentation.",
  },
  {
    label: "Telugu Offer",
    text: "నమస్కారం {name} గారు, రైట్ ఏజెంట్ గ్రూప్ నుండి మాట్లాడుతున్నాము. మీకు హోమ్ లోన్ లేదా బిజినెస్ లోన్ తక్కువ వడ్డీతో అవసరమా? మా బ్యాంకింగ్ కౌన్సిలర్ మీకు వెంటనే సహాయం చేస్తారు.",
  },
  {
    label: "Hindi Offer",
    text: "नमस्ते {name} जी, राइट एजेंट ग्रुप से नमस्कार। यदि आपको होम, पर्सनल या बिजनेस लोन की आवश्यकता है तो सबसे कम ब्याज दरों पर आवेदन करें।",
  },
]

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS whatsapp_quick_prompts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  const countRes = await query(`SELECT COUNT(*)::int AS c FROM whatsapp_quick_prompts`)
  if ((countRes.rows[0]?.c || 0) === 0) {
    for (let i = 0; i < DEFAULT_PROMPTS.length; i++) {
      await query(
        `INSERT INTO whatsapp_quick_prompts (label, text, sort_order, created_by) VALUES ($1, $2, $3, $4)`,
        [DEFAULT_PROMPTS[i].label, DEFAULT_PROMPTS[i].text, i, "system"]
      )
    }
  }
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    await ensureTable()
    const res = await query(
      `SELECT id, label, text, sort_order FROM whatsapp_quick_prompts ORDER BY sort_order ASC, created_at ASC`
    )
    return NextResponse.json({ ok: true, prompts: res.rows })
  } catch (e: any) {
    console.error("quick-prompts GET error:", e?.message)
    return NextResponse.json({ ok: true, prompts: DEFAULT_PROMPTS.map((p, i) => ({ id: `def-${i}`, ...p })) })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const label = String(body.label || "").trim()
  const text = String(body.text || "").trim()
  if (!label || !text) {
    return NextResponse.json({ error: "Label and message text are required" }, { status: 400 })
  }

  await ensureTable()
  const maxRes = await query(`SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS next_order FROM whatsapp_quick_prompts`)
  const nextOrder = maxRes.rows[0]?.next_order ?? 10
  const res = await query(
    `INSERT INTO whatsapp_quick_prompts (label, text, sort_order, created_by) VALUES ($1, $2, $3, $4) RETURNING id, label, text, sort_order`,
    [label, text, nextOrder, session.email || "user"]
  )
  return NextResponse.json({ ok: true, prompt: res.rows[0] })
}

export async function PATCH(req: NextRequest) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const id = String(body.id || "").trim()
  const label = String(body.label || "").trim()
  const text = String(body.text || "").trim()
  if (!id || !label || !text) {
    return NextResponse.json({ error: "id, label, and text are required" }, { status: 400 })
  }

  await ensureTable()
  const res = await query(
    `UPDATE whatsapp_quick_prompts SET label = $1, text = $2 WHERE id = $3 RETURNING id, label, text, sort_order`,
    [label, text, id]
  )
  if (res.rows.length === 0) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true, prompt: res.rows[0] })
}

export async function DELETE(req: NextRequest) {
  const session = await requireModuleOrRole(req, "leads", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  await ensureTable()
  await query(`DELETE FROM whatsapp_quick_prompts WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
