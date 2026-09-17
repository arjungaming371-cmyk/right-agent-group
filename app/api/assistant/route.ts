import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { chatWithSystemPromptStream } from "@/lib/llm"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

const SYSTEM_PROMPT = `You are the Right Agent Group Executive Operations Co-Pilot & Admin Assistant, integrated into the operations dashboard.

You have full data visibility and execution planning capabilities across:
- Leads pipeline, qualification, and contact details
- Incoming loan applications and approvals
- Priya's Voicebot AI call logs, sentiment, and scripts
- WhatsApp live conversations and escalations
- Knowledge Base entries (product policies, rates, FAQs)
- System compliance, security, and audit logs

EXECUTIVE CAPABILITIES:

1. SCRIPT WRITING & EDITING:
   - When asked to write, tune, or rewrite Priya's voicebot call scripts (e.g. Greeting, Loan pitch, Qualification, Objections, Closing), write complete, conversational, persuasive sales scripts.
   - When proposing to update Priya's script, provide the drafted script text and wrap the proposal in an ACTION PROPOSAL block:
   \`\`\`action_proposal
   {
     "type": "update_script",
     "title": "Update Priya's Script",
     "summary": "Brief 1-line summary of script changes",
     "payload": {
       "language": "base",
       "content": "Full revised script text here..."
     }
   }
   \`\`\`

2. KNOWLEDGE BASE WRITING:
   - When asked to add or update facts, loan interest rates, bank tie-ups, or FAQs that Priya should know during calls and chats, draft the clear facts and propose:
   \`\`\`action_proposal
   {
     "type": "add_kb_entry",
     "title": "Clear entry title",
     "summary": "Brief 1-line summary",
     "payload": {
       "title": "Title of entry",
       "content": "Comprehensive facts and policy details",
       "category": "Loan Policy | Interest Rates | Eligibility | General"
     }
   }
   \`\`\`

3. ADDING LEADS:
   - When given lead details (from chat, voice dictation, or uploaded documents/images), extract the fields and propose:
   \`\`\`action_proposal
   {
     "type": "add_lead",
     "title": "Add Lead: [Customer Name]",
     "summary": "[Phone] · [Product] · ₹[Amount]",
     "payload": {
       "name": "Customer Name",
       "phone": "+91XXXXXXXXXX",
       "product_interest": "personal | home | business | lap | gold | education",
       "loan_amount": 500000,
       "city": "City name",
       "notes": "Any source or context notes"
     }
   }
   \`\`\`

4. DND SUPPRESSION & SECURITY:
   - When requested to block a phone number from calls:
   \`\`\`action_proposal
   {
     "type": "add_dnd",
     "title": "Add to DND: [Phone]",
     "summary": "Block future calls/messages to this number",
     "payload": {
       "phone": "+91XXXXXXXXXX",
       "reason": "Customer request"
     }
   }
   \`\`\`

MANDATORY SAFETY & APPROVAL PROTOCOL:
- You do NOT unilaterally change database records silently.
- Whenever an administrative action is requested, you output the proposed \`\`\`action_proposal ... \`\`\` block in your reply.
- The UI will automatically render an interactive card with [Approve & Apply] and [Reject] buttons.
- State clearly: "I've drafted this proposal for your review. Since this modifies system data, please click 'Approve & Apply' above to execute (Admin role required)."
`

async function getStatsSnapshot(): Promise<string> {
  const [
    leadStatusBreakdown,
    leadsToday,
    totalLeads,
    recentLeads,
    loanAppsBreakdown,
    recentLoanApps,
    callsToday,
    callOutcomeBreakdown,
    langBreakdown,
    recentCalls,
    waUnread,
    totalWaMessages,
    recentWaInbound,
    escalationsToday,
    recentEscalations,
    securitySettings,
    recentAuditLog,
    outboundQueuePending,
    recentUploads,
    teamRoster,
    currentScript,
    topKb,
  ] = await Promise.all([
    query(`SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status ORDER BY n DESC`),
    query(`SELECT COUNT(*)::int AS n FROM leads WHERE created_at > now() - interval '1 day'`),
    query(`SELECT COUNT(*)::int AS n FROM leads`),
    query(`SELECT name, phone, status, interested, score, product_interest FROM leads ORDER BY created_at DESC LIMIT 8`),
    query(`SELECT status, COUNT(*)::int AS n FROM loan_applications GROUP BY status ORDER BY n DESC`),
    query(`SELECT customer_name, loan_type, loan_amount, status, submitted_at FROM loan_applications ORDER BY submitted_at DESC LIMIT 6`),
    query(`SELECT COUNT(*)::int AS n FROM voice_calls WHERE created_at > now() - interval '1 day'`),
    query(`SELECT COALESCE(outcome, status) AS outcome, COUNT(*)::int AS n FROM voice_calls GROUP BY COALESCE(outcome, status) ORDER BY n DESC`),
    query(
      `SELECT language, COUNT(*)::int AS n FROM voice_calls
       WHERE (outcome = 'resolved' OR status = 'completed') AND language IS NOT NULL
       GROUP BY language ORDER BY n DESC LIMIT 1`
    ),
    query(
      `SELECT v.phone, l.name AS lead_name, v.direction, v.outcome, v.sentiment, v.duration, v.created_at
       FROM voice_calls v LEFT JOIN leads l ON v.lead_id = l.id ORDER BY v.created_at DESC LIMIT 6`
    ),
    query(`SELECT COUNT(*)::int AS n FROM whatsapp_messages WHERE direction = 'inbound' AND status = 'received'`).catch(() => ({ rows: [{ n: null }] })),
    query(`SELECT COUNT(*)::int AS n FROM whatsapp_messages`),
    query(
      `SELECT l.name AS lead_name, w.content, w.created_at FROM whatsapp_messages w
       LEFT JOIN leads l ON w.lead_id = l.id WHERE w.direction = 'inbound' ORDER BY w.created_at DESC LIMIT 6`
    ),
    query(`SELECT COUNT(*)::int AS n FROM comm_logs WHERE type = 'alert' AND created_at > now() - interval '1 day'`),
    query(
      `SELECT l.name AS lead_name, c.summary, c.created_at FROM comm_logs c
       LEFT JOIN leads l ON c.lead_id = l.id WHERE c.type = 'alert' ORDER BY c.created_at DESC LIMIT 5`
    ),
    query(`SELECT key, enabled FROM security_settings ORDER BY key`),
    query(
      `SELECT action, performed_by, created_at FROM audit_logs
        WHERE lower(performed_by) NOT IN (SELECT lower(email) FROM allowed_emails WHERE role = 'developer')
        ORDER BY created_at DESC LIMIT 5`
    ),
    query(`SELECT COUNT(*)::int AS n FROM outbound_queue WHERE status = 'pending'`),
    query(`SELECT filename, row_count, status, created_at FROM uploaded_files ORDER BY created_at DESC LIMIT 3`),
    query(`SELECT email, role FROM allowed_emails WHERE role != 'developer' ORDER BY role, email`),
    query(`SELECT language, content FROM ai_scripts WHERE language = 'base' LIMIT 1`).catch(() => ({ rows: [] })),
    query(`SELECT title, category, content FROM knowledge_base WHERE is_active = true ORDER BY created_at DESC LIMIT 5`).catch(() => ({ rows: [] })),
  ])

  const bestLang = langBreakdown.rows[0]
  const fmtDate = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  const fmtMoney = (n: any) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "—")

  const section = (title: string, body: string) => `--- ${title} ---\n${body}`

  const leadsSection = section(
    "LEADS",
    [
      `Total: ${totalLeads.rows[0].n} | New today: ${leadsToday.rows[0].n}`,
      `By status: ${leadStatusBreakdown.rows.map((r: any) => `${r.status}=${r.n}`).join(", ") || "none"}`,
      `Most recent 8: ${recentLeads.rows.map((r: any) => `${r.name || r.phone} (${r.status}, ${r.interested}, score ${r.score}${r.product_interest ? ", " + r.product_interest : ""})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const loansSection = section(
    "LOAN APPLICATIONS",
    [
      `By status: ${loanAppsBreakdown.rows.map((r: any) => `${r.status}=${r.n}`).join(", ") || "none"}`,
      `Most recent 6: ${recentLoanApps.rows.map((r: any) => `${r.customer_name} — ${r.loan_type || "?"} ${fmtMoney(r.loan_amount)} (${r.status}, ${fmtDate(r.submitted_at)})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const callsSection = section(
    "VOICE CALLS",
    [
      `Calls in last 24h: ${callsToday.rows[0].n}`,
      `By outcome: ${callOutcomeBreakdown.rows.map((r: any) => `${r.outcome}=${r.n}`).join(", ") || "none"}`,
      bestLang ? `Best-performing language: ${bestLang.language} (${bestLang.n} resolved)` : `Best-performing language: not enough data yet`,
      `Most recent 6: ${recentCalls.rows.map((r: any) => `${r.lead_name || r.phone} — ${r.direction}, ${r.outcome || "pending"}, ${r.sentiment || "Neutral"}, ${r.duration || 0}s (${fmtDate(r.created_at)})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const waSection = section(
    "WHATSAPP",
    [
      `Total messages: ${totalWaMessages.rows[0].n}${waUnread.rows[0].n !== null ? ` | Unread inbound: ${waUnread.rows[0].n}` : ""}`,
      `Most recent 6 inbound: ${recentWaInbound.rows.map((r: any) => `${r.lead_name || "Unknown"}: "${(r.content || "").slice(0, 60)}" (${fmtDate(r.created_at)})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const scriptSection = section(
    "CURRENT ACTIVE CALL SCRIPT (Priya)",
    currentScript.rows[0]?.content
      ? `Base script excerpt: "${currentScript.rows[0].content.slice(0, 500)}..."`
      : "Default base sales script active."
  )

  const kbSection = section(
    "RECENT KNOWLEDGE BASE ENTRIES",
    topKb.rows.map((k: any) => `[${k.category || "General"}] ${k.title}: ${k.content.slice(0, 100)}...`).join("\n") || "No entries yet."
  )

  const escalationsSection = section(
    "ESCALATIONS (frustration flags)",
    [
      `In last 24h: ${escalationsToday.rows[0].n}`,
      `Most recent 5: ${recentEscalations.rows.map((r: any) => `${r.lead_name || "Unknown"} — "${(r.summary || "").slice(0, 80)}" (${fmtDate(r.created_at)})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const securitySection = section(
    "SECURITY SETTINGS",
    securitySettings.rows.map((r: any) => `${r.key}=${r.enabled ? "ON" : "OFF"}`).join(", ") || "none configured"
  )

  const auditSection = section(
    "AUDIT LOG (most recent 5)",
    recentAuditLog.rows.map((r: any) => `${r.action} by ${r.performed_by || "system"} (${fmtDate(r.created_at)})`).join("; ") || "no entries yet"
  )

  const opsSection = section(
    "UPLOADS & OUTBOUND CAMPAIGNS",
    [
      `Pending in outbound queue: ${outboundQueuePending.rows[0].n}`,
      `Recent uploads: ${recentUploads.rows.map((r: any) => `${r.filename} (${r.row_count} rows, ${r.status})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const teamSection = section(
    "TEAM ROSTER",
    teamRoster.rows.map((r: any) => `${r.email} (${r.role})`).join(", ") || "no teammates added yet (only the admin email)"
  )

  return [
    "LIVE DATA SNAPSHOT (as of right now):",
    leadsSection,
    loansSection,
    callsSection,
    waSection,
    scriptSection,
    kbSection,
    escalationsSection,
    securitySection,
    auditSection,
    opsSection,
    teamSection,
  ].join("\n\n")
}

async function searchDatabase(userMessage: string): Promise<string> {
  try {
    const [leadHits, loanHits] = await Promise.all([
      query(
        `SELECT name, phone, status, product_interest, address, ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
         FROM leads WHERE search_vector @@ websearch_to_tsquery('english', $1) ORDER BY rank DESC LIMIT 8`,
        [userMessage]
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT customer_name, loan_type, loan_amount, status, city, ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
         FROM loan_applications WHERE search_vector @@ websearch_to_tsquery('english', $1) ORDER BY rank DESC LIMIT 8`,
        [userMessage]
      ).catch(() => ({ rows: [] })),
    ])
    if (leadHits.rows.length === 0 && loanHits.rows.length === 0) return ""

    const parts: string[] = []
    if (leadHits.rows.length) {
      parts.push(
        `Matching leads: ${leadHits.rows.map((r: any) => `${r.name || r.phone} (${r.status}${r.product_interest ? ", " + r.product_interest : ""}${r.address ? ", " + r.address : ""})`).join("; ")}`
      )
    }
    if (loanHits.rows.length) {
      parts.push(
        `Matching loan applications: ${loanHits.rows.map((r: any) => `${r.customer_name} — ${r.loan_type || "?"} (${r.status}${r.city ? ", " + r.city : ""})`).join("; ")}`
      )
    }
    return `--- SEARCH RESULTS for this question (full-text search across ALL leads and loan applications) ---\n${parts.join("\n")}`
  } catch (e: any) {
    console.error("assistant search error:", e.message)
    return ""
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const { message, history, chatId, attachment } = body
  if (typeof message !== "string" || !message.trim() || message.length > 5000) {
    return NextResponse.json({ reply: "Please send a valid message." }, { status: 400 })
  }

  // Construct message with attachment context if user uploaded an image/file
  let augmentedMessage = message
  if (attachment && typeof attachment === "object" && attachment.name) {
    augmentedMessage = `[User Attached File: ${attachment.name} (${attachment.type || "file"})]
${attachment.content ? `File Text Preview:\n${attachment.content.slice(0, 3000)}\n---\n` : ""}${message}`
  }

  // Verify the chat belongs to this user before persisting anything to it.
  let ownedChatId: string | null = null
  if (typeof chatId === "string" && chatId) {
    const owns = await query(`SELECT 1 FROM assistant_chats WHERE id = $1 AND user_email = $2`, [chatId, session.email])
    if (owns.rowCount) ownedChatId = chatId
  }

  const [snapshot, searchResults] = await Promise.all([getStatsSnapshot(), searchDatabase(message)])
  const userInfo = `CURRENT USER: ${session.email} | ROLE: ${session.role}`
  const fullContext = [SYSTEM_PROMPT, userInfo, snapshot, searchResults].filter(Boolean).join("\n\n")
  const messages = [...(Array.isArray(history) ? history.slice(-10) : []), { role: "user", content: augmentedMessage }]

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const fullReply = await chatWithSystemPromptStream(
          messages,
          fullContext,
          (delta) => controller.enqueue(encoder.encode(delta)),
          { numCtx: 8192, numPredict: 600, timeoutMs: 90000, historyTurns: 12 }
        )

        if (ownedChatId) {
          await query(
            `INSERT INTO assistant_messages (chat_id, role, content) VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
            [ownedChatId, augmentedMessage, fullReply]
          )
          await query(
            `UPDATE assistant_chats SET updated_at = now(), title = CASE WHEN title = 'New chat' THEN $2 ELSE title END WHERE id = $1`,
            [ownedChatId, message.trim().slice(0, 60)]
          )
        }
      } catch (e: any) {
        console.error("assistant chat error:", e.message)
        controller.enqueue(encoder.encode("Sorry, something went wrong. Please try again."))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
