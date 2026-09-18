import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { chatWithSystemPromptStream } from "@/lib/llm"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

const SYSTEM_PROMPT = `You are the Right Agent Group Executive Operations Commander & AI Assistant, built into the staff dashboard.

You are NOT Priya and you are NOT talking to a customer on a phone call. You are an internal executive AI co-pilot for Right Agent Group staff (admins, branch managers, and loan officers) with full command oversight across: leads, voice calls, loan applications, WhatsApp conversations, Priya's call scripts, Knowledge Base entries, security settings, audit logs, campaigns, and team members.

You also receive LIVE DATA SNAPSHOTS and full-text SEARCH RESULTS covering all records.

==================================================
ADMIN COMMAND & DASHBOARD CONTROL CAPABILITIES:
==================================================
You have direct capability to draft, generate, and propose actions to control the entire dashboard:
1. SCRIPT WRITING & TUNING: Write, refine, and tune Priya's calling scripts (Universal Base, English, Hindi, Telugu) for Personal Loans, Business Loans, Home Loans, etc. Always provide complete, production-ready, objection-tested scripts.
2. KNOWLEDGE BASE WRITING: Draft structured policies, loan product guidelines, document checklists, interest rate cards, and FAQs for the Knowledge Base.
3. ADDING LEADS ("ADDING NEADS"): Create new leads directly from user commands or extracted from attached business cards, screenshots, messages, or files.
4. LEAD & LOAN PIPELINE MANAGEMENT: Update lead statuses (qualified, contacted, callback, lost), adjust scores, add notes, or update loan application stages (approved, underwriting, rejected).
5. DND & COMPLIANCE: Add phone numbers to DND suppression or remove them.
6. SECURITY & SETTINGS: Propose toggling security controls.

==================================================
MANDATORY ADMIN APPROVAL ACTION PROTOCOL:
==================================================
CRITICAL SECURITY RULE: You CANNOT modify the database directly on your own. All dashboard changes require explicit ADMIN COMMAND APPROVAL.

Whenever the user commands or requests ANY change, creation, or update to dashboard data (scripts, knowledge base, leads, loans, DND, security):
1. Provide your complete, high-quality work in your message (e.g. the full script, the full knowledge base article, or the parsed lead summary).
2. Explicitly notify the user: "⚠️ **Admin Approval Required**: Please review the proposed action below and click **Approve & Execute** to apply this change to the dashboard."
3. At the VERY END of your response, append the machine-readable proposal block formatted EXACTLY as:

\`\`\`action:proposal
{
  "type": "update_script" | "add_kb_entry" | "update_kb_entry" | "delete_kb_entry" | "add_lead" | "update_lead" | "update_loan" | "add_dnd" | "remove_dnd" | "toggle_security",
  "title": "<Concise Action Title>",
  "description": "<1-sentence summary of what this action modifies>",
  "payload": { ... }
}
\`\`\`

SUPPORTED ACTION TYPES & PAYLOAD SCHEMAS:
- update_script: { "language": "base", "content": "<full script content>" }
- add_kb_entry: { "title": "<title>", "content": "<content>", "category": "Loans" | "General" | "FAQ" | "Policies" }
- update_kb_entry: { "id": "<id>", "title": "<title>", "content": "<content>", "category": "<category>" }
- delete_kb_entry: { "id": "<id>", "title": "<title>" }
- add_lead: { "name": "<name>", "phone": "<phone>", "product_interest": "personal" | "business" | "home", "loan_amount": <number>, "notes": "<notes>", "city": "<city>", "address": "<address>" }
- update_lead: { "id": "<id>", "phone": "<phone>", "status": "new" | "contacted" | "qualified" | "callback" | "lost", "score": <number>, "notes": "<notes>", "product_interest": "<product>" }
- update_loan: { "id": <number>, "status": "approved" | "underwriting" | "rejected" | "documents_pending", "notes": "<notes>" }
- add_dnd: { "phone": "<phone>", "reason": "<reason>" }
- remove_dnd: { "phone": "<phone>" }
- toggle_security: { "key": "<key>", "enabled": true | false }

RULES:
- When the user asks a question without commanding a change, answer normally without the action proposal block.
- Only output the action proposal block when an actionable dashboard change is intended.
- Format all text in clean, professional markdown with headings and bullet points.`

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
    "ACTIVE CALL SCRIPT EXCERPT",
    currentScript.rows[0]?.content
      ? `"${currentScript.rows[0].content.slice(0, 400)}..."`
      : "Default base script is active."
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
    escalationsSection,
    securitySection,
    auditSection,
    opsSection,
    teamSection,
  ].join("\n\n")
}

async function searchDatabase(userMessage: string): Promise<string> {
  try {
    const cleanMsg = userMessage.trim()
    const digitsOnly = cleanMsg.replace(/\D/g, "")
    const keywords = cleanMsg
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(
        (w) =>
          w.length >= 3 &&
          !["the", "and", "for", "with", "what", "who", "show", "tell", "find", "about", "details", "check", "status", "give", "list", "any", "loan", "lead"].includes(w)
      )

    // Primary: full-text search
    const [leadHits, loanHits] = await Promise.all([
      query(
        `SELECT name, phone, status, product_interest, address, ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
         FROM leads WHERE search_vector @@ websearch_to_tsquery('english', $1) ORDER BY rank DESC LIMIT 8`,
        [cleanMsg]
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT customer_name, loan_type, loan_amount, status, city, ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
         FROM loan_applications WHERE search_vector @@ websearch_to_tsquery('english', $1) ORDER BY rank DESC LIMIT 8`,
        [cleanMsg]
      ).catch(() => ({ rows: [] })),
    ])

    const leadRows = [...leadHits.rows]
    const loanRows = [...loanHits.rows]

    // Secondary / Typo-tolerant Fallback: if few or no hits, match using pg_trgm word_similarity
    if (leadRows.length < 3 || loanRows.length < 3) {
      for (const kw of keywords.slice(0, 3)) {
        if (leadRows.length < 8) {
          const fuzzyLeads = await query(
            `SELECT name, phone, status, product_interest, address, word_similarity($1, COALESCE(name, '')) AS sm
             FROM leads
             WHERE word_similarity($1, COALESCE(name, '')) > 0.28
                OR word_similarity($1, COALESCE(address, '')) > 0.35
                OR word_similarity($1, COALESCE(product_interest, '')) > 0.35
             ORDER BY sm DESC LIMIT 5`,
            [kw]
          ).catch(() => ({ rows: [] }))
          for (const row of fuzzyLeads.rows) {
            if (!leadRows.some((r: any) => r.phone === row.phone)) {
              leadRows.push(row)
            }
          }
        }

        if (loanRows.length < 8) {
          const fuzzyLoans = await query(
            `SELECT customer_name, loan_type, loan_amount, status, city, word_similarity($1, COALESCE(customer_name, '')) AS sm
             FROM loan_applications
             WHERE word_similarity($1, COALESCE(customer_name, '')) > 0.28
                OR word_similarity($1, COALESCE(city, '')) > 0.35
                OR word_similarity($1, COALESCE(loan_type, '')) > 0.35
             ORDER BY sm DESC LIMIT 5`,
            [kw]
          ).catch(() => ({ rows: [] }))
          for (const row of fuzzyLoans.rows) {
            if (!loanRows.some((r: any) => r.customer_name === row.customer_name && r.loan_type === row.loan_type)) {
              loanRows.push(row)
            }
          }
        }
      }

      // Phone query if digits present (>= 5 digits)
      if (digitsOnly.length >= 5) {
        const phoneLeads = await query(
          `SELECT name, phone, status, product_interest, address FROM leads WHERE phone ILIKE ('%' || $1 || '%') LIMIT 5`,
          [digitsOnly]
        ).catch(() => ({ rows: [] }))
        for (const row of phoneLeads.rows) {
          if (!leadRows.some((r: any) => r.phone === row.phone)) {
            leadRows.push(row)
          }
        }
      }
    }

    if (leadRows.length === 0 && loanRows.length === 0) return ""

    const parts: string[] = []
    if (leadRows.length) {
      parts.push(
        `Matching leads: ${leadRows.map((r: any) => `${r.name || r.phone} (${r.status}${r.product_interest ? ", " + r.product_interest : ""}${r.address ? ", " + r.address : ""})`).join("; ")}`
      )
    }
    if (loanRows.length) {
      parts.push(
        `Matching loan applications: ${loanRows.map((r: any) => `${r.customer_name} — ${r.loan_type || "?"} (${r.status}${r.city ? ", " + r.city : ""})`).join("; ")}`
      )
    }
    return `--- SEARCH RESULTS for this question (smart full-text & typo-tolerant fuzzy matching across ALL leads and loan applications) ---\n${parts.join("\n")}`
  } catch (e: any) {
    console.error("assistant search error:", e.message)
    return ""
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { message, history, chatId, attachment } = await req.json().catch(() => ({}) as any)
  if (typeof message !== "string" || !message.trim() || message.length > 5000) {
    return NextResponse.json({ reply: "Please send a valid message." }, { status: 400 })
  }

  let userContent = message
  if (attachment && typeof attachment === "object" && attachment.name) {
    if (attachment.type === "image") {
      userContent = `[User Attached Image: "${attachment.name}"]\nStaff instructions: ${message}`
    } else {
      userContent = `[Attached Document: "${attachment.name}" (${attachment.type || "file"})]\n${attachment.content ? `Document Content Preview:\n${attachment.content.slice(0, 4000)}\n---\n` : ""}${message}`
    }
  }

  // Verify the chat belongs to this user before persisting anything to it.
  let ownedChatId: string | null = null
  if (typeof chatId === "string" && chatId) {
    const owns = await query(`SELECT 1 FROM assistant_chats WHERE id = $1 AND user_email = $2`, [chatId, session.email])
    if (owns.rowCount) ownedChatId = chatId
  }

  const [snapshot, searchResults] = await Promise.all([getStatsSnapshot(), searchDatabase(message)])
  const fullContext = [SYSTEM_PROMPT, snapshot, searchResults].filter(Boolean).join("\n\n")
  const messages = [...(Array.isArray(history) ? history.slice(-10) : []), { role: "user", content: userContent }]

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
            [ownedChatId, userContent, fullReply]
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
