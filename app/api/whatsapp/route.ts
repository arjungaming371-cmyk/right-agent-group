import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import pool, { query } from "@/lib/db"
import { chatWithLLM, detectLanguage, type Language } from "@/lib/llm"
import { sendWhatsAppText, downloadBranchWhatsAppMedia, answerWhatsAppCall, rejectWhatsAppCall, type BranchWhatsAppCtx } from "@/lib/whatsapp"
import { finalizeWhatsAppCall, mapCallOutcome, callSidFor } from "@/lib/whatsapp-call-finalize"
import { resolveBranchByWhatsAppPhoneId, type BranchRow } from "@/lib/branches"
import { buildLeadBrief } from "@/lib/lead-brain"
import { searchKnowledgeBase } from "@/lib/knowledge-base"
import { buildEmiInstruction, buildEligibilityInstruction, buildRateInstruction, detectLoanType } from "@/lib/finance"
import { detectFrustration, flagFrustratedWhatsApp } from "@/lib/frustration"
import { createNotification } from "@/lib/notifications"
import { refreshLeadScore } from "@/lib/scoring"
import { maybeProposeLoanEdit } from "@/lib/loan-edit-requests"
import { extractPdfText } from "@/lib/kb-ingest"
import { transcribeAudio } from "@/lib/stt"
import { currentDateTimeInstruction } from "@/lib/compliance"
import { rateLimit, clientIp } from "@/lib/rate-limit"

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
  const token = searchParams.get("hub.verify_token") || ""
  const challenge = searchParams.get("hub.challenge")
  // FIX (2026-09-20): constant-time compare, matching the rest of the auth pass.
  const a = Buffer.from(token)
  const b = Buffer.from(process.env.WHATSAPP_VERIFY_TOKEN || "")
  if (mode === "subscribe" && a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)) {
    return new Response(challenge || "", { status: 200 })
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 })
}

// ---- POST: messages + statuses ----
export async function POST(req: NextRequest) {
  if (!rateLimit(`wa-webhook:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const raw = await req.text()

  // Signature check — proves the request really came from Meta.
  // REQUIRED in production: without WHATSAPP_APP_SECRET this public endpoint
  // would accept forged payloads from anyone (junk leads, wasted AI, spam sends).
  // FAIL-CLOSED since the 2026-09 security pass: an unsigned public webhook is
  // a worse outcome than a blocked one. For local development without Meta,
  // set ALLOW_UNSIGNED_WEBHOOK=1 in .env to restore the old fail-open behaviour.
  const appSecret = process.env.WHATSAPP_APP_SECRET || ""
  if (!appSecret && process.env.ALLOW_UNSIGNED_WEBHOOK !== "1") {
    console.error("🚫 Rejecting WhatsApp webhook: WHATSAPP_APP_SECRET is not set (fail-closed). " +
      "Set WHATSAPP_APP_SECRET in .env, or ALLOW_UNSIGNED_WEBHOOK=1 for local dev only.")
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
      for (const change of entry?.changes || []) {
        const value = change?.value
        if (!value) continue

        // MULTI-BRANCH ROUTING: metadata.phone_number_id is the WhatsApp
        // Business number the customer wrote to. A branch with its own WABA
        // number claims its conversations here; everything else lands on the
        // company's default (env-credentialed) number. Voice calls use the
        // same resolution — the call is served by the branch that owns the
        // CALLED number.
        let branch: BranchRow | null = null
        const phoneNumberId = value?.metadata?.phone_number_id
        if (phoneNumberId) {
          branch = await resolveBranchByWhatsAppPhoneId(phoneNumberId)
          if (branch) console.log(`🏷 WhatsApp inbound routed to branch ${branch.code} (phone_number_id match)`)
        }
        const waBranch: BranchWhatsAppCtx = branch
          ? { id: branch.id, whatsappToken: branch.whatsapp_token, whatsappPhoneNumberId: branch.whatsapp_phone_number_id, brandName: branch.brand_name }
          : null

        // ---- VOICE CALLS (field "calls", WhatsApp Business Calling API) ----
        // A change value carries EITHER call events OR messages/statuses —
        // never both. Handle the calls (branch already resolved above — the
        // call is served by the branch that owns the CALLED WhatsApp number)
        // and move on.
        if (Array.isArray(value.calls) && value.calls.length > 0) {
          try {
            await handleCallEvents(value.calls, waBranch, phoneNumberId)
          } catch (e: any) {
            console.error("whatsapp call event error (batch continues):", e.message)
          }
          continue
        }

        // -- Delivery / read receipts → update ticks in the dashboard --
        for (const status of value.statuses || []) {
          if (!status?.id || !status?.status) continue
          await query(
            `UPDATE whatsapp_messages SET status = $1 WHERE wa_message_id = $2 AND direction = 'outbound'`,
            [status.status, status.id] // sent → delivered → read
          ).catch(() => {})
        }

        // -- Inbound customer messages --
        // FIX (2026-09-20): one poison message used to abort the WHOLE batch —
        // a duplicate delivery as message #1 of a multi-message payload
        // swallowed messages #2..n permanently (Meta got a 200 and never
        // retried). Isolate each message in its own try/catch.
        const profileName: string | null = value.contacts?.[0]?.profile?.name || null
        for (const msg of value.messages || []) {
          try {
            await handleInbound(msg, profileName, waBranch)
          } catch (e: any) {
            console.error(`inbound message ${msg?.id || "(no id)"} failed — continuing with the rest of the batch:`, e.message)
          }
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

// PDF documents (salary slips, ID proof, bank statements) and voice notes
// are read, not just acknowledged with a placeholder: PDFs get their text
// extracted (reusing the same parser as knowledge-base ingestion), voice
// notes get transcribed through the Sarvam cloud STT that already backs live
// calls, and shared locations become tappable Maps links. Images and video
// now carry their media id in the row itself (2026-09-22) so the dashboard
// renders them natively — the AI still sees a placeholder (vision model is
// genuinely different work, not in scope here).
// Media downloads use the BRANCH's token when the message arrived on a
// branch's WABA number — the media ID belongs to that account.
async function resolveInboundText(msg: any, branch: BranchWhatsAppCtx = null): Promise<string> {
  if (msg?.type === "text") return String(msg.text?.body || "").slice(0, 4000)
  if (msg?.type === "button") return String(msg.button?.text || "").slice(0, 4000)

  if (msg?.type === "document" && msg.document?.id) {
    const filename = msg.document?.filename || "document.pdf"
    if ((msg.document?.mime_type || "") !== "application/pdf") {
      return `[document message: ${filename} — only PDF documents can be read]`
    }
    const media = await downloadBranchWhatsAppMedia(msg.document.id, branch)
    if (!media) return `[document message: ${filename} — could not download]`
    try {
      const extracted = (await extractPdfText(media.buffer)).replace(/\s+/g, " ").trim().slice(0, 3000)
      if (extracted) return `[Customer sent a PDF document: ${filename}]\n${extracted}`
    } catch (e: any) {
      console.error("WhatsApp PDF extraction error:", e.message)
    }
    return `[document message: ${filename} — could not read text from this PDF]`
  }

  if (msg?.type === "audio" && msg.audio?.id) {
    const media = await downloadBranchWhatsAppMedia(msg.audio.id, branch)
    if (media) {
      const transcribed = await transcribeAudio(media.buffer)
      if (transcribed) return transcribed
    }
    return `[voice message — could not transcribe]`
  }

  // Location shares are useful to the AI (follow-up, distance, branch advice)
  // and to staff — render as a tappable Google Maps link.
  if (msg?.type === "location" && msg.location) {
    const { latitude, longitude, name, address } = msg.location
    const label = [name, address].filter(Boolean).join(" — ")
    if (latitude != null && longitude != null) {
      return `📍 Customer shared their location${label ? ` (${label})` : ""}: https://maps.google.com/?q=${latitude},${longitude}`
    }
  }

  return `[${msg?.type || "media"} message]`
}

async function handleInbound(msg: any, profileName: string | null, waBranch: BranchWhatsAppCtx = null) {
  const from = String(msg?.from || "").replace(/\D/g, "")
  const waMessageId = msg?.id ? String(msg.id) : null
  if (!from) return

  // ---- RICH MESSAGE: REACTIONS (2026-09-22 real-WhatsApp parity) ----
  // A reaction is metadata ON an existing message, not a message of its own:
  // it must never claim a dedupe row or create a lead/chat bubble. Meta
  // delivers { type: "reaction", reaction: { message_id, emoji } }; an empty
  // emoji means "removed my reaction". Applied to inbound AND outbound rows
  // (customers can react to our replies — the dashboard shows that chip).
  if (msg?.type === "reaction") {
    const target = msg.reaction?.message_id ? String(msg.reaction.message_id) : null
    const emoji = String(msg.reaction?.emoji || "")
    if (target) {
      try {
        await query(
          `UPDATE whatsapp_messages SET reaction = NULLIF($1, '') WHERE wa_message_id = $2`,
          [emoji, target]
        )
        console.log(`😊 WhatsApp reaction ${emoji || "(removed)"} on msg=***${target.slice(-6)}`)
      } catch (e: any) {
        if (e?.code === "42703") {
          // Pre-migration DB (2026-09-22_whatsapp_rich_chat not run) — ignore
        } else if (e?.code === "22P02") {
          // target id not one of ours (or hex short form) — ignore
        } else {
          console.error("reaction store failed:", e.message)
        }
      }
    }
    return // done — no bubble, no AI, no lead work
  }

  // ---- FIX (2026-09-20): ATOMIC, FIRST-THING dedupe ----
  // Two problems in the old order:
  //   1. The dedupe check ran AFTER media download / PDF extraction / STT —
  //      every Meta retry of a media message re-paid the full download +
  //      transcribe cost only to be discarded at the check.
  //   2. Dedupe was check-then-insert (SELECT then INSERT later) — two
  //      concurrent deliveries both passed the SELECT and both ran the full
  //      AI-reply pipeline (double sends). Claiming the row atomically via
  //      INSERT ... ON CONFLICT DO NOTHING (backed by the partial UNIQUE index
  //      on wa_message_id) makes exactly one delivery win the pipeline.
  if (waMessageId) {
    let claim: { rowCount: number | null }
    try {
      claim = await query(
        `INSERT INTO whatsapp_messages (wa_message_id, phone_number, direction, content, status, branch_id)
         VALUES ($1, $2, 'inbound', '', 'received', $3)
         ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING`,
        [waMessageId, `+${from}`, waBranch?.id || null]
      )
    } catch (e: any) {
      if (e?.code !== "42703") throw e // 42703 = undefined column (pre-multi-branch DB) → retry without branch_id
      claim = await query(
        `INSERT INTO whatsapp_messages (wa_message_id, phone_number, direction, content, status)
         VALUES ($1, $2, 'inbound', '', 'received')
         ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING`,
        [waMessageId, `+${from}`]
      )
    }
    if (claim.rowCount === 0) return // already processed — stop before any media work
  }

  const text = await resolveInboundText(msg, waBranch)
  if (!text) return

  // ---- RICH MESSAGE FIELDS (2026-09-22) ----
  // Media (image/video/audio/document/sticker), replies-that-quote, and
  // location all carry structured data the UI renders natively now. The
  // AI-facing `text` above stays unchanged (caption/transcript/placeholder).
  const richType = ["image", "video", "audio", "document", "sticker", "location"].includes(msg?.type) ? String(msg.type) : "text"
  const mediaObj = msg?.image || msg?.video || msg?.audio || msg?.document || msg?.sticker || null
  const mediaId = mediaObj?.id ? String(mediaObj.id) : null
  const mediaMime = mediaObj?.mime_type ? String(mediaObj.mime_type) : null
  const mediaName = msg?.document?.filename ? String(msg.document.filename) : null
  const quotedWaId = msg?.context?.id ? String(msg.context.id) : null
  let quotedText: string | null = null
  let quotedFrom: string | null = null
  if (quotedWaId) {
    // Resolve the quoted message locally (cached into the row so the UI never
    // needs a second lookup). Meta's context.quoted_content is unreliable.
    const q = await query(
      `SELECT content, direction FROM whatsapp_messages WHERE wa_message_id = $1 LIMIT 1`,
      [quotedWaId]
    ).catch(() => ({ rows: [] as any[] }))
    quotedText = (q.rows[0]?.content || msg?.context?.quoted_content?.body || "").toString().slice(0, 300) || "[message]"
    quotedFrom = q.rows[0]?.direction || null
  }

  const last10 = from.slice(-10)
  // FIX (2026-09-20): no customer phone/message content in stdout logs.
  console.log(`📩 WhatsApp inbound msg=${waMessageId || "(no id)"} from=***${from.slice(-4)} (${text.length} chars, branch=${waBranch?.id || "default"})`)

  // ---- 1. Find-or-create lead (race-safe via advisory lock) ----
  let lead: any = null
  let isNewContact = false
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [last10])
    // FIX (2026-09-20): use the indexed phone_key (exact last-10) first — the
    // old regexp/LIKE predicate seq-scans leads on EVERY inbound message.
    // Graceful fallback for DBs that haven't run the 2026-09-09 migration.
    let found: { rows: any[] }
    try {
      found = await client.query(
        `SELECT * FROM leads WHERE phone_key = $1
         UNION ALL
         SELECT * FROM (SELECT * FROM leads WHERE regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1 LIMIT 1) fallback
         LIMIT 1`,
        [last10]
      )
    } catch (e: any) {
      if (e?.code !== "42703") throw e
      found = await client.query(
        `SELECT * FROM leads WHERE regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1 LIMIT 1`,
        [last10]
      )
    }
    if (found.rows.length > 0) {
      lead = found.rows[0]
      // Lead may have been created from a phone call (whatsapp_number never
      // set) — the fact that they're texting us on WhatsApp right now IS
      // their WhatsApp number. Backfill it so the AI can see it as a known
      // fact and never has to ask for it.
      if (!lead.whatsapp_number) {
        const updated = await client.query(
          `UPDATE leads SET whatsapp_number = $1 WHERE id = $2 RETURNING *`,
          [`+${from}`, lead.id]
        )
        lead = updated.rows[0]
      }
    } else {
      isNewContact = true
      const created = await client.query(
        `INSERT INTO leads (name, phone, whatsapp_number, source, status, branch_id)
         VALUES ($1, $2, $2, 'whatsapp', 'new', $3) RETURNING *`,
        [profileName || `WA ${last10}`, `+${from}`, waBranch?.id || null]
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

  // ---- 2. Fill in the message row claimed above (or insert fresh) ----
  // The claim already inserted the dedupe row; update it with the real
  // content/lead. If the claim was skipped (no wa_message_id) this INSERTs.
  if (waMessageId) {
    try {
      await query(
        `UPDATE whatsapp_messages
            SET lead_id = $1, content = $2, branch_id = $3,
                msg_type = $4, media_id = $5, media_mime = $6, media_name = $7,
                quoted_wa_id = $8, quoted_text = $9, quoted_from = $10
          WHERE wa_message_id = $11 AND direction = 'inbound'`,
        [lead.id, text, waBranch?.id || null, richType, mediaId, mediaMime, mediaName, quotedWaId, quotedText, quotedFrom, waMessageId]
      )
    } catch (e: any) {
      if (e?.code !== "42703") throw e // 42703 = rich-chat migration not run → legacy columns only
      await query(
        `UPDATE whatsapp_messages SET lead_id = $1, content = $2, branch_id = $3
         WHERE wa_message_id = $4 AND direction = 'inbound'`,
        [lead.id, text, waBranch?.id || null, waMessageId]
      ).catch(() =>
        query(
          `INSERT INTO whatsapp_messages (lead_id, wa_message_id, direction, content, status)
           VALUES ($1, $2, 'inbound', $3, 'received')
           ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING`,
          [lead.id, waMessageId, text]
        )
      )
    }
  } else {
    // Legacy path (no wa_message_id): try the rich columns, fall back cleanly.
    try {
      await query(
        `INSERT INTO whatsapp_messages (lead_id, wa_message_id, phone_number, direction, content, status, branch_id,
                                       msg_type, media_id, media_mime, media_name, quoted_wa_id, quoted_text, quoted_from)
         VALUES ($1, $2, $3, 'inbound', $4, 'received', $5, $6, $7, $8, $9, $10, $11, $12)`,
        [lead.id, waMessageId, `+${from}`, text, waBranch?.id || null, richType, mediaId, mediaMime, mediaName, quotedWaId, quotedText, quotedFrom]
      )
    } catch (e: any) {
      if (e?.code !== "42703") throw e
      await query(
        `INSERT INTO whatsapp_messages (lead_id, wa_message_id, phone_number, direction, content, status, branch_id)
         VALUES ($1, $2, $3, 'inbound', $4, 'received', $5)`,
        [lead.id, waMessageId, `+${from}`, text, waBranch?.id || null]
      )
    }
  }

  if (isNewContact) {
    createNotification({
      type: "whatsapp_message",
      title: "New WhatsApp contact",
      body: `${lead.name || lead.phone}: "${text.slice(0, 100)}"`,
      linkView: "whatsapp",
    })
  }

  // Don't burn an LLM generation on "[image message]" placeholders.
  if (text.startsWith("[") && text.endsWith(" message]")) return

  // ---- 3. AI auto-reply (isolated — failure never loses the message) ----
  // FREE: replies inside the 24h service window cost nothing on the Cloud API.
  let aiReply: string | null = null
  try {
    const lang = detectLanguage(text) as Language
    // Newest 15 rows, flipped back to chronological — ASC LIMIT would pin the
    // context to the oldest 15 messages forever once a chat outgrows the limit.
    const historyRes = await query(
      `SELECT role, content FROM (
         SELECT role, content, created_at FROM ai_conversations WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 15
       ) recent ORDER BY created_at ASC`,
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

    // CHANNEL OVERRIDE: the shared script is written for live phone calls —
    // without this the AI "speaks" on WhatsApp (call greetings, hold-style
    // brevity) instead of texting like a chat agent.
    let extraContext: string | undefined =
      "IMPORTANT — CHANNEL: This conversation is a WhatsApp TEXT CHAT, not a phone call. " +
      "Never use call phrases (no 'thanks for calling', 'I'll call you back', 'on this call'). " +
      "The phone-call-only rules DO NOT apply here: on WhatsApp you SHOULD discuss interest " +
      "rates, EMI, eligibility, and loan details directly — you ARE the WhatsApp follow-up the " +
      "call script promises, so never say a loan officer will send details 'on WhatsApp' later. " +
      "Answer the customer's question yourself, completely, using the knowledge-base context when " +
      "provided. Quote rates, amounts, and tenures EXACTLY as written in the knowledge context — " +
      "never invent, round, or adjust numbers; if a detail isn't in the context, say the loan " +
      "officer will confirm it. Reply like a professional WhatsApp chat agent: friendly and " +
      "complete answers, WhatsApp formatting allowed (single-asterisk *bold* only — never " +
      "**double** — and bullet lists), as long as needed to answer properly. " +
      "NEVER ask for their WhatsApp number — the number they are texting you from RIGHT NOW " +
      "is their WhatsApp number, you already have it. If the base script's goal mentions " +
      "collecting a WhatsApp number, treat that as already done on this channel — do not ask, " +
      "do not confirm it, just skip straight to name and city if those are still missing."

    // DATE/TIME AWARENESS: same reasoning as the voice path — without this
    // the model has no idea what the real date/time is.
    extraContext = [extraContext, currentDateTimeInstruction()].filter(Boolean).join("\n\n")

    // LEAD BRAIN: brief the WhatsApp AI with the same cross-channel picture
    // Priya gets on calls — known facts, rolling summary, recent
    // interactions, sentiment warnings — every turn. Raw history alone isn't
    // reliable enough at tracking "already answered" facts (observed live:
    // the model re-asked for a name/WhatsApp number the customer had already
    // given), so the brief's explicit "don't re-ask known facts" instruction
    // needs to stay in context for the whole conversation, not just the open.
    //
    // SPEED: brief / KB search / income lookup are three independent reads
    // that used to run as three separate sequential awaits — none needs
    // another's result. Same fix as the voice path (lib/voice-conversation.ts):
    // firing them together cuts the stacked wait down to whichever is
    // slowest, which matters more per-message the more chats are active at once.
    const [brief, kbContext, memRow] = await Promise.all([
      buildLeadBrief(lead.id),
      searchKnowledgeBase(text),
      query(`SELECT facts->>'monthly_income' AS income FROM lead_memory WHERE lead_id = $1`, [lead.id]),
    ])
    if (brief) extraContext = [extraContext, brief].join("\n\n")
    if (kbContext) extraContext = [extraContext, kbContext].filter(Boolean).join("\n\n")

    // REAL MATH: same reasoning as the voice path (lib/finance.ts) — Priya
    // states an exact code-computed EMI instead of an LLM-guessed one.
    // Loan type may have been mentioned earlier in the thread, not this
    // message — scan the whole recent conversation, same as the call path.
    const conversationSoFar = [...historyRes.rows.map((h: any) => h.content), text].join(" ")
    const detectedType = detectLoanType(conversationSoFar) || lead.product_interest || null
    if (detectedType && detectedType !== lead.product_interest) {
      query(`UPDATE leads SET product_interest = $1 WHERE id = $2`, [detectedType, lead.id]).catch(() => {})
    }

    const rate = buildRateInstruction(text, { loanType: detectedType })
    if (rate) extraContext = [extraContext, rate].filter(Boolean).join("\n\n")

    const emi = buildEmiInstruction(text, {
      loanAmount: lead.loan_amount ? Number(lead.loan_amount) : null,
      loanType: detectedType,
    })
    if (emi) extraContext = [extraContext, emi.instruction].filter(Boolean).join("\n\n")

    const eligibility = buildEligibilityInstruction(text, {
      loanType: detectedType,
      monthlyIncome: memRow.rows[0]?.income ? Number(memRow.rows[0].income) : null,
    })
    if (eligibility) extraContext = [extraContext, eligibility.instruction].filter(Boolean).join("\n\n")

    // numPredict 400: text chat has no caller waiting in silence — let Priya
    // write full answers (rate tables, loan lists) instead of call-length ones.
    // timeoutMs 45s: nobody is on hold for a WhatsApp reply the way they are
    // on a live call — worth the extra wait to actually get a reply instead
    // of the CPU-fallback model timing out on a 400-token generation.
    // branchId: per-branch script overrides + white-label identity apply on
    // WhatsApp too — the branch's AI Employee speaks for THAT branch.
    aiReply = await chatWithLLM(messages, lang, extraContext, { numPredict: 400, timeoutMs: 45000, branchId: waBranch?.id || null })
    // WhatsApp bold is *single*; the model still slips in markdown ** sometimes.
    if (aiReply) aiReply = aiReply.replace(/\*\*/g, "*")

    await query(
      `INSERT INTO ai_conversations (lead_id, role, content, language) VALUES ($1, 'user', $2, $3), ($1, 'model', $4, $3)`,
      [lead.id, text, lang, aiReply]
    ).catch(() => {})
  } catch (e: any) {
    console.error("AI reply failed (message still saved):", e.message)
  }

  // ---- 4. Send the reply if AI produced one ----
  if (aiReply) {
    // Sends from the BRANCH's WABA number when the message arrived on one —
    // the conversation stays on the number the customer actually wrote to.
    const sent = await sendWhatsAppText(from, aiReply, waBranch)
    await query(
      `INSERT INTO whatsapp_messages (lead_id, wa_message_id, phone_number, direction, content, status, branch_id)
       VALUES ($1, $2, $3, 'outbound', $4, $5, $6)`,
      [lead.id, sent.id || null, `+${from}`, aiReply, sent.ok ? "sent" : "failed", waBranch?.id || null]
    ).catch(() =>
      query(
        `INSERT INTO whatsapp_messages (lead_id, direction, content, status) VALUES ($1, 'outbound', $2, $3)`,
        [lead.id, aiReply, sent.ok ? "sent" : "failed"]
      )
    )
    await query(
      `INSERT INTO comm_logs (lead_id, type, summary, outcome) VALUES ($1, 'whatsapp', $2, $3)`,
      // On failure the Meta rejection reason rides in the summary — the Comm
      // Log view then answers "why is this customer not getting our replies"
      // without touching pm2 logs (expired token, 24h window 131047…).
      [lead.id, `WA: "${text.slice(0, 60)}" → AI replied${sent.ok ? "" : ` — FAILED: ${sent.error || "unknown error"}`}`, sent.ok ? "replied" : "reply_failed"]
    ).catch(() => {})
  }

  refreshLeadScore(lead.id).catch(() => {})

  // LOAN EDIT REQUESTS: fire-and-forget, after the customer already has
  // their reply — never adds latency, never writes to loan_applications
  // itself, only flags a pending row for staff to approve/reject.
  maybeProposeLoanEdit(lead.id, "priya_whatsapp", text)
}

// ============================================================================
// VOICE CALLS — WhatsApp Business Calling API (field "calls")
// ============================================================================
// Inbound flow (the free path — Meta charges nothing for user-initiated
// calls):
//
//   1. Customer taps the call button on the business's WhatsApp number.
//   2. Meta webhook: value.calls[] event "connect" with session.sdp (offer).
//   3. We forward the offer to the voicebot's loopback bridge
//      (server/whatsapp-calls.js), which answers via werift and returns our
//      SDP answer.
//   4. Graph API POST /{phone_number_id}/calls — action=pre_accept then
//      action=accept, both carrying the answer. Meta bridges the audio.
//   5. The voicebot runs Priya (Sarvam STT → /api/calls/turn (Groq) →
//      Cartesia TTS) over the WebRTC leg.
//   6. Customer hangs up → Meta "terminate" webhook → voicebot reports the
//      real duration → finalizeWhatsAppCall (chat bubble, follow-up
//      templates, sentiment, summary, Lead Brain) — the same post-call flow
//      Exotel calls get from /api/calls/status.
//
// Env: WHATSAPP_VOICE_CALLS=0 disables handling entirely (default on).
//      VOICEBOT_INTERNAL_URL (default http://127.0.0.1:3003).
//      WHATSAPP_SERVICE_KEY — the shared internal key (also used for turns).

const VOICEBOT_URL = (process.env.VOICEBOT_INTERNAL_URL || "http://127.0.0.1:3003").replace(/\/$/, "")

async function bridgeToVoicebot(path: string, payload: Record<string, any>, timeoutMs = 8000): Promise<any> {
  const res = await fetch(`${VOICEBOT_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.WHATSAPP_SERVICE_KEY || "" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `voicebot HTTP ${res.status}`)
  return data
}

async function handleCallEvents(calls: any[], waBranch: BranchWhatsAppCtx, phoneNumberId?: string | null) {
  // Master switch: a deployment without the voicebot (or werift) keeps
  // receiving messages; calls just decline instead of hanging on dead ring.
  if (process.env.WHATSAPP_VOICE_CALLS === "0") {
    for (const call of calls) {
      if (call?.event === "connect" && (call.call_id || call.id)) {
        await rejectWhatsAppCall(String(call.call_id || call.id), waBranch)
      }
    }
    return
  }

  for (const call of calls) {
    const callId = call?.call_id ? String(call.call_id) : (call?.id ? String(call.id) : "")
    const event = String(call?.event || "")

    if (event === "connect" && callId) {
      const from = String(call?.from || "")
      const to = String(call?.to || "")
      // Meta puts the WebRTC offer in session.sdp (sdp_type "offer"); accept
      // both shapes defensively — some webhook versions nest differently.
      const offerSdp = String(call?.session?.sdp || call?.sdp?.sdp || "")
      const sdpType = String(call?.session?.sdp_type || call?.sdp?.type || "offer")
      console.log(`📞 WhatsApp voice call connect from=***${from.slice(-4)} callId=***${callId.slice(-8)} branch=${waBranch?.id || "default"}`)

      if (!offerSdp) {
        // No SDP = nothing to answer with. Decline cleanly instead of
        // ringing into a dead bridge.
        console.warn("wa connect: no SDP in payload — declining")
        await rejectWhatsAppCall(callId, waBranch)
        continue
      }

      let answerSdp: string | null = null
      try {
        const bridged = await bridgeToVoicebot("/whatsapp/connect", {
          callId, from, to,
          phoneNumberId: String(phoneNumberId || ""),
          sdp: offerSdp,
          sdpType,
          branchId: waBranch?.id || null,
        })
        answerSdp = bridged?.answerSdp || null
      } catch (e: any) {
        console.error("wa connect: voicebot bridge failed:", e.message)
      }

      if (!answerSdp) {
        // The voicebot is down / could not answer. Rejecting is the honest
        // UX (caller sees "not answered") — better than Meta's 45s timeout.
        await rejectWhatsAppCall(callId, waBranch).catch(() => {})
        continue
      }

      // pre_accept (stops Meta's answering timer) then accept (goes live).
      // Both carry the SAME answer SDP.
      const pre = await answerWhatsAppCall(callId, from, answerSdp, "pre_accept", waBranch)
      if (!pre.ok) {
        console.error(`wa pre_accept failed (***${callId.slice(-8)}):`, pre.error)
        // A failed pre-accept can still accept per Meta's flow (pre-accept
        // is a timer reset), so try accept before giving up.
      }
      const acc = await answerWhatsAppCall(callId, from, answerSdp, "accept", waBranch)
      if (!acc.ok) {
        console.error(`wa accept failed (***${callId.slice(-8)}):`, acc.error)
        await rejectWhatsAppCall(callId, waBranch).catch(() => {})
      } else {
        console.log(`✅ WhatsApp call accepted (***${callId.slice(-8)}) — Priya is live on WhatsApp`)
      }
      continue
    }

    if (event === "terminate" && callId) {
      const from = String(call?.from || "")
      const status = String(call?.status || call?.status_code || "")
      const outcome = mapCallOutcome(status)
      const sid = callSidFor(callId)
      console.log(`📴 WhatsApp call terminate callId=***${callId.slice(-8)} status=${status || "unknown"} outcome=${outcome}`)

      // 1) Tell the voicebot to tear the session down. The bridge awaits the
      //    voicebot's "end" report (duration → voice_calls) before returning,
      //    so the finalizer below always sees the real duration. The longer
      //    timeout covers the round trip into the app's own turn API.
      try {
        await bridgeToVoicebot("/whatsapp/terminated", { callId, reason: status || "terminate" }, 15000)
      } catch (e: any) {
        // Voicebot down is NOT fatal here: the finalizer still logs the row
        // and sends missed-call follow-ups for calls that never connected.
        console.error("wa terminate: voicebot bridge failed:", e.message)
      }

      // 2) Finalize — chat bubble, lead status, follow-up templates,
      //    comm_logs, AI summary, Lead Brain. Deduped by wa_message_id.
      try {
        await finalizeWhatsAppCall({ callSid: sid, callId, from, outcome, branchIdFromWebhook: waBranch?.id || null })
      } catch (e: any) {
        console.error("wa finalize error:", e.message)
      }
      continue
    }

    // Unknown call events (ringing, etc.) — logged once, no action exists
    // for them on the business side.
    if (event && callId) console.log(`📞 WhatsApp call event "${event}" (***${callId.slice(-8)}) — no action`)
  }
}
