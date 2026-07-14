import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import pool, { query } from "@/lib/db"
import { chatWithOllama, detectLanguage, type Language } from "@/lib/ollama"
import { sendWhatsAppText } from "@/lib/whatsapp"
import { buildLeadBrief } from "@/lib/lead-brain"
import { searchKnowledgeBase } from "@/lib/knowledge-base"
import { detectFrustration, flagFrustratedWhatsApp } from "@/lib/frustration"
import { createNotification } from "@/lib/notifications"
import { refreshLeadScore } from "@/lib/scoring"

export const dynamic = "force-dynamic"

// Official WhatsApp Cloud API webhook.
//
// GET  → Meta's one-time verification handshake (hub.challenge echo).
// POST → inbound customer messages + delivery/read receipts.
//
// Robust design (unchanged from the self-hosted version):
// 1. Lead matched by LAST 10 DIGITS — works for any phone format.
// 2. Inbound message ALWAYS saved first — even if AI fails.
// 3. AI reply isolated in its own try/catch.
// 4. NEW: dedupe by wa_message_id — Meta retries webhooks, we process once.
// 5. NEW: delivery/read receipts update message status (dashboard ticks ✓✓).

// ---- GET: webhook verification (Meta calls this once during setup) ----
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")
  if (mode === "subscribe" && token && token === (process.env.WHATSAPP_VERIFY_TOKEN || "")) {
    return new Response(challenge || "", { status: 200 })
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 })
}

// ---- POST: messages + statuses ----
export async function POST(req: NextRequest) {
  const raw = await req.text()

  // Signature check — proves the request really came from Meta.
  // REQUIRED in production: without WHATSAPP_APP_SECRET this public endpoint
  // accepts forged payloads from anyone (junk leads, wasted AI, spam sends).
  const appSecret = process.env.WHATSAPP_APP_SECRET || ""
  if (!appSecret) {
    console.warn("⚠️ WHATSAPP_APP_SECRET not set — accepting UNSIGNED webhook request. Set it in .env before going live!")
  }
  if (appSecret) {
    const sig = req.headers.get("x-hub-signature-256") || ""
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex")
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 })
    }
  }

  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  try {
    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value
        if (!value) continue

        // -- Delivery / read receipts → update ticks in the dashboard --
        for (const status of value.statuses || []) {
          if (!status?.id || !status?.status) continue
          await query(
            `UPDATE whatsapp_messages SET status = $1 WHERE wa_message_id = $2 AND direction = 'outbound'`,
            [status.status, status.id] // sent → delivered → read
          ).catch(() => {})
        }

        // -- Inbound customer messages --
        const profileName: string | null = value.contacts?.[0]?.profile?.name || null
        for (const msg of value.messages || []) {
          await handleInbound(msg, profileName)
        }
      }
    }
    // Always 200 fast — Meta retries anything else, and dedupe makes retries safe.
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("whatsapp webhook error:", e.message)
    return NextResponse.json({ ok: true }) // still 200: never make Meta re-deliver a poison payload forever
  }
}

async function handleInbound(msg: any, profileName: string | null) {
  const from = String(msg?.from || "").replace(/\D/g, "")
  const waMessageId = msg?.id ? String(msg.id) : null
  // Text messages carry the body; media/interactive arrive as placeholders
  // so the operator still sees that SOMETHING came in.
  const text =
    msg?.type === "text"
      ? String(msg.text?.body || "").slice(0, 4000)
      : msg?.type === "button"
        ? String(msg.button?.text || "").slice(0, 4000)
        : `[${msg?.type || "media"} message]`
  if (!from || !text) return

  // ---- Dedupe: Meta retries webhooks; process each message exactly once ----
  if (waMessageId) {
    const dup = await query(`SELECT 1 FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1`, [waMessageId])
    if (dup.rows.length > 0) return
  }

  const last10 = from.slice(-10)
  console.log(`📩 WhatsApp inbound from ${from}: "${text.slice(0, 50)}"`)

  // ---- 1. Find-or-create lead (race-safe via advisory lock) ----
  let lead: any = null
  let isNewContact = false
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [last10])
    const found = await client.query(
      `SELECT * FROM leads WHERE regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1 LIMIT 1`,
      [last10]
    )
    if (found.rows.length > 0) {
      lead = found.rows[0]
    } else {
      isNewContact = true
      const created = await client.query(
        `INSERT INTO leads (name, phone, whatsapp_number, source, status)
         VALUES ($1, $2, $2, 'whatsapp', 'new') RETURNING *`,
        [profileName || `WA ${last10}`, `+${from}`]
      )
      lead = created.rows[0]
    }
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    client.release()
    throw e
  }
  client.release()

  // ---- 2. ALWAYS save the inbound message first ----
  await query(
    `INSERT INTO whatsapp_messages (lead_id, wa_message_id, phone_number, direction, content, status)
     VALUES ($1, $2, $3, 'inbound', $4, 'received')`,
    [lead.id, waMessageId, `+${from}`, text]
  ).catch(() =>
    query(
      `INSERT INTO whatsapp_messages (lead_id, wa_message_id, direction, content, status)
       VALUES ($1, $2, 'inbound', $3, 'received')`,
      [lead.id, waMessageId, text]
    )
  )

  if (isNewContact) {
    createNotification({
      type: "whatsapp_message",
      title: "New WhatsApp contact",
      body: `${lead.name || lead.phone}: "${text.slice(0, 100)}"`,
      linkView: "whatsapp",
    })
  }

  // Don't burn an Ollama generation on "[image message]" placeholders.
  if (text.startsWith("[") && text.endsWith(" message]")) return

  // ---- 3. AI auto-reply (isolated — failure never loses the message) ----
  // FREE: replies inside the 24h service window cost nothing on the Cloud API.
  let aiReply: string | null = null
  try {
    const lang = detectLanguage(text) as Language
    const historyRes = await query(
      `SELECT role, content FROM ai_conversations WHERE lead_id = $1 ORDER BY created_at ASC LIMIT 15`,
      [lead.id]
    )
    const messages = [
      ...historyRes.rows.map((h: any) => ({ role: h.role as "user" | "model", content: h.content })),
      { role: "user" as const, content: text },
    ]

    // FRUSTRATION RADAR: same keyword pass used on calls, applied to WhatsApp too.
    if (detectFrustration(text, historyRes.rows)) {
      flagFrustratedWhatsApp(lead.id, text)
    }

    // LEAD BRAIN: brief the WhatsApp AI with the same cross-channel picture
    // Priya gets on calls — known facts, rolling summary, recent
    // interactions, sentiment warnings — only on the first couple of turns.
    let extraContext: string | undefined
    if (historyRes.rows.length <= 2) {
      extraContext = (await buildLeadBrief(lead.id)) || undefined
    }

    // KNOWLEDGE BASE: every turn, same reasoning as the voice path — a
    // question can arrive at any point in the chat, not just the opener.
    const kbContext = await searchKnowledgeBase(text)
    if (kbContext) extraContext = [extraContext, kbContext].filter(Boolean).join("\n\n")

    aiReply = await chatWithOllama(messages, lang, extraContext)

    await query(
      `INSERT INTO ai_conversations (lead_id, role, content, language) VALUES ($1, 'user', $2, $3), ($1, 'model', $4, $3)`,
      [lead.id, text, lang, aiReply]
    ).catch(() => {})
  } catch (e: any) {
    console.error("AI reply failed (message still saved):", e.message)
  }

  // ---- 4. Send the reply if AI produced one ----
  if (aiReply) {
    const sent = await sendWhatsAppText(from, aiReply)
    await query(
      `INSERT INTO whatsapp_messages (lead_id, wa_message_id, phone_number, direction, content, status)
       VALUES ($1, $2, $3, 'outbound', $4, $5)`,
      [lead.id, sent.id || null, `+${from}`, aiReply, sent.ok ? "sent" : "failed"]
    ).catch(() =>
      query(
        `INSERT INTO whatsapp_messages (lead_id, direction, content, status) VALUES ($1, 'outbound', $2, $3)`,
        [lead.id, aiReply, sent.ok ? "sent" : "failed"]
      )
    )
    await query(
      `INSERT INTO comm_logs (lead_id, type, summary, outcome) VALUES ($1, 'whatsapp', $2, $3)`,
      [lead.id, `WA: "${text.slice(0, 60)}" → AI replied`, sent.ok ? "replied" : "reply_failed"]
    ).catch(() => {})
  }

  refreshLeadScore(lead.id).catch(() => {})
}
