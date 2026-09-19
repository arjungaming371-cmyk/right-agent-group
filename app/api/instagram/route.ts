import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import pool, { query } from "@/lib/db"
import { chatWithLLM, detectLanguage, type Language } from "@/lib/llm"
import {
  sendInstagramText,
  replyInstagramComment,
  privateReplyInstagramComment,
  type BranchInstagramCtx,
} from "@/lib/instagram"
import { buildLeadBrief } from "@/lib/lead-brain"
import { searchKnowledgeBase } from "@/lib/knowledge-base"
import { buildEmiInstruction, buildRateInstruction, detectLoanType } from "@/lib/finance"
import { currentDateTimeInstruction } from "@/lib/compliance"
import { rateLimit, clientIp } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// Meta Instagram Webhook API
//
// GET  → Meta verification handshake (hub.challenge echo)
// POST → Inbound Instagram DMs + Post Comments + Delivery receipts

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode === "subscribe" && token && token === (process.env.INSTAGRAM_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "")) {
    return new Response(challenge || "", { status: 200 })
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 })
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`ig-webhook:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const raw = await req.text()
  const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.WHATSAPP_APP_SECRET || ""

  if (!appSecret && process.env.ALLOW_UNSIGNED_WEBHOOK !== "1") {
    console.error("🚫 Rejecting Instagram webhook: INSTAGRAM_APP_SECRET is not set (fail-closed).")
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 })
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
      // 1. Handle Inbound Direct Messages (DMs)
      for (const msg of entry?.messaging || []) {
        if (msg.message && !msg.message.is_echo) {
          await handleInboundDM(msg)
        }
      }

      // 2. Handle Inbound Post Comments
      for (const change of entry?.changes || []) {
        if (change.field === "comments" && change.value) {
          await handleInboundComment(change.value)
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("Instagram webhook error:", e.message)
    return NextResponse.json({ ok: true }) // Always return 200 to prevent Meta retry loops
  }
}

/**
 * Process Inbound Instagram Direct Message (DM).
 */
async function handleInboundDM(messaging: any) {
  const senderId = messaging.sender?.id
  const text = messaging.message?.text || ""
  const messageId = messaging.message?.mid

  if (!senderId || !text) return

  // Deduplicate
  if (messageId) {
    const dup = await query(`SELECT 1 FROM instagram_messages WHERE ig_message_id = $1 LIMIT 1`, [messageId])
    if (dup.rows.length > 0) return
  }

  // Find or Create Lead
  let leadId: string | null = null
  let phone = `IG_${senderId.slice(-8)}`

  const existingLead = await query(
    `SELECT id, name, phone, notes FROM leads WHERE notes ILIKE $1 OR instagram_handle ILIKE $1 LIMIT 1`,
    [`%${senderId}%`]
  )

  if (existingLead.rows.length > 0) {
    leadId = existingLead.rows[0].id
    phone = existingLead.rows[0].phone
  } else {
    // Create auto lead
    const newLead = await query(
      `INSERT INTO leads (name, phone, source, status, notes) VALUES ($1, $2, 'Instagram DM', 'New', $3) RETURNING id`,
      [`IG User (${senderId.slice(-4)})`, phone, `Instagram User ID: ${senderId}`]
    )
    if (newLead.rows.length > 0) {
      leadId = newLead.rows[0].id
    }
  }

  // Record Inbound DM
  await query(
    `INSERT INTO instagram_messages (lead_id, ig_user_id, direction, type, content, status, ig_message_id)
     VALUES ($1, $2, 'inbound', 'dm', $3, 'delivered', $4)`,
    [leadId, senderId, text, messageId || null]
  )

  // Record Comm Log
  if (leadId) {
    await query(
      `INSERT INTO comm_logs (lead_id, channel, direction, content) VALUES ($1, 'instagram', 'inbound', $2)`,
      [leadId, text]
    ).catch(() => {})
  }

  // Trigger Priya AI Response
  try {
    const brief = leadId ? await buildLeadBrief(leadId).catch(() => "") : ""
    const kbContext = await searchKnowledgeBase(text).catch(() => "")

    const dtInfo = currentDateTimeInstruction()
    const loanType = detectLoanType(text)
    const emiRes = buildEmiInstruction(text, { loanType })
    const emiInfo = emiRes ? emiRes.instruction : ""
    const rateInfo = buildRateInstruction(text, { loanType }) || ""

    const extraInstructions = `You are Priya, senior home & business loan advisor at Right Agent Group.
You are communicating with a client via Instagram Direct Message (DM).
Be warm, professional, helpful, and concise.

Client Details:
${brief}

Knowledge Base Facts:
${kbContext || "None"}

Loan Guidance:
${rateInfo}
${emiInfo}
${dtInfo}

Instructions:
- Keep your answer under 100 words (Instagram DM friendly).
- Answer the customer's question directly.
- Ask a helpful follow-up question to qualify their loan needs.`

    const aiReply = await chatWithLLM(
      [{ role: "user", content: text }],
      "english",
      extraInstructions
    )

    if (aiReply) {
      // Send DM reply via Meta Graph API
      const sent = await sendInstagramText(senderId, aiReply)
      if (sent.ok) {
        // Record outbound DM
        await query(
          `INSERT INTO instagram_messages (lead_id, ig_user_id, direction, type, content, status, ig_message_id)
           VALUES ($1, $2, 'outbound', 'dm', $3, 'sent', $4)`,
          [leadId, senderId, aiReply, sent.messageId || null]
        )

        if (leadId) {
          await query(
            `INSERT INTO comm_logs (lead_id, channel, direction, content) VALUES ($1, 'instagram', 'outbound', $2)`,
            [leadId, aiReply]
          ).catch(() => {})
        }
      }
    }
  } catch (e: any) {
    console.error("Priya AI Instagram DM error:", e.message)
  }
}

/**
 * Process Inbound Instagram Post Comment.
 */
async function handleInboundComment(val: any) {
  const commentId = val.id
  const text = val.text || ""
  const fromUser = val.from || {}
  const senderId = fromUser.id
  const username = fromUser.username || "instagram_user"
  const mediaId = val.media?.id

  if (!commentId || !text || !senderId) return

  // Deduplicate
  const dup = await query(`SELECT 1 FROM instagram_messages WHERE comment_id = $1 LIMIT 1`, [commentId])
  if (dup.rows.length > 0) return

  // Find or Create Lead
  let leadId: string | null = null
  const existingLead = await query(
    `SELECT id FROM leads WHERE instagram_handle ILIKE $1 OR notes ILIKE $2 LIMIT 1`,
    [`%${username}%`, `%${senderId}%`]
  )

  if (existingLead.rows.length > 0) {
    leadId = existingLead.rows[0].id
  } else {
    const phone = `IG_${senderId.slice(-8)}`
    const newLead = await query(
      `INSERT INTO leads (name, phone, source, status, notes, instagram_handle) VALUES ($1, $2, 'Instagram Comment', 'New', $3, $4) RETURNING id`,
      [`@${username}`, phone, `Instagram User ID: ${senderId}`, username]
    )
    if (newLead.rows.length > 0) {
      leadId = newLead.rows[0].id
    }
  }

  // Save Inbound Comment Record
  await query(
    `INSERT INTO instagram_messages (lead_id, ig_user_id, ig_username, direction, type, content, status, comment_id, media_id)
     VALUES ($1, $2, $3, 'inbound', 'comment', $4, 'delivered', $5, $6)`,
    [leadId, senderId, username, text, commentId, mediaId || null]
  )

  // Trigger Priya AI Response (Public Reply + Private DM Reply)
  try {
    const kbContext = await searchKnowledgeBase(text).catch(() => "")

    const extraInstructions = `You are Priya, senior loan advisor at Right Agent Group responding to a public Instagram post comment from @${username}.
Be friendly, helpful, concise, and professional.

Knowledge Base:
${kbContext || "None"}

Provide a short public reply (under 40 words) acknowledging their comment and offering help.`

    const publicAiReply = await chatWithLLM(
      [{ role: "user", content: text }],
      "english",
      extraInstructions
    )

    if (publicAiReply) {
      // 1. Send Public Comment Reply
      const pubSent = await replyInstagramComment(commentId, publicAiReply)
      if (pubSent.ok) {
        await query(
          `INSERT INTO instagram_messages (lead_id, ig_user_id, ig_username, direction, type, content, status, comment_id)
           VALUES ($1, $2, $3, 'outbound', 'comment', $4, 'sent', $5)`,
          [leadId, senderId, username, publicAiReply, pubSent.replyId || commentId]
        )
      }

      // 2. Send Private DM Reply to Commenter
      const privateDmText = `Hi @${username}! Thanks for commenting on our post. I'm Priya from Right Agent Group. How can I assist you with your home or business loan enquiry today?`
      const privSent = await privateReplyInstagramComment(commentId, privateDmText)
      if (privSent.ok) {
        await query(
          `INSERT INTO instagram_messages (lead_id, ig_user_id, ig_username, direction, type, content, status, ig_message_id)
           VALUES ($1, $2, $3, 'outbound', 'dm', $4, 'sent', $5)`,
          [leadId, senderId, username, privateDmText, privSent.messageId || null]
        )
      }
    }
  } catch (e: any) {
    console.error("Priya AI Instagram Comment error:", e.message)
  }
}
