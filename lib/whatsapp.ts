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
// Pricing reality (India, 2026): replies inside the 24h service window are
// FREE and unlimited. Only business-initiated template sends cost money
// (utility ≈ ₹0.115 + GST per message).

const GRAPH = "https://graph.facebook.com/v21.0"
const TOKEN = process.env.WHATSAPP_TOKEN || ""
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || ""
const FORM_TEMPLATE = process.env.WHATSAPP_FORM_TEMPLATE || "loan_application_form"
const CALL_FOLLOWUP_TEMPLATE = process.env.WHATSAPP_CALL_FOLLOWUP_TEMPLATE || "call_followup"
const MISSED_CALL_TEMPLATE = process.env.WHATSAPP_MISSED_CALL_TEMPLATE || "missed_call_followup"

function configured(): boolean {
  return !!(TOKEN && PHONE_ID)
}

/** Normalize an Indian number to digits with country code: 98765 43210 → 919876543210 */
function normalizeNumber(to: string): string {
  let digits = to.replace(/\D/g, "")
  if (digits.length === 10) digits = "91" + digits
  else if (digits.length === 11 && digits.startsWith("0")) digits = "91" + digits.slice(1) // 09876543210
  else if (digits.length === 12 && digits.startsWith("00")) digits = "91" + digits.slice(2)
  return digits
}

async function graphPost(payload: Record<string, any>): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!configured()) {
    return { ok: false, error: "WhatsApp Cloud API not configured — set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env" }
  }
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    })
    clearTimeout(timeoutId)
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`
      return { ok: false, error: msg }
    }
    return { ok: true, id: data?.messages?.[0]?.id }
  } catch (e: any) {
    return { ok: false, error: `Meta API unreachable: ${e.message}` }
  }
}

/**
 * Downloads an inbound media attachment (document, audio, image, ...) by its
 * WhatsApp media ID. Two-step Meta flow: resolve the media ID to a
 * short-lived signed URL, then fetch that URL — both need the same bearer
 * token, but the second request is to a different (CDN) host so it can't be
 * combined into one call.
 */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!configured()) return null
  try {
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(10000),
    })
    const meta: any = await metaRes.json().catch(() => ({}))
    if (!metaRes.ok || !meta?.url) return null

    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
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

/**
 * Free-form text message. Delivered only inside the 24-hour customer
 * service window (i.e. the customer messaged us first). Perfect for the
 * AI auto-reply flow — and completely FREE.
 */
export async function sendWhatsAppText(
  to: string,
  message: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const number = normalizeNumber(to)
  if (number.length < 11) return { ok: false, error: `Invalid number: ${to}` }
  return graphPost({
    to: number,
    type: "text",
    text: { preview_url: true, body: String(message) },
  })
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
  token: string
): Promise<{ ok: boolean; error?: string }> {
  const number = normalizeNumber(to)
  if (number.length < 11) return { ok: false, error: `Invalid number: ${to}` }

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
  })
  if (result.ok) return { ok: true }

  // FALLBACK: if the template isn't approved yet but the customer messaged
  // us in the last 24h, a free-form text still delivers. Better than losing
  // the lead while waiting for Meta's template review.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ""
  if (!appUrl && !process.env.APPLICATION_FORM_URL) {
    return { ok: false, error: `Template failed (${result.error}) and NEXT_PUBLIC_APP_URL not set for fallback` }
  }
  const formBase = (process.env.APPLICATION_FORM_URL || `${appUrl}/form`).replace(/\/$/, "")
  const message = `Hi ${name || "there"}! Thanks for speaking with Priya from Right Agent Group. Please complete your loan application here: ${formBase}/${token}\n\nWe never ask for OTP, PIN, or any payment. — Right Agent Group, Hyderabad`
  const fallback = await sendWhatsAppText(number, message)
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
export async function sendCallFollowUp(to: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const number = normalizeNumber(to)
  if (number.length < 11) return { ok: false, error: `Invalid number: ${to}` }

  const result = await graphPost({
    to: number,
    type: "template",
    template: {
      name: CALL_FOLLOWUP_TEMPLATE,
      language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: name || "there" }] }],
    },
  })
  if (result.ok) return { ok: true }

  // FALLBACK: only delivers if the customer already has an open 24h session
  // with us (e.g. messaged in before). Otherwise this — like the template —
  // will simply fail, which is expected until the template is approved.
  const message = `Hi ${name || "there"}! Thanks for speaking with Priya from Right Agent Group. Feel free to message us here anytime with questions.\n\nWe never ask for OTP, PIN, or any payment. — Right Agent Group, Hyderabad`
  const fallback = await sendWhatsAppText(number, message)
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
export async function sendMissedCallFollowUp(to: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const number = normalizeNumber(to)
  if (number.length < 11) return { ok: false, error: `Invalid number: ${to}` }

  const result = await graphPost({
    to: number,
    type: "template",
    template: {
      name: MISSED_CALL_TEMPLATE,
      language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: name || "there" }] }],
    },
  })
  if (result.ok) return { ok: true }

  const message = `Hi ${name || "there"}! We tried calling you from Right Agent Group about a loan offer but couldn't reach you. Reply here or call us back anytime.\n\nWe never ask for OTP, PIN, or any payment. — Right Agent Group, Hyderabad`
  const fallback = await sendWhatsAppText(number, message)
  if (fallback.ok) return { ok: true }
  return { ok: false, error: `Template: ${result.error} | Fallback: ${fallback.error}` }
}

/** Health check for the dashboard — verifies the token and number are live with Meta. */
export async function checkWhatsAppHealth(): Promise<{ ok: boolean; message: string }> {
  if (!configured()) {
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
