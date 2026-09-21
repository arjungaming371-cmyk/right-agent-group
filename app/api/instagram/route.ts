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
//
// 2026-09-20 hardening:
//  - Lead matching is EXACT (leads.ig_user_id column, or legacy exact
//    notes/handle equality). The old `notes ILIKE '%<id>%'` substring match
//    let an attacker pick a username that is a SUBSTRING of a real lead's
//    handle/notes and hijack that lead's thread — leaking the victim's PII
//    (name, phone, loan details) into a conversation with the attacker via
//    buildLeadBrief.
//  - DM dedupe is atomic (INSERT ... ON CONFLICT) instead of
//    check-then-insert, and comments get a partial UNIQUE index.
//  - Branch is resolved from the webhook entry id (branches.instagram_account_id)
//    and stamped on every row — inbound IG rows used to get branch_id NULL,
//    so branch users saw zero inbound IG conversations.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token") || ""
  const challenge = searchParams.get("hub.challenge")
  // FIX (2026-09-20): constant-time compare.
  const a = Buffer.from(token)
  const b = Buffer.from(process.env.INSTAGRAM_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "")
  if (mode === "subscribe" && a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)) {
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

  if (appSecret && process.env.ALLOW_UNSIGNED_WEBHOOK !== "1") {
    const sig = req.headers.get("x-hub-signature-256") || ""
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex")
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn("⚠️ Instagram webhook signature mismatch")
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
      // Branch routing (2026-09-20): entry.id is the WBA / IG professional
      // account id the event arrived on. A branch whose instagram_account_id
      // matches claims the conversation (mirrors WhatsApp's phone_number_id
      // routing). Unmatched → null = company default.
      let branchId: string | null = null
      try {
        if (entry?.id) {
          const b = await query(`SELECT id FROM branches WHERE instagram_account_id = $1 LIMIT 1`, [String(entry.id)])
          branchId = b.rows[0]?.id || null
        }
      } catch (e: any) {
        if (e?.code !== "42703") throw e // column not added yet → stay on default branch
      }

      // 1. Handle Inbound Direct Messages (DMs) — one poison event must not
      //    drop its siblings (same fix as the WhatsApp webhook).
      for (const msg of entry?.messaging || []) {
        if (msg.message && !msg.message.is_echo) {
          try {
            await handleInboundDM(msg, branchId)
          } catch (e: any) {
            console.error(`inbound IG DM failed (continuing): ${e.message}`)
          }
        }
      }

      // 2. Handle Inbound Post Comments
      for (const change of entry?.changes || []) {
        if (change.field === "comments" && change.value) {
          try {
            await handleInboundComment(change.value, branchId)
          } catch (e: any) {
            console.error(`inbound IG comment failed (continuing): ${e.message}`)
          }
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
 * Exact-match the lead for an IG identity. NEVER substring-match free text:
 * a commenter's username is attacker-chosen, and "%123%" matches any notes
 * containing those digits (phone numbers, amounts) — cross-lead PII leak.
 * Falls back to the legacy EXACT markers written by older versions.
 */
async function findLeadByIgIdentity(senderId: string, username: string | null): Promise<{ id: string; phone: string | null } | null> {
  const r = await query(
    `SELECT id, phone FROM leads
     WHERE ig_user_id = $1
        OR notes = $2
        OR ($3::text IS NOT NULL AND lower(instagram_handle) = lower($3))
     ORDER BY created_at DESC
     LIMIT 1`,
    [senderId, `Instagram User ID: ${senderId}`, username]
  ).catch(async (e: any) => {
    if (e?.code !== "42703") throw e // leads.ig_user_id not added yet → legacy columns only
    return query(
      `SELECT id, phone FROM leads
       WHERE notes = $1
          OR ($2::text IS NOT NULL AND lower(instagram_handle) = lower($2))
       ORDER BY created_at DESC
       LIMIT 1`,
      [`Instagram User ID: ${senderId}`, username]
    )
  })
  return r.rows[0] || null
}

/**
 * Process Inbound Instagram Direct Message (DM).
 */
async function handleInboundDM(messaging: any, branchId: string | null = null) {
  const senderId = messaging.sender?.id
  const text = messaging.message?.text || ""
  const messageId = messaging.message?.mid

  if (!senderId || !text) return

  // FIX (2026-09-20): atomic claim — concurrent Meta retries can no longer
  // both pass a SELECT and both run the AI pipeline (duplicate DMs).
  let claimed = false
  if (messageId) {
    const claim = await query(
      `INSERT INTO instagram_messages (ig_user_id, direction, type, content, status, ig_message_id, branch_id)
       VALUES ($1, 'inbound', 'dm', '', 'delivered', $2, $3)
       ON CONFLICT (ig_message_id) DO NOTHING`,
      [senderId, messageId, branchId]
    )
    claimed = (claim.rowCount || 0) > 0
    if (!claimed) return // duplicate delivery
  }

  // Find or Create Lead — EXACT identity match only.
  const existing = await findLeadByIgIdentity(senderId, null)
  let leadId: string | null = existing?.id || null
  if (!leadId) {
    // FIX (2026-09-20): stop fabricating `IG_12345678` phone numbers — they
    // collided in phone_key (two IG users sharing the last-8 digits broke
    // inserts) and polluted analytics. Phone stays NULL for IG-only leads;
    // the IG identity lives in ig_user_id / notes.
    const newLead = await query(
      `INSERT INTO leads (name, phone, source, status, notes, ig_user_id)
       VALUES ($1, NULL, 'Instagram DM', 'new', $2, $3) RETURNING id`,
      [`IG User (${senderId.slice(-4)})`, `Instagram User ID: ${senderId}`, senderId]
    ).catch(async (e: any) => {
      if (e?.code !== "42703") throw e
      return query(
        `INSERT INTO leads (name, phone, source, status, notes)
         VALUES ($1, NULL, 'Instagram DM', 'new', $2) RETURNING id`,
        [`IG User (${senderId.slice(-4)})`, `Instagram User ID: ${senderId}`]
      )
    })
    leadId = newLead.rows[0]?.id || null
  }

  // Fill in the claimed row (or insert fresh when no message id exists).
  if (messageId) {
    await query(
      `UPDATE instagram_messages SET lead_id = $1, content = $2 WHERE ig_message_id = $3 AND direction = 'inbound'`,
      [leadId, text, messageId]
    )
  } else {
    await query(
      `INSERT INTO instagram_messages (lead_id, ig_user_id, direction, type, content, status, branch_id)
       VALUES ($1, $2, 'inbound', 'dm', $3, 'delivered', $4)`,
      [leadId, senderId, text, branchId]
    )
  }

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
          `INSERT INTO instagram_messages (lead_id, ig_user_id, direction, type, content, status, ig_message_id, branch_id)
           VALUES ($1, $2, 'outbound', 'dm', $3, 'sent', $4, $5)`,
          [leadId, senderId, aiReply, sent.messageId || null, branchId]
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
async function handleInboundComment(val: any, branchId: string | null = null) {
  const commentId = val.id
  const text = val.text || ""
  const fromUser = val.from || {}
  const senderId = fromUser.id
  const username = fromUser.username || "instagram_user"
  const mediaId = val.media?.id

  if (!commentId || !text || !senderId) return

  // FIX (2026-09-20): comments had NO dedupe constraint at all — two
  // concurrent webhook retries double-processed and double-replied publicly.
  // Claim atomically; the partial UNIQUE index comes from migration
  // 2026-09-20_security_hardening.sql (graceful fallback for old DBs).
  let claimed = false
  try {
    const claim = await query(
      `INSERT INTO instagram_messages (ig_user_id, ig_username, direction, type, content, status, comment_id, media_id, branch_id)
       VALUES ($1, $2, 'inbound', 'comment', '', 'delivered', $3, $4, $5)
       ON CONFLICT (comment_id) WHERE comment_id IS NOT NULL DO NOTHING`,
      [senderId, username, commentId, mediaId || null, branchId]
    )
    claimed = (claim.rowCount || 0) > 0
  } catch (e: any) {
    if (e?.code === "42703") {
      const dup = await query(`SELECT 1 FROM instagram_messages WHERE comment_id = $1 LIMIT 1`, [commentId])
      claimed = dup.rows.length === 0
    } else if (e?.code === "23505") {
      claimed = false // unique violation on a legacy full-index install
    } else {
      throw e
    }
  }
  if (!claimed) return

  // Find or Create Lead — EXACT handle/identity match (never substring).
  const existing = await findLeadByIgIdentity(senderId, username)
  let leadId: string | null = existing?.id || null
  if (!leadId) {
    const newLead = await query(
      `INSERT INTO leads (name, phone, source, status, notes, instagram_handle, ig_user_id)
       VALUES ($1, NULL, 'Instagram Comment', 'new', $2, $3, $4) RETURNING id`,
      [`@${username}`, `Instagram User ID: ${senderId}`, username, senderId]
    ).catch(async (e: any) => {
      if (e?.code !== "42703") throw e
      return query(
        `INSERT INTO leads (name, phone, source, status, notes, instagram_handle)
         VALUES ($1, NULL, 'Instagram Comment', 'new', $2, $3) RETURNING id`,
        [`@${username}`, `Instagram User ID: ${senderId}`, username]
      )
    })
    leadId = newLead.rows[0]?.id || null
  }

  // Fill in the claimed comment row.
  await query(
    `UPDATE instagram_messages SET lead_id = $1, content = $2 WHERE comment_id = $3 AND direction = 'inbound'`,
    [leadId, text, commentId]
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
          `INSERT INTO instagram_messages (lead_id, ig_user_id, ig_username, direction, type, content, status, comment_id, branch_id)
           VALUES ($1, $2, $3, 'outbound', 'comment', $4, 'sent', $5, $6)`,
          [leadId, senderId, username, publicAiReply, pubSent.replyId || commentId, branchId]
        )
      }

      // 2. Send Private DM Reply to Commenter
      const privateDmText = `Hi @${username}! Thanks for commenting on our post. I'm Priya from Right Agent Group. How can I assist you with your home or business loan enquiry today?`
      const privSent = await privateReplyInstagramComment(commentId, privateDmText)
      if (privSent.ok) {
        await query(
          `INSERT INTO instagram_messages (lead_id, ig_user_id, ig_username, direction, type, content, status, ig_message_id, branch_id)
           VALUES ($1, $2, $3, 'outbound', 'dm', $4, 'sent', $5, $6)`,
          [leadId, senderId, username, privateDmText, privSent.messageId || null, branchId]
        )
      }
    }
  } catch (e: any) {
    console.error("Priya AI Instagram Comment error:", e.message)
  }
}
