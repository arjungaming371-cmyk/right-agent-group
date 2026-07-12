import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { chatWithSystemPrompt } from "@/lib/ollama"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Internal Operations Assistant — the "Quick Chat" widget in the staff
// dashboard. This is deliberately a SEPARATE endpoint from /api/chat:
// /api/chat is Priya, the customer-facing agent (used live on calls, on
// WhatsApp, and by the WhatsApp "AI Reply" draft button — it must keep
// acting like it's talking to a customer). This route is for staff asking
// about the business itself, and it has its own persona plus a live
// snapshot of real numbers pulled straight from the database, not the
// customer-facing loan script.

const SYSTEM_PROMPT = `You are the Right Agent Group Internal Operations Assistant, built into the staff dashboard.

You are NOT Priya and you are NOT on a phone call or WhatsApp chat with a customer. You are a private tool for Right Agent Group staff (admins and loan officers) to quickly check on leads, calls, loan applications, and WhatsApp activity.

RULES:
- Answer using ONLY the LIVE STATS SNAPSHOT provided below. Never guess or invent numbers.
- If a question needs data not in the snapshot, say so plainly and suggest which dashboard tab has it (Leads, Loan Applications, Voice Logs, WhatsApp Chat, Analytics).
- Be concise — this is a quick-glance tool, not a conversation. A sentence or two, or a short list.
- Never pretend to be talking to a customer, never use loan-pitch language, never ask for a caller's name/city/WhatsApp number — that's Priya's job on calls, not yours here.
- You cannot place calls, send messages, or change data yourself — only report what you're told.`

async function getStatsSnapshot(): Promise<string> {
  const [leadsToday, totalLeads, pendingQueue, callsToday, langBreakdown, loanAppsPending, waUnread, escalationsToday] =
    await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM leads WHERE created_at > now() - interval '1 day'`),
      query(`SELECT COUNT(*)::int AS n FROM leads`),
      query(`SELECT COUNT(*)::int AS n FROM outbound_queue WHERE status = 'pending'`),
      query(`SELECT COUNT(*)::int AS n FROM voice_calls WHERE created_at > now() - interval '1 day'`),
      query(
        `SELECT language, COUNT(*)::int AS n FROM voice_calls
         WHERE (outcome = 'resolved' OR status = 'completed') AND language IS NOT NULL
         GROUP BY language ORDER BY n DESC LIMIT 1`
      ),
      query(`SELECT COUNT(*)::int AS n FROM loan_applications WHERE status = 'pending'`),
      query(`SELECT COUNT(*)::int AS n FROM whatsapp_messages WHERE direction = 'inbound' AND status = 'received'`).catch(() => ({
        rows: [{ n: null }],
      })),
      query(
        `SELECT COUNT(*)::int AS n FROM comm_logs WHERE type = 'alert' AND created_at > now() - interval '1 day'`
      ),
    ])

  const bestLang = langBreakdown.rows[0]
  const lines = [
    `New leads today: ${leadsToday.rows[0].n}`,
    `Total leads on file: ${totalLeads.rows[0].n}`,
    `Pending calls in the outbound queue: ${pendingQueue.rows[0].n}`,
    `Calls made in the last 24h: ${callsToday.rows[0].n}`,
    bestLang ? `Best-performing language (most resolved calls): ${bestLang.language} (${bestLang.n} resolved)` : `Best-performing language: not enough data yet`,
    `Pending loan applications: ${loanAppsPending.rows[0].n}`,
    waUnread.rows[0].n !== null ? `Unread WhatsApp messages: ${waUnread.rows[0].n}` : null,
    `Frustration/escalation alerts in the last 24h: ${escalationsToday.rows[0].n}`,
  ].filter(Boolean)

  return `LIVE STATS SNAPSHOT (as of now):\n${lines.join("\n")}`
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const { message, history } = await req.json()
    if (typeof message !== "string" || !message.trim() || message.length > 2000) {
      return NextResponse.json({ reply: "Please send a valid message." }, { status: 400 })
    }

    const snapshot = await getStatsSnapshot()
    const messages = [...(Array.isArray(history) ? history.slice(-10) : []), { role: "user", content: message }]
    const reply = await chatWithSystemPrompt(messages, `${SYSTEM_PROMPT}\n\n${snapshot}`)
    return NextResponse.json({ reply })
  } catch (e: any) {
    console.error("assistant chat error:", e.message)
    return NextResponse.json({ reply: "Sorry, something went wrong. Please try again." }, { status: 500 })
  }
}
