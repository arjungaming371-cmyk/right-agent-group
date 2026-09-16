// Official WhatsApp Business Platform (Meta Cloud API).
//
// No whatsapp-web.js, no QR scanning, no local service, no ban risk.
// Messages go straight to Meta's Graph API over HTTPS.
//
// Env (.env):
//   WHATSAPP_TOKEN            permanent System User access token
//   WHATSAPP_PHONE_NUMBER_ID  Phone Number ID from WhatsApp Manager (NOT the phone number)
//   WHATSAPP_FORM_TEMPLATE    approved utility template name (default: loan_application_form)
//
// MULTI-BRANCH: every send accepts an optional branch context. A branch with
// its own WABA number (branches.whatsapp_token / whatsapp_phone_number_id)
// sends from ITS number; everyone else uses the env-level credentials. Inbound
// webhooks route by metadata.phone_number_id → branch (app/api/whatsapp).
//
// Pricing reality (India, 2026): replies inside the 24h service window are
// FREE and unlimited. Only business-initiated template sends cost money
// (utility ≈ ₹0.115 + GST per message).

const GRAPH = "https://graph.facebook.com/v21.0"
const TOKEN = process.env.WHATSAPP_TOKEN || ""
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || ""
const FORM_TEMPLATE = process.env.WHATSAPP_FORM_TEMPLATE || "loan_application_form"
const CALL_FOLLOWUP_TEMPLATE = process.env.WHATSAPP_CALL_FOLLOWUP_TEMPLATE || "call_followup"
const MISSED_CALL_TEMPLATE = process.env.WHATSAPP_MISSED_CALL_TEMPLATE || "missed_call_followup"

/** Branch context for a send — resolved once per flow, passed everywhere. */
export type BranchWhatsAppCtx = {
  id: string
  whatsappToken?: string | null
  whatsappPhoneNumberId?: string | null
  brandName?: string | null
} | null

/** Load a branch's WhatsApp context (null → env-level default credentials). */
export async function branchWhatsAppCtx(branchId: string | null | undefined): Promise<BranchWhatsAppCtx> {
  if (!branchId) return null
  try {
    const { getBranch } = await import("./branches")
    const b = await getBranch(branchId)
    if (!b) return null
    return { id: b.id, whatsappToken: b.whatsapp_token, whatsappPhoneNumberId: b.whatsapp_phone_number_id, brandName: b.brand_name }
  } catch {
    return null
  }
}

/** Per-send credentials: the branch's WABA when it has one, else the env default. */
function credsFor(branch?: BranchWhatsAppCtx): { token: string; phoneId: string; configured: boolean } {
  const token = branch?.whatsappToken || TOKEN
  const phoneId = branch?.whatsappPhoneNumberId || PHONE_ID
  return { token, phoneId, configured: !!(token && phoneId) }
}

function defaultBranding(): string {
  return process.env.NEXT_PUBLIC_ORG_NAME || "Right Agent Group"
}

// ---- DND / opt-out gate (2026-09 compliance pass) ----
// Every BUSINESS-INITIATED send (form link, call follow-up, missed-call
// follow-up) now passes through this gate. Before this, a caller who said
// "stop calling me" mid-call still received a WhatsApp template seconds
// later — a TRAI-penalizable contact, not a UX bug. Inbound-conversation
// replies (sendWhatsAppText called directly from the webhook) stay ungated:
// the customer messaged us first, and blocking the auto-reply mid-window
// would strand an active conversation.
// Self-contained query (not lib/compliance.ts's isDndSuppressed) to avoid a
// lib import cycle via lead-brain; same table, same last-10-digits match.
async function dndGate(number: string): Promise<{ ok: false; error: string } | null> {
  const digits = (number || "").replace(/\D/g, "").slice(-10)
  if (digits.length !== 10) return null // nothing reliable to match — don't block
  let suppressed: boolean
  try {
    const { query } = await import("./db")
    const res = await query(
      `SELECT 1 FROM dnd_suppression WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1 LIMIT 1`,
      [digits]
    )
    suppressed = res.rows.length > 0
  } catch (e: any) {
    // FAIL-CLOSED: if we cannot verify the number is NOT on the suppression
    // list, we do not message it. A transient DB blip must not turn into a
    // complaint to the regulator.
    console.error("dndGate check error (failing CLOSED — message suppressed):", e.message)
    suppressed = true
  }
  if (suppressed) {
    console.log(`🚫 WhatsApp send suppressed — number on DND/opt-out list (…${digits.slice(-4)})`)
    return { ok: false, error: "Number is on the DND/opt-out suppression list — business-initiated send blocked." }
  }
  return null
}

/**
 * Template failures split in two: definitive 4xx rejections (template not
 * approved, bad param, not in template manager) — where the fallback free-form
 * text genuinely helps — and ambiguous failures (timeout after Meta may have
 * accepted, 5xx). Falling back on the AMBIGUOUS kind double-messages the
 * customer: the template lands AND the fallback text lands. Only 4xx falls
 * back now.
 */
function isDefinitiveTemplateError(status?: number): boolean {
  return typeof status === "number" && status >= 400 && status < 500
}

/** Normalize an Indian number to digits with country code: 98765 43210 → 919876543210 */
function normalizeNumber(to: string): string {
  let digits = to.replace(/\D/g, "")
  if (digits.length === 10) digits = "91" + digits
  else if (digits.length === 11 && digits.startsWith("0")) digits = "91" + digits.slice(1) // 09876543210
  else if (digits.length === 12 && digits.startsWith("00")) digits = "91" + digits.slice(2)
  return digits
}

/**
 * Shape check after normalization. This business is India-only (Exotel India
 * caller IDs, ₹ pricing), so a valid target is exactly 91 + 10 digits — the
 * old `length >= 11` check accepted 13+ digit garbage (e.g. 0091-prefixed
 * numbers double-prefixed) straight through to Meta.
 */
function isValidNormalizedNumber(n: string): boolean {
  return /^91\d{10}$/.test(n)
}

async function graphPost(payload: Record<string, any>, branch?: BranchWhatsAppCtx): Promise<{ ok: boolean; id?: string; error?: string; status?: number }> {
  const { token, phoneId, configured } = credsFor(branch)
  if (!configured) {
    return { ok: false, error: branch
      ? "Branch WhatsApp number not configured — set it in Branches, or leave blank to use the company number"
      : "WhatsApp Cloud API not configured — set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env" }
  }
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    })
    clearTimeout(timeoutId)
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`
      return { ok: false, error: msg, status: res.status }
    }
    return { ok: true, id: data?.messages?.[0]?.id }
  } catch (e: any) {
    return { ok: false, error: `Meta API unreachable: ${e.message}` }
  }
}

/**
 * Download media with EXPLICIT credentials — the branch webhook path calls
 * this with the branch's own token (the media ID belongs to that WABA).
 */
async function downloadMediaWith(mediaId: string, token: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    })
    const meta: any = await metaRes.json().catch(() => ({}))
    if (!metaRes.ok || !meta?.url) return null

    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    })
    if (!fileRes.ok) return null
    const arrayBuffer = await fileRes.arrayBuffer()
    return { buffer: Buffer.from(arrayBuffer), mimeType: meta.mime_type || fileRes.headers.get("content-type") || "" }
  } catch (e: any) {
    console.error("downloadWhatsAppMedia error:", e.message)
    return null
  }
}

/** Default (env-credentialed) media download — kept for existing callers. */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!TOKEN) return null
  return downloadMediaWith(mediaId, TOKEN)
}

/** Branch-scoped media download (voice notes sent TO a branch's WABA number). */
export async function downloadBranchWhatsAppMedia(
  mediaId: string,
  branch: BranchWhatsAppCtx
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const { token } = credsFor(branch)
  if (!token) return null
  return downloadMediaWith(mediaId, token)
}

/**
 * Free-form text message. Delivered only inside the 24-hour customer
 * service window (i.e. the customer messaged us first). Perfect for the
 * AI auto-reply flow — and completely FREE.
 */
export async function sendWhatsAppText(
  to: string,
  message: string,
  branch?: BranchWhatsAppCtx
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const number = normalizeNumber(to)
  if (!isValidNormalizedNumber(number)) return { ok: false, error: `Invalid number: ${to}` }
  const result = await graphPost({
    to: number,
    type: "text",
    text: { preview_url: true, body: String(message) },
  }, branch)
  // Meter every outbound message (free window replies AND fallbacks) so the
  // branch's WhatsApp bill allocation reflects reality.
  if (result.ok && branch) {
    const { recordUsage } = await import("./branches")
    recordUsage(branch.id, "whatsapp")
  }
  return result
}

/**
 * Sends the loan application form link after a call collects
 * name/address/WhatsApp. Business-initiated → MUST use an approved
 * template (utility category, ≈ ₹0.115/msg).
 *
 * Template "loan_application_form" (create it in WhatsApp Manager):
 *   Body:   Hi {{1}}! Thanks for speaking with Priya from Right Agent Group.
 *           Tap below to complete your loan application.
 *           We never ask for OTP, PIN, or any payment. — Right Agent Group, Hyderabad
 *   Button: [Visit website] URL = https://YOUR-DOMAIN/form/{{1}}   (dynamic)
 */
export async function sendApplicationLink(
  to: string,
  name: string,
  token: string,
  branch?: BranchWhatsAppCtx
): Promise<{ ok: boolean; error?: string }> {
  const number = normalizeNumber(to)
  if (!isValidNormalizedNumber(number)) return { ok: false, error: `Invalid number: ${to}` }
  const dnd = await dndGate(number)
  if (dnd) return dnd
  if (branch) {
    const { checkQuota } = await import("./branches")
    const quota = await checkQuota(branch.id, "whatsapp")
    if (!quota.ok) {
      console.warn(`⛔ template send blocked by branch quota: ${quota.reason}`)
      return { ok: false, error: quota.reason }
    }
  }
  const brand = branch?.brandName || defaultBranding()

  const result = await graphPost({
    to: number,
    type: "template",
    template: {
      name: FORM_TEMPLATE,
      language: { code: "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: name || "there" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: token }] },
      ],
    },
  }, branch)
  if (result.ok) return { ok: true }

  // FALLBACK: if the template isn't approved yet but the customer messaged
  // us in the last 24h, a free-form text still delivers. Better than losing
  // the lead while waiting for Meta's template review — but ONLY on a
  // definitive 4xx rejection. On a timeout/5xx Meta may have already
  // delivered the template, and falling back double-messages the customer.
  if (!isDefinitiveTemplateError(result.status)) {
    return { ok: false, error: `Template failed ambiguously (${result.error}) — fallback suppressed to avoid a double send` }
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ""
  if (!appUrl && !process.env.APPLICATION_FORM_URL) {
    return { ok: false, error: `Template failed (${result.error}) and NEXT_PUBLIC_APP_URL not set for fallback` }
  }
  const formBase = (process.env.APPLICATION_FORM_URL || `${appUrl}/form`).replace(/\/$/, "")
  const message = `Hi ${name || "there"}! Thanks for speaking with Priya from ${brand}. Please complete your loan application here: ${formBase}/${token}\n\nWe never ask for OTP, PIN, or any payment. — ${brand}`
  const fallback = await sendWhatsAppText(number, message, branch)
  if (fallback.ok) return { ok: true }
  return { ok: false, error: `Template: ${result.error} | Fallback: ${fallback.error}` }
}

/**
 * Sent once per call, after ANY completed call that had a real conversation
 * (not just ones where a full lead was captured) — so nobody who talked to
 * Priya is left with silence afterward.
 *
 * Template "call_followup" (create it in WhatsApp Manager, utility category):
 *   Body: Hi {{1}}! Thanks for speaking with Priya from Right Agent Group.
 *         Feel free to message us here anytime with questions.
 *         We never ask for OTP, PIN, or any payment. — Right Agent Group, Hyderabad
 */
export async function sendCallFollowUp(to: string, name: string, branch?: BranchWhatsAppCtx): Promise<{ ok: boolean; error?: string }> {
  const number = normalizeNumber(to)
  if (!isValidNormalizedNumber(number)) return { ok: false, error: `Invalid number: ${to}` }
  const dnd = await dndGate(number)
  if (dnd) return dnd
  if (branch) {
    const { checkQuota } = await import("./branches")
    const quota = await checkQuota(branch.id, "whatsapp")
    if (!quota.ok) {
      console.warn(`⛔ template send blocked by branch quota: ${quota.reason}`)
      return { ok: false, error: quota.reason }
    }
  }
  const brand = branch?.brandName || defaultBranding()

  const result = await graphPost({
    to: number,
    type: "template",
    template: {
      name: CALL_FOLLOWUP_TEMPLATE,
      language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: name || "there" }] }],
    },
  }, branch)
  if (result.ok) return { ok: true }

  // FALLBACK: only delivers if the customer already has an open 24h session
  // with us (e.g. messaged in before). Otherwise this — like the template —
  // will simply fail, which is expected until the template is approved.
  // Only on a definitive 4xx — see sendApplicationLink's note on double-sends.
  if (!isDefinitiveTemplateError(result.status)) {
    return { ok: false, error: `Template failed ambiguously (${result.error}) — fallback suppressed to avoid a double send` }
  }
  const message = `Hi ${name || "there"}! Thanks for speaking with Priya from ${brand}. Feel free to message us here anytime with questions.\n\nWe never ask for OTP, PIN, or any payment. — ${brand}`
  const fallback = await sendWhatsAppText(number, message, branch)
  if (fallback.ok) return { ok: true }
  return { ok: false, error: `Template: ${result.error} | Fallback: ${fallback.error}` }
}

/**
 * Sent once per call, when Exotel reports the call as missed/busy/no-answer
 * (never for "failed" — that usually means a bad number, not a real miss).
 *
 * Template "missed_call_followup" (create it in WhatsApp Manager, utility category):
 *   Body: Hi {{1}}! We tried calling you from Right Agent Group about a loan
 *         offer but couldn't reach you. Reply here or call us back anytime.
 *         We never ask for OTP, PIN, or any payment. — Right Agent Group, Hyderabad
 */
export async function sendMissedCallFollowUp(to: string, name: string, branch?: BranchWhatsAppCtx): Promise<{ ok: boolean; error?: string }> {
  const number = normalizeNumber(to)
  if (!isValidNormalizedNumber(number)) return { ok: false, error: `Invalid number: ${to}` }
  const dnd = await dndGate(number)
  if (dnd) return dnd
  if (branch) {
    const { checkQuota } = await import("./branches")
    const quota = await checkQuota(branch.id, "whatsapp")
    if (!quota.ok) {
      console.warn(`⛔ template send blocked by branch quota: ${quota.reason}`)
      return { ok: false, error: quota.reason }
    }
  }
  const brand = branch?.brandName || defaultBranding()

  const result = await graphPost({
    to: number,
    type: "template",
    template: {
      name: MISSED_CALL_TEMPLATE,
      language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: name || "there" }] }],
    },
  }, branch)
  if (result.ok) return { ok: true }

  // Only on a definitive 4xx — see sendApplicationLink's note on double-sends.
  if (!isDefinitiveTemplateError(result.status)) {
    return { ok: false, error: `Template failed ambiguously (${result.error}) — fallback suppressed to avoid a double send` }
  }

  const message = `Hi ${name || "there"}! We tried calling you from ${brand} about a loan offer but couldn't reach you. Reply here or call us back anytime.\n\nWe never ask for OTP, PIN, or any payment. — ${brand}`
  const fallback = await sendWhatsAppText(number, message, branch)
  if (fallback.ok) return { ok: true }
  return { ok: false, error: `Template: ${result.error} | Fallback: ${fallback.error}` }
}

/** Health check for the dashboard — verifies the token and number are live with Meta. */
export async function checkWhatsAppHealth(): Promise<{ ok: boolean; message: string }> {
  if (!(TOKEN && PHONE_ID)) {
    return { ok: false, message: "Not configured — set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env" }
  }
  try {
    const res = await fetch(`${GRAPH}/${PHONE_ID}?fields=display_phone_number,verified_name,quality_rating`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(5000),
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, message: data?.error?.message || `Meta API HTTP ${res.status}` }
    const quality = data.quality_rating ? ` · quality: ${data.quality_rating}` : ""
    return { ok: true, message: `Connected as ${data.verified_name || ""} ${data.display_phone_number || ""}${quality}`.trim() }
  } catch (e: any) {
    return { ok: false, message: `Meta API unreachable: ${e.message}` }
  }
}
