import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest, requireModuleOrRole } from "@/lib/auth"

export const dynamic = "force-dynamic"

const DEFAULT_PROMPTS = [
  {
    label: "Technology Programmes Overview",
    text: "Hello {name}, greetings from NIAT Admissions! We offer cutting-edge technology upskilling in AI, Machine Learning, and Robotics alongside your UGC-recognized B.Tech degree.",
  },
  {
    label: "NAT Assessment Invitation",
    text: "Hello {name}, this is regarding your NIAT technology enquiry. The NxtWave Assessment Test (NAT) evaluates problem solving and learnability. No prior coding is required — would you like to take the entrance test?",
  },
  {
    label: "Collaborating Campuses Guide",
    text: "Hello {name}, NIAT programmes are available across 35+ collaborating institutions, including Chaitanya, Aurora, and SMR universities in Hyderabad. Would you like campus and hostel details?",
  },
  {
    label: "Parent Counselling Follow-up",
    text: "Hello {name}, choosing a 4-year undergraduate college is a major family decision. Would you and your parents like a 1-on-1 career counselling session to understand degree validity and career opportunities?",
  },
  {
    label: "Telugu Admissions Guidance",
    text: "నమస్కారం {name} గారు, NIAT అడ్మిషన్స్ నుండి మాట్లాడుతున్నాము. ఇంటర్మీడియట్ తర్వాత AI, రోబోటిక్స్ మరియు సాఫ్ట్‌వేర్ రంగాలలో అండర్‌గ్రాడ్యుయేట్ ప్రోగ్రామ్స్ గురించి సమాచారం కావాలా?",
  },
  {
    label: "Hindi Admissions Guidance",
    text: "नमस्ते {name} जी, NIAT Admissions से नमस्कार। 12वीं के बाद AI, डेटा साइंस और रोबोटिक्स में टेक्नोलॉजी प्रोग्राम्स की जानकारी के लिए हम आपकी पूरी मदद कर सकते हैं।",
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
