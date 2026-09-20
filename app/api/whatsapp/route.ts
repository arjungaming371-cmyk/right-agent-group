import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import pool, { query } from "@/lib/db"
import { chatWithLLM, detectLanguage, type Language } from "@/lib/llm"
import { sendWhatsAppText, downloadBranchWhatsAppMedia, type BranchWhatsAppCtx } from "@/lib/whatsapp"
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
        // company's default (env-credentialed) number.
        let branch: BranchRow | null = null
        const phoneNumberId = value?.metadata?.phone_number_id
        if (phoneNumberId) {
          branch = await resolveBranchByWhatsAppPhoneId(phoneNumberId)
          if (branch) console.log(`🏷 WhatsApp inbound routed to branch ${branch.code} (phone_number_id match)`)
        }
        const waBranch: BranchWhatsAppCtx = branch
          ? { id: branch.id, whatsappToken: branch.whatsapp_token, whatsappPhoneNumberId: branch.whatsapp_phone_number_id, brandName: branch.brand_name }
          : null

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
// calls. Everything else (images, video, stickers, location) stays a
// placeholder — genuinely different work (vision model) not in scope here.
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

  return `[${msg?.type || "media"} message]`
}

async function handleInbound(msg: any, profileName: string | null, waBranch: BranchWhatsAppCtx = null) {
  const from = String(msg?.from || "").replace(/\D/g, "")
  const waMessageId = msg?.id ? String(msg.id) : null
  if (!from) return

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
  } else {
    await query(
      `INSERT INTO whatsapp_messages (lead_id, wa_message_id, phone_number, direction, content, status, branch_id)
       VALUES ($1, $2, $3, 'inbound', $4, 'received', $5)`,
      [lead.id, waMessageId, `+${from}`, text, waBranch?.id || null]
    )
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
      [lead.id, `WA: "${text.slice(0, 60)}" → AI replied`, sent.ok ? "replied" : "reply_failed"]
    ).catch(() => {})
  }

  refreshLeadScore(lead.id).catch(() => {})

  // LOAN EDIT REQUESTS: fire-and-forget, after the customer already has
  // their reply — never adds latency, never writes to loan_applications
  // itself, only flags a pending row for staff to approve/reject.
  maybeProposeLoanEdit(lead.id, "priya_whatsapp", text)
}
