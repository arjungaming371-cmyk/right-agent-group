import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"
import { logAudit } from "@/lib/audit"
import { runCompletion } from "@/lib/llm"
import {
  CANONICAL_FIELDS,
  buildCampaignScript,
  fieldLabel,
  type StudioLanguage,
} from "@/lib/script-studio"

export const dynamic = "force-dynamic"

// Script Studio — the Outpero-style campaign script editor, adapted to
// Right Agent Group. Outpero's editor shows "Hi {{first_name}}! I see you
// recently purchased the {{purchase}} on our {{plan}} plan…" with the lead
// sheet's own columns as placeholders. Here the SAME idea feeds Priya's
// per-campaign talking points:
//
//   GET  → the canonical {fields} + every custom column ever uploaded
//          (leads.custom_fields / outbound_queue.custom_fields) + the saved
//          campaign template (ai_scripts key 'campaign_template').
//   POST { action: "generate" } → Swara-HR-style brief: product / offer /
//          tone / capture list in, complete structured campaign script out
//          (LLM-written, with the pure buildCampaignScript() fallback so the
//          Studio NEVER breaks when the model is down).
//   POST { action: "save" } → persist the template (admin) — the Upload and
//          Call Queue consoles then offer it as the campaign agenda with a
//          one click.
//
// The template is NOT Priya's base script: lib/llm.ts merges the campaign
// agenda (queue row talking_points / voice_calls.instructions) with the base
// persona on every turn. The Studio writes the per-campaign delta only.

const TEMPLATE_KEY = "campaign_template"
const MAX_TEMPLATE = 40000
const CUSTOM_KEY_CAP = 40

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_scripts (
      id         SERIAL PRIMARY KEY,
      language   TEXT NOT NULL UNIQUE,
      content    TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT DEFAULT 'admin'
    )
  `)
}

async function loadTemplate(): Promise<{ content: string; updated_at: string | null; updated_by: string | null } | null> {
  const res = await query(
    `SELECT content, updated_at, updated_by FROM ai_scripts WHERE language = $1 LIMIT 1`,
    [TEMPLATE_KEY]
  )
  const row = res.rows[0] as { content: string; updated_at: string; updated_by: string } | undefined
  return row ? { content: row.content, updated_at: row.updated_at, updated_by: row.updated_by } : null
}

/** Distinct custom-field keys operators have actually uploaded so far. */
async function loadCustomKeys(branchId: string | null): Promise<string[]> {
  try {
    const res = await query(
      `SELECT DISTINCT key FROM (
         SELECT jsonb_object_keys(custom_fields) AS key FROM leads
          WHERE custom_fields IS NOT NULL AND ($1::uuid IS NULL OR branch_id = $1)
         UNION
         SELECT jsonb_object_keys(custom_fields) AS key FROM outbound_queue
          WHERE custom_fields IS NOT NULL AND ($1::uuid IS NULL OR branch_id = $1)
       ) keys ORDER BY key LIMIT $2`,
      [branchId, CUSTOM_KEY_CAP]
    )
    return (res.rows as { key: string }[]).map((r) => r.key).filter(Boolean)
  } catch {
    // Migration not applied yet (or old DB) — the Studio still works with
    // the canonical fields; custom chips simply start empty.
    return []
  }
}

export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "script", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    await ensureTable()
    const branchId = sessionBranchId(session)
    const [template, customKeys] = await Promise.all([loadTemplate(), loadCustomKeys(branchId)])
    return NextResponse.json({
      canonicalFields: CANONICAL_FIELDS.map((key) => ({ key, label: fieldLabel(key) })),
      customFields: customKeys,
      template: template?.content ?? "",
      templateMeta: template ? { updated_at: template.updated_at, updated_by: template.updated_by } : null,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "failed to load studio" }, { status: 500 })
  }
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : ""
}

const LANGS: StudioLanguage[] = ["english", "hindi", "telugu"]
const TONES = ["friendly", "professional", "energetic"] as const

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "script", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    await ensureTable()
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const action = str(body.action, 20)

    // ── SAVE ────────────────────────────────────────────────────────────────
    if (action === "save") {
      // Writes follow the Script Manager's rule: admins only.
      if (session.role !== "admin") {
        return NextResponse.json({ error: "Only administrators can save the campaign template" }, { status: 403 })
      }
      const template = typeof body.template === "string" ? body.template.trim() : ""
      if (!template) return NextResponse.json({ error: "template is required" }, { status: 400 })
      if (template.length > MAX_TEMPLATE) {
        return NextResponse.json({ error: `template too long (max ${MAX_TEMPLATE} characters)` }, { status: 400 })
      }
      await query(
        `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
         VALUES ($1, $2, now(), $3)
         ON CONFLICT (language) DO UPDATE SET content = $2, updated_at = now(), updated_by = $3`,
        [TEMPLATE_KEY, template, session.email]
      )
      logAudit("campaign template saved via script studio", session.email, { length: template.length })
      return NextResponse.json({ ok: true })
    }

    // ── GENERATE (default) ──────────────────────────────────────────────────
    const language = (LANGS.includes(body.language as StudioLanguage) ? body.language : "telugu") as StudioLanguage
    const product = str(body.product, 80) || "Home Loan"
    const offer = str(body.offer, 500)
    const audience = str(body.audience, 200)
    const tone = (TONES.includes(body.tone) ? body.tone : "friendly") as "friendly" | "professional" | "energetic"
    const capture = Array.isArray(body.capture)
      ? body.capture.map((c: unknown) => str(c, 60)).filter(Boolean).slice(0, 8)
      : []

    // The deterministic brief is ALWAYS computed first — it is the fallback
    // when the model is unreachable AND the skeleton the prompt is built
    // from, so the LLM path can never regress below the pure path.
    const fallback = buildCampaignScript({ product, offer, audience, tone, capture, language })

    const LANG_RULE: Record<StudioLanguage, string> = {
      telugu: "Write spoken Telugu in ENGLISH (Roman) letters — Tenglish, exactly how Hyderabad talks (e.g. 'Namaskaram sir, nenu Priya…'). NEVER Telugu script. Everyday English words mixed in naturally.",
      hindi: "Write spoken Hindi in ENGLISH (Roman) letters — Hinglish (e.g. 'Namaste sir, main Priya bol rahi hoon…'). NEVER Devanagari. Everyday English words mixed in naturally.",
      english: "Write simple, natural spoken English — short sentences a phone call can carry.",
    }

    const prompt = `You are the AI HR that briefs a voice AI employee (like Outpero's Swara HR), for Right Agent Group, a loan-consultancy in Hyderabad. Your employee is "Priya", a warm female loan advisor who speaks code-switched Telugu/Hindi/English on phone calls.

Write the CAMPAIGN BRIEF (per-campaign talking points) that will be injected into Priya's instructions for this outbound campaign. Priya's base script already covers her persona, memory rules, objection style and safety rules — your brief is ONLY the per-campaign delta.

CAMPAIGN INPUTS
- Product: ${product}
- Offer / angle: ${offer || "(invent a sensible, honest angle for this product — no fake numbers, no invented interest rates)"}
- Audience: ${audience || "fresh leads from an uploaded CSV"}
- Tone: ${tone}
- Details Priya must capture on the call: ${capture.length ? capture.join(", ") : "full name, area/city, loan amount needed, monthly income, WhatsApp number"}
- Language style: ${LANG_RULE[language]}

STRUCTURE (use EXACTLY these section headers, one blank line between sections):
CAMPAIGN BRIEF — <product> outreach (Right Agent Group, Hyderabad)
TONE: <one line>
OPENING: <2-3 lines; greet, use {name} placeholder, reference the offer>
CUSTOMER DATA ON FILE: <one line telling Priya to use {product_interest} and any extra CSV fields like {city}, never to re-ask known facts>
DISCOVERY: <one clear question to ask, then listen>
PITCH: <2-3 lines, pain-relief selling, honest, no invented figures>
DETAILS TO CAPTURE: <numbered list of the capture items, one per line, each asked as its own question>
READBACK: <one line — before closing she confirms every captured detail in one short sentence>
CLOSE: <1-2 lines — promise the simple loan application on WhatsApp, officer follows up>
HARD RULES: <3 lines — no OTP/PIN/payment ever; never guarantee approval; 2 clear NOs means stop politely>

RULES
- Use {name} (and {product_interest}, {city}, {loan_amount} where natural) as merge placeholders — they are replaced per lead at dial time.
- Keep every line speakable on a phone call. No bullet fluff, no marketing adjectives.
- Never invent interest rates, approval promises, or figures.
- Output ONLY the brief text. No markdown fences, no explanations.`

    let script = fallback
    let source: "ai" | "template" = "template"
    try {
      const out = await runCompletion(
        [
          { role: "system", content: prompt },
          { role: "user", content: `Generate the campaign brief now. Product: ${product}. Offer: ${offer || "you choose an honest angle"}.` },
        ],
        { timeoutMs: 45000, temperature: 0.4, numPredict: 1400 }
      )
      const cleaned = out.replace(/```[a-z]*\n?/gi, "").trim()
      // A generation that lost the skeleton (model rambled) is worse than
      // the deterministic brief — accept only when the headers survived.
      if (cleaned.length > 400 && /OPENING/i.test(cleaned) && /CLOSE/i.test(cleaned)) {
        script = cleaned
        source = "ai"
      }
    } catch {
      // model down / not configured → deterministic brief below
    }

    return NextResponse.json({ ok: true, script, source })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "generate failed" }, { status: 500 })
  }
}
