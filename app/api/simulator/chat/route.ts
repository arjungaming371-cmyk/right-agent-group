import { NextRequest, NextResponse } from "next/server"
import { chatWithLLM, type Language } from "@/lib/llm"
import { requireRole } from "@/lib/auth"
import { searchKnowledgeBase } from "@/lib/knowledge-base"
import { CUSTOMER_BYE_RE, GOODBYE_RE } from "@/lib/voice-conversation"
import { getInstagramDmTemplate, getInstagramCommentTemplates, renderTemplate } from "@/lib/channel-scripts"

export const dynamic = "force-dynamic"

export type SimulatorLeadContext = {
  name?: string
  phone?: string
  loanType?: string
  loanAmount?: string
  loanTenure?: string
  city?: string
  hasApplication?: boolean
  applicationRef?: string
  applicationStatus?: string
  notes?: string
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent", "viewer", "branch_manager", "developer"])
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const startTime = Date.now()

  try {
    const body = await req.json()
    const message = typeof body?.message === "string" ? body.message.trim() : ""
    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    const channel: "call" | "whatsapp" | "instagram_dm" | "instagram_comment" =
      body?.channel && ["call", "whatsapp", "instagram_dm", "instagram_comment"].includes(body.channel)
        ? body.channel
        : "call"

    const language: Language =
      body?.language && ["telugu", "english", "hindi"].includes(body.language)
        ? (body.language as Language)
        : "telugu"

    const lead: SimulatorLeadContext = body?.lead || {}
    const rawHistory = Array.isArray(body?.history) ? body.history : []
    const safeHistory: { role: "user" | "model"; content: string }[] = rawHistory
      .filter((m: any) => m && typeof m.content === "string")
      .slice(-10)
      .map((m: any) => ({
        role: m.role === "model" ? ("model" as const) : ("user" as const),
        content: String(m.content).slice(0, 3000),
      }))

    const messages = [...safeHistory, { role: "user" as const, content: message }]
    const branchId: string | null = body?.branchId || null

    // 1. Gather Knowledge Base matches
    const kbMatches = await searchKnowledgeBase(message).catch(() => "")

    // 2. Build Channel-Specific Instructions
    let extraInstructions = ""
    let stageDetected = "new_prospect"

    if (channel === "call") {
      const isReturning = !!lead.hasApplication
      stageDetected = isReturning ? "returning_applicant" : "new_prospect"

      const leadBrief = isReturning
        ? `=== KNOWN FACTS: LOAN APPLICATION ALREADY ON FILE (RETURNING APPLICANT) ===
- Customer Name: ${lead.name || "Ajay Kumar"}
- Phone: ${lead.phone || "+91 98765 43210"}
- Applied For: ${lead.loanAmount || "sixteen lakh"} ${lead.loanType || "Education Loan"}
- Preferred Tenure: ${lead.loanTenure || "fifteen years"}
- City / Location: ${lead.city || "Hyderabad"}
- Application Ref: ${lead.applicationRef || "LA-8492"}
- Status: ${lead.applicationStatus || "Under Review by loan officer"}
${lead.notes ? `- Notes: ${lead.notes}` : ""}

=== LIVE STATE: LOAN APPLICATION IS ALREADY SUBMITTED (STRICT MANDATE) ===
- The customer has ALREADY submitted their loan application.
- NEVER tell them: "we are sending you a loan application" or "please fill out the application" or "application link పంపిస్తున్నాము".
- Under NO circumstances promise to send them a new loan application link.
- Acknowledge that their application has been received and is actively being reviewed by our loan officer.`
        : `=== KNOWN FACTS: NEW PROSPECT (NO APPLICATION YET) ===
- Customer Name: ${lead.name || "Customer"}
- Phone: ${lead.phone || "Unknown"}
- Loan Need: ${lead.loanAmount || "Seeking information"} ${lead.loanType || "Loan"}
- City: ${lead.city || "Unknown"}`

      extraInstructions = [
        leadBrief,
        kbMatches,
        `=== CALL GROUNDING ===
The customer is speaking with you on a phone call. Caller phone is ${lead.phone || "+91 98765 43210"}.`,
        `=== CONVERSATIONAL ACTIVE LISTENING & DOUBTS CLARIFICATION (DO NOT HANG UP PREMATURELY) ===
- You are on a live phone call. LISTEN PATIENTLY to the customer.
- NEVER cut the call or say "Have a great day / Goodbye / Bye" after only one reply.
- After answering any question, giving status, or confirming details, ALWAYS proactively ask if they have any doubts:
  * Telugu: "మీకు లోన్ గురించి ఇంకా ఏమైనా doubts లేదా ప్రశ్నలు ఉన్నాయా sir?"
  * English: "Do you have any other questions or doubts about your loan, sir?"
  * Hindi: "क्या आपको लोन को लेकर कोई और सवाल या doubt है sir?"
- Answer each doubt clearly and concisely (1 to 2 short sentences).
- ONLY conclude and say goodbye when the customer explicitly says they have no more doubts or says bye (e.g. "no doubts", "emi ledu", "chalu", "bye", "thank you").`,
      ]
        .filter(Boolean)
        .join("\n\n")

      const reply = (
        await chatWithLLM(messages, language, extraInstructions, {
          channel: "call",
          branchId,
        })
      ).trim()

      const isCustomerEnding = CUSTOMER_BYE_RE.test(message.trim())
      const isPriyaEnding = GOODBYE_RE.test(reply)
      const customerHasEnded =
        isCustomerEnding ||
        safeHistory.some(
          (h) => h.role === "user" && CUSTOMER_BYE_RE.test(h.content || "")
        )
      const hangup = isCustomerEnding || (isPriyaEnding && customerHasEnded)

      return NextResponse.json({
        reply,
        channel,
        language,
        hangup,
        isCustomerEnding,
        isPriyaEnding,
        latencyMs: Date.now() - startTime,
        contextUsed: {
          stageDetected,
          leadBrief,
          kbMatches: kbMatches || "No specific FAQ matched",
          brevityRule: "call (1-2 spoken sentences, numbers in English words)",
        },
      })
    }

    if (channel === "whatsapp") {
      const isReturning = !!lead.hasApplication
      stageDetected = isReturning ? "returning_applicant" : "new_prospect"

      const leadBrief = `=== WHATSAPP CHAT CONTACT DETAILS ===
- Customer Name: ${lead.name || "Customer"}
- WhatsApp Number: ${lead.phone || "+91 98765 43210"}
- Status: ${lead.hasApplication ? `Application on file (${lead.applicationRef || "LA-8492"})` : "New prospect"}
- Loan Interest: ${lead.loanAmount || "Loan"} ${lead.loanType || ""}`

      extraInstructions = [
        leadBrief,
        kbMatches,
        `WHATSAPP CHAT FLOW:
- Keep responses short, concise, and easy to read on mobile.
- Use bullet points if listing options or documents.
- If sending an application link, refer to https://lsrightagentservices.com/apply?token=demo-token`,
      ]
        .filter(Boolean)
        .join("\n\n")

      let reply = (
        await chatWithLLM(messages, language, extraInstructions, {
          channel: "whatsapp",
          branchId,
          numPredict: 400,
        })
      ).trim()

      if (reply) reply = reply.replace(/\*\*/g, "*")

      return NextResponse.json({
        reply,
        channel,
        language,
        latencyMs: Date.now() - startTime,
        contextUsed: {
          stageDetected,
          leadBrief,
          kbMatches: kbMatches || "No specific FAQ matched",
          brevityRule: "whatsapp (short text chat, Roman/Tenglish readable)",
        },
      })
    }

    // Instagram DM or Public Comment
    if (channel === "instagram_dm" || channel === "instagram_comment") {
      const isComment = channel === "instagram_comment"
      const template = isComment ? getInstagramCommentTemplates().publicReply : getInstagramDmTemplate()
      const brief = `Instagram Lead: ${lead.name || "Instagram User"} (@${lead.name?.toLowerCase().replace(/\s+/g, "_") || "user"}), Loan: ${lead.loanType || "Home/Business Loan"} ${lead.loanAmount || ""}`

      extraInstructions = renderTemplate(template, {
        brief,
        kbContext: kbMatches || "None",
        rateInfo: "Home loans from 8.40%, Business loans from 11.25%, Education loans from 9.50%",
        emiInfo: "Calculated dynamically per loan requirement",
        dtInfo: new Date().toLocaleDateString("en-IN"),
      })

      const reply = (
        await chatWithLLM(messages, language, extraInstructions, {
          channel: "whatsapp",
          branchId,
        })
      ).trim()

      return NextResponse.json({
        reply,
        channel,
        language,
        latencyMs: Date.now() - startTime,
        contextUsed: {
          stageDetected: "instagram_lead",
          leadBrief: brief,
          kbMatches: kbMatches || "None",
          brevityRule: isComment ? "instagram_comment (public social hook)" : "instagram_dm (social DM lead conversion)",
        },
      })
    }

    return NextResponse.json({ error: "Invalid channel" }, { status: 400 })
  } catch (e: any) {
    console.error("Simulator chat error:", e)
    return NextResponse.json(
      { error: e.message || "Failed to generate simulator reply" },
      { status: 500 }
    )
  }
}
