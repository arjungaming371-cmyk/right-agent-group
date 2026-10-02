import { NextRequest, NextResponse } from "next/server"
import { chatWithLLM, type Language } from "@/lib/llm"
import { rateLimit, clientIp } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// Public "Test Priya" demo chat (components/site/demo-chat.tsx). Clones the
// /api/simulator/chat shape with these hardening changes:
//  - NO requireRole — this endpoint is intentionally public, so it is
//    rate-limited per IP, consent-gated, length-capped and context-locked.
//  - The lead context is a FIXED demo lead; anything client-sent
//    (lead/branchId/channel) is ignored outright.
//  - Response is { reply } ONLY — no contextUsed or internal details.
const DEMO_LEAD = {
  name: "Demo Customer",
  loanType: "personal loan",
  loanAmount: 300000,
  loanTenure: 36,
  city: "Hyderabad",
}

const DEMO_BRIEF = `=== PUBLIC WEBSITE DEMO — STRICT DEMO RULES ===
This is a public demo on the marketing website. The visitor is testing Priya before booking a real demo.
- You are Priya, the AI loan agent. If asked who you are, say so clearly — never claim to be human.
- Keep every reply under 60 words.
- Stay strictly on loan topics (loan interest, documents, eligibility questions, EMI basics, process).
- NEVER promise approval. NEVER invent or quote interest rates — if asked for rates, say the team will share the current rates for their profile.
- If the visitor gives an amount, rate and tenure you may compute the EMI; never guess numbers you were not given.
- If the visitor wants to move ahead or have a real conversation, suggest booking a demo so the team can set Priya up with their own script and numbers.

=== DEMO LEAD CONTEXT (FIXED SAMPLE DATA — NOT REAL CUSTOMER DATA) ===
- Customer Name: ${DEMO_LEAD.name}
- Loan Interest: ${DEMO_LEAD.loanType}
- Loan Amount: ₹3,00,000 (3 lakh)
- Tenure: ${DEMO_LEAD.loanTenure} months (3 years)
- City: ${DEMO_LEAD.city}
This is sample data for the demo conversation only.`

export async function POST(req: NextRequest) {
  if (!rateLimit(`demochat:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Demo limit reached. Please try again later or book a live demo." },
      { status: 429 }
    )
  }

  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

    // Explicit AI-demo consent is REQUIRED before the model is called.
    if (body.consent !== true) {
      return NextResponse.json({ error: "Consent required" }, { status: 400 })
    }

    const message = typeof body?.message === "string" ? body.message.trim() : ""
    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }
    if (message.length > 500) {
      return NextResponse.json({ error: "Message is too long (500 characters max)" }, { status: 400 })
    }

    const language: Language =
      body?.language && ["english", "hindi", "telugu"].includes(body.language)
        ? (body.language as Language)
        : "english"

    const rawHistory = Array.isArray(body?.history) ? body.history : []
    const safeHistory: { role: "user" | "model"; content: string }[] = rawHistory
      .filter((m: any) => m && typeof m.content === "string")
      .slice(-10)
      .map((m: any) => ({
        role: m.role === "model" ? ("model" as const) : ("user" as const),
        content: String(m.content).slice(0, 500),
      }))

    const messages = [...safeHistory, { role: "user" as const, content: message }]

    // Channel is forced to "whatsapp" (text demo). Client-sent lead context
    // and branchId are ignored entirely — this is a public endpoint.
    let reply = (
      await chatWithLLM(messages, language, DEMO_BRIEF, {
        channel: "whatsapp",
        numPredict: 400,
      })
    ).trim()

    // Same WhatsApp display cleanup as the simulator: keep markdown light.
    if (reply) reply = reply.replace(/\*\*/g, "*")

    return NextResponse.json({ reply })
  } catch (e: any) {
    console.error("Demo chat error:", e?.message || e)
    return NextResponse.json({ error: "Demo is temporarily unavailable" }, { status: 500 })
  }
}
