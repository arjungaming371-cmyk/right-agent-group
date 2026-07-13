// Cross-channel memory — the ORIGINAL, simple version.
//
// DEPRECATED (but fully functional — nothing here is broken or removed):
// superseded by lib/lead-brain.ts's buildLeadBrief(), which both
// lib/voice-conversation.ts and app/api/whatsapp/route.ts now call instead.
// buildLeadBrief does everything these four functions do (known facts, past
// calls, WhatsApp history) plus structured extracted facts, a rolling
// relationship summary, sentiment/objection warnings, and a unified
// timeline — all pre-computed by a background pipeline instead of read
// fresh on every call. Kept here, unused by the app, in case anything
// external still imports these directly.
//
// Voice and WhatsApp already share the same lead_id in the database;
// this module turns that into live conversational awareness:
//   • When Priya CALLS a lead, she knows their recent WhatsApp chat.
//   • When the lead MESSAGES on WhatsApp, the AI knows their recent calls.
//
// Output is a compact context string (token-budget friendly for
// llama3.1:8b on a live call) passed as extraInstructions to Ollama.

import { query } from "./db"

const MAX_SNIPPET = 90 // chars per message snippet — keep the prompt small

function clip(s: string): string {
  const t = (s || "").replace(/\s+/g, " ").trim()
  return t.length > MAX_SNIPPET ? t.slice(0, MAX_SNIPPET) + "…" : t
}

function daysAgo(d: string | Date): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000)
  if (diff <= 0) return "today"
  if (diff === 1) return "yesterday"
  return `${diff} days ago`
}

/** Recent WhatsApp exchange for a lead — used to brief Priya before/during a CALL. */
export async function getWhatsAppContext(leadId: string): Promise<string> {
  if (!leadId) return ""
  try {
    const res = await query(
      `SELECT direction, content, created_at FROM whatsapp_messages
       WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 4`,
      [leadId]
    )
    if (res.rows.length === 0) return ""
    const lines = res.rows
      .reverse()
      .map((m: any) => `${m.direction === "inbound" ? "Customer" : "Us"} (${daysAgo(m.created_at)}): "${clip(m.content)}"`)
    return `CROSS-CHANNEL MEMORY — this customer has a WhatsApp history with us:\n${lines.join(
      "\n"
    )}\nIf relevant, naturally acknowledge it (e.g. "I saw your WhatsApp message…"). Never read it out robotically.`
  } catch (e: any) {
    console.error("getWhatsAppContext error:", e.message)
    return ""
  }
}

// Inbound calls auto-create a lead with a placeholder like "Caller 8090"
// before we know the real name — never treat that as "known" info to confirm.
const PLACEHOLDER_NAME_RE = /^Caller \d+$/

/**
 * Known lead fields (name/city/product) — used so Priya CONFIRMS details we
 * already have instead of asking fresh, on calls and WhatsApp alike.
 */
export async function getKnownLeadContext(leadId: string): Promise<string> {
  if (!leadId) return ""
  try {
    const res = await query(
      `SELECT name, address, whatsapp_number, product_interest FROM leads WHERE id = $1`,
      [leadId]
    )
    if (res.rows.length === 0) return ""
    const lead = res.rows[0]
    const safeName = lead.name && !PLACEHOLDER_NAME_RE.test(lead.name) ? lead.name : null
    const known: string[] = []
    if (safeName) known.push(`name: ${safeName}`)
    if (lead.address) known.push(`city/area: ${lead.address}`)
    if (lead.whatsapp_number) known.push(`WhatsApp number: ${lead.whatsapp_number}`)
    if (lead.product_interest) known.push(`interested in: ${lead.product_interest}`)
    if (known.length === 0) return ""
    const example = safeName ? `I have your name as ${safeName} — is that right?` : `I have your area as ${lead.address} — is that right?`
    return `KNOWN LEAD INFO — we already have this on file: ${known.join(
      ", "
    )}. Do NOT ask for these again — briefly CONFIRM them instead (e.g. "${example}"). Only ask fresh for whatever is missing from this list.`
  } catch (e: any) {
    console.error("getKnownLeadContext error:", e.message)
    return ""
  }
}

/** Past voice-call summary for a lead, excluding the call in progress — used to brief a NEW call. */
export async function getPastCallContext(leadId: string, excludeCallSid?: string | null): Promise<string> {
  if (!leadId) return ""
  try {
    const res = await query(
      `SELECT transcript, ai_summary, outcome, created_at FROM voice_calls
       WHERE lead_id = $1 AND ($2::text IS NULL OR twilio_call_sid != $2)
         AND (transcript IS NOT NULL OR ai_summary IS NOT NULL)
       ORDER BY created_at DESC LIMIT 1`,
      [leadId, excludeCallSid || null]
    )
    if (res.rows.length === 0) return ""
    const call = res.rows[0]
    const when = daysAgo(call.created_at)

    if (call.ai_summary) {
      return `CROSS-CHANNEL MEMORY — we called this customer before, ${when}. Summary: ${clip(
        call.ai_summary
      )}. Acknowledge naturally that you've spoken before — do not treat them as a stranger.`
    }
    let turns: any[] = []
    try {
      turns = typeof call.transcript === "string" ? JSON.parse(call.transcript) : call.transcript || []
    } catch {}
    if (!Array.isArray(turns) || turns.length === 0) return ""
    const last = turns.slice(-3).map((t: any) => `${t.role === "ai" ? "Priya" : "Customer"}: "${clip(t.text)}"`)
    return `CROSS-CHANNEL MEMORY — we called this customer before, ${when}. Last moments of that call:\n${last.join(
      "\n"
    )}\nAcknowledge naturally that you've spoken before — do not treat them as a stranger.`
  } catch (e: any) {
    console.error("getPastCallContext error:", e.message)
    return ""
  }
}

/** Recent voice-call summary for a lead — used to brief the WhatsApp AI. */
export async function getVoiceContext(leadId: string): Promise<string> {
  if (!leadId) return ""
  try {
    const res = await query(
      `SELECT transcript, ai_summary, outcome, created_at FROM voice_calls
       WHERE lead_id = $1 AND (transcript IS NOT NULL OR ai_summary IS NOT NULL)
       ORDER BY created_at DESC LIMIT 1`,
      [leadId]
    )
    if (res.rows.length === 0) return ""
    const call = res.rows[0]
    const when = daysAgo(call.created_at)

    if (call.ai_summary) {
      return `CROSS-CHANNEL MEMORY — we spoke to this customer on a phone call ${when}. Summary: ${clip(
        call.ai_summary
      )}. Continue from where the call left off — do not re-ask what we already know.`
    }

    // Fall back to the last couple of transcript turns
    let turns: any[] = []
    try {
      turns = typeof call.transcript === "string" ? JSON.parse(call.transcript) : call.transcript || []
    } catch {}
    if (!Array.isArray(turns) || turns.length === 0) return ""
    const last = turns.slice(-3).map((t: any) => `${t.role === "ai" ? "Priya" : "Customer"}: "${clip(t.text)}"`)
    return `CROSS-CHANNEL MEMORY — we spoke to this customer on a phone call ${when}. Last moments of that call:\n${last.join(
      "\n"
    )}\nContinue naturally from that context — do not re-ask what we already know.`
  } catch (e: any) {
    console.error("getVoiceContext error:", e.message)
    return ""
  }
}
