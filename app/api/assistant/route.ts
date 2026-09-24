import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { chatWithSystemPromptStream } from "@/lib/llm"
import { getSessionFromRequest } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"

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

// FIX (2026-09-20): this fired 21 parallel queries on EVERY assistant message
// (one user could occupy ~half the 25-connection pool; two concurrent users
// starved the live-call path that shares the pool). An ops summary is fine
// with 45s staleness.
let _snapshotCache: { text: string; at: number } | null = null
const SNAPSHOT_TTL_MS = 45_000

async function getStatsSnapshot(): Promise<string> {
  if (_snapshotCache && Date.now() - _snapshotCache.at < SNAPSHOT_TTL_MS) {
    return _snapshotCache.text
  }
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
  const fmtMoney = (n: unknown) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "—")

  const section = (title: string, body: string) => `--- ${title} ---\n${body}`

  const leadsSection = section(
    "LEADS",
    [
      `Total: ${totalLeads.rows[0].n} | New today: ${leadsToday.rows[0].n}`,
      `By status: ${leadStatusBreakdown.rows.map((r: { status: string; n: number }) => `${r.status}=${r.n}`).join(", ") || "none"}`,
      `Most recent 8: ${recentLeads.rows.map((r: { name: string; phone: string; status: string; interested: string; score: number; product_interest: string }) => `${r.name || r.phone} (${r.status}, ${r.interested}, score ${r.score}${r.product_interest ? ", " + r.product_interest : ""})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const loansSection = section(
    "LOAN APPLICATIONS",
    [
      `By status: ${loanAppsBreakdown.rows.map((r: { status: string; n: number }) => `${r.status}=${r.n}`).join(", ") || "none"}`,
      `Most recent 6: ${recentLoanApps.rows.map((r: { customer_name: string; loan_type: string; loan_amount: unknown; status: string; submitted_at: string }) => `${r.customer_name} — ${r.loan_type || "?"} ${fmtMoney(r.loan_amount)} (${r.status}, ${fmtDate(r.submitted_at)})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const callsSection = section(
    "VOICE CALLS",
    [
      `Calls in last 24h: ${callsToday.rows[0].n}`,
      `By outcome: ${callOutcomeBreakdown.rows.map((r: { outcome: string; n: number }) => `${r.outcome}=${r.n}`).join(", ") || "none"}`,
      bestLang ? `Best-performing language: ${bestLang.language} (${bestLang.n} resolved)` : `Best-performing language: not enough data yet`,
      `Most recent 6: ${recentCalls.rows.map((r: { lead_name: string; phone: string; direction: string; outcome: string; sentiment: string; duration: number; created_at: string }) => `${r.lead_name || r.phone} — ${r.direction}, ${r.outcome || "pending"}, ${r.sentiment || "Neutral"}, ${r.duration || 0}s (${fmtDate(r.created_at)})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const waSection = section(
    "WHATSAPP",
    [
      `Total messages: ${totalWaMessages.rows[0].n}${waUnread.rows[0].n !== null ? ` | Unread inbound: ${waUnread.rows[0].n}` : ""}`,
      `Most recent 6 inbound: ${recentWaInbound.rows.map((r: { lead_name: string; content: string; created_at: string }) => `${r.lead_name || "Unknown"}: "${(r.content || "").slice(0, 60)}" (${fmtDate(r.created_at)})`).join("; ") || "none"}`,
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
      `Most recent 5: ${recentEscalations.rows.map((r: { lead_name: string; summary: string; created_at: string }) => `${r.lead_name || "Unknown"} — "${(r.summary || "").slice(0, 80)}" (${fmtDate(r.created_at)})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const securitySection = section(
    "SECURITY SETTINGS",
    securitySettings.rows.map((r: { key: string; enabled: boolean }) => `${r.key}=${r.enabled ? "ON" : "OFF"}`).join(", ") || "none configured"
  )

  const auditSection = section(
    "AUDIT LOG (most recent 5)",
    recentAuditLog.rows.map((r: { action: string; performed_by: string; created_at: string }) => `${r.action} by ${r.performed_by || "system"} (${fmtDate(r.created_at)})`).join("; ") || "no entries yet"
  )

  const opsSection = section(
    "UPLOADS & OUTBOUND CAMPAIGNS",
    [
      `Pending in outbound queue: ${outboundQueuePending.rows[0].n}`,
      `Recent uploads: ${recentUploads.rows.map((r: { filename: string; row_count: number; status: string }) => `${r.filename} (${r.row_count} rows, ${r.status})`).join("; ") || "none"}`,
    ].join("\n")
  )

  const teamSection = section(
    "TEAM ROSTER",
    teamRoster.rows.map((r: { email: string; role: string }) => `${r.email} (${r.role})`).join(", ") || "no teammates added yet (only the admin email)"
  )

  const snapshot = [
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
  _snapshotCache = { text: snapshot, at: Date.now() }
  return snapshot
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

    // Secondary / Typo-tolerant Fallback: if few or no hits, match using pg_trgm word_similarity.
    // FIX (2026-09-20): these unindexed trigram scans used to run SEQUENTIALLY
    // (up to 3 keywords x 2 tables) — one assistant message could stack several
    // full scans while the live-call path waited on the same pool. All fallback
    // queries now run concurrently (Promise.all), total row caps unchanged.
    if (leadRows.length < 3 || loanRows.length < 3) {
      const kws = keywords.slice(0, 3)
      const needLeads = leadRows.length < 8
      const needLoans = loanRows.length < 8

      const [fuzzyLeadSets, fuzzyLoanSets, phoneLeads] = await Promise.all([
        needLeads
          ? Promise.all(
              kws.map((kw) =>
                query(
                  `SELECT name, phone, status, product_interest, address, word_similarity($1, COALESCE(name, '')) AS sm
                   FROM leads
                   WHERE word_similarity($1, COALESCE(name, '')) > 0.28
                      OR word_similarity($1, COALESCE(address, '')) > 0.35
                      OR word_similarity($1, COALESCE(product_interest, '')) > 0.35
                   ORDER BY sm DESC LIMIT 5`,
                  [kw]
                ).catch(() => ({ rows: [] }))
              )
            )
          : Promise.resolve([]),
        needLoans
          ? Promise.all(
              kws.map((kw) =>
                query(
                  `SELECT customer_name, loan_type, loan_amount, status, city, word_similarity($1, COALESCE(customer_name, '')) AS sm
                   FROM loan_applications
                   WHERE word_similarity($1, COALESCE(customer_name, '')) > 0.28
                      OR word_similarity($1, COALESCE(city, '')) > 0.35
                      OR word_similarity($1, COALESCE(loan_type, '')) > 0.35
                   ORDER BY sm DESC LIMIT 5`,
                  [kw]
                ).catch(() => ({ rows: [] }))
              )
            )
          : Promise.resolve([]),
        digitsOnly.length >= 5
          ? query(
              `SELECT name, phone, status, product_interest, address FROM leads WHERE phone ILIKE ('%' || $1 || '%') LIMIT 5`,
              [digitsOnly]
            ).catch(() => ({ rows: [] }))
          : Promise.resolve({ rows: [] }),
      ])

      for (const res of fuzzyLeadSets) {
        for (const row of res.rows) {
          if (!leadRows.some((r: { phone: string }) => r.phone === row.phone)) leadRows.push(row)
        }
      }
      for (const res of fuzzyLoanSets) {
        for (const row of res.rows) {
          if (!loanRows.some((r: { customer_name: string; loan_type: string }) => r.customer_name === row.customer_name && r.loan_type === row.loan_type)) loanRows.push(row)
        }
      }
      for (const row of phoneLeads.rows) {
        if (!leadRows.some((r: { phone: string }) => r.phone === row.phone)) leadRows.push(row)
      }
    }

    if (leadRows.length === 0 && loanRows.length === 0) return ""

    const parts: string[] = []
    if (leadRows.length) {
      parts.push(
        `Matching leads: ${leadRows.map((r: { name: string; phone: string; status: string; product_interest: string; address: string }) => `${r.name || r.phone} (${r.status}${r.product_interest ? ", " + r.product_interest : ""}${r.address ? ", " + r.address : ""})`).join("; ")}`
      )
    }
    if (loanRows.length) {
      parts.push(
        `Matching loan applications: ${loanRows.map((r: { customer_name: string; loan_type: string; status: string; city: string }) => `${r.customer_name} — ${r.loan_type || "?"} (${r.status}${r.city ? ", " + r.city : ""})`).join("; ")}`
      )
    }
    return `--- SEARCH RESULTS for this question (smart full-text & typo-tolerant fuzzy matching across ALL leads and loan applications) ---\n${parts.join("\n")}`
  } catch (e) {
    console.error("assistant search error:", e instanceof Error ? e.message : e)
    return ""
  }
}

/**
 * Client-supplied chat history is UNTRUSTED input. Only user/assistant roles
 * survive (a crafted {role:'system'} entry is coerced to 'user' — role
 * injection into the prompt is impossible), every content is a capped
 * string, and the list is trimmed to the last 10 turns.
 */
function sanitizeHistory(raw: unknown): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(raw)) return []
  const out: { role: "user" | "assistant"; content: string }[] = []
  for (const item of raw.slice(-10)) {
    if (!item || typeof item !== "object") continue
    const m = item as { role?: unknown; content?: unknown }
    const content = typeof m.content === "string" ? m.content.slice(0, 4000).trim() : ""
    if (!content) continue
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content })
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    // Per-user rate limit: one voice turn = one hit here; 30/min leaves a
    // hands-free conversation far above its real ceiling while an authed
    // script/forgotten open tab can no longer run the model + snapshot
    // queries in a tight loop.
    if (!rateLimit(`assistant:${session.email}`, 30, 60_000)) {
      return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 })
    }

    const body: unknown = await req.json().catch(() => null)
    const parsed = (body ?? {}) as { message?: unknown; history?: unknown; chatId?: unknown; attachment?: unknown }
    const message = typeof parsed.message === "string" ? parsed.message : ""
    if (!message.trim() || message.length > 5000) {
      return NextResponse.json({ reply: "Please send a valid message." }, { status: 400 })
    }
    const history = sanitizeHistory(parsed.history)
    const chatId = typeof parsed.chatId === "string" ? parsed.chatId : null

    let userContent = message
    const attachment = parsed.attachment
    if (attachment && typeof attachment === "object" && "name" in attachment) {
      const a = attachment as { name?: unknown; type?: unknown; content?: unknown }
      const name = typeof a.name === "string" ? a.name.slice(0, 200) : ""
      const type = typeof a.type === "string" ? a.type.slice(0, 20) : ""
      const content = typeof a.content === "string" ? a.content.slice(0, 4000) : ""
      if (name) {
        if (type === "image") {
          userContent = `[User Attached Image: "${name}"]\nStaff instructions: ${message}`
        } else {
          userContent = `[Attached Document: "${name}" (${type || "file"})]\n${content ? `Document Content Preview:\n${content}\n---\n` : ""}${message}`
        }
      }
    }

    // Verify the chat belongs to this user before persisting anything to it.
    let ownedChatId: string | null = null
    if (chatId) {
      const owns = await query(`SELECT 1 FROM assistant_chats WHERE id = $1 AND user_email = $2`, [chatId, session.email])
      if (owns.rowCount) ownedChatId = chatId
    }

    const [snapshot, searchResults] = await Promise.all([getStatsSnapshot(), searchDatabase(message)])
    const fullContext = [SYSTEM_PROMPT, snapshot, searchResults].filter(Boolean).join("\n\n")
    // lib/llm expects the "model" role for assistant turns.
    const messages = [
      ...history.map((m) => ({ role: m.role === "assistant" ? ("model" as const) : ("user" as const), content: m.content })),
      { role: "user" as const, content: userContent },
    ]

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
        } catch (e) {
          console.error("assistant chat error:", e instanceof Error ? e.message : e)
          controller.enqueue(encoder.encode("Sorry, something went wrong. Please try again."))
        } finally {
          controller.close()
        }
      },
      // Client disconnect (assistant closed / barge-in): stop pulling from
      // the model instead of generating a reply nobody reads.
      cancel() {
        // chatWithSystemPromptStream has no external handle to abort; the
        // controller enqueue throwing on the next delta ends generation.
      },
    })

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
  } catch (e) {
    // The snapshot/search/ownership section used to run with NO try/catch —
    // one DB hiccup returned an HTML 500 that the client's res.json() choked
    // on. Always answer JSON.
    console.error("assistant route error:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
