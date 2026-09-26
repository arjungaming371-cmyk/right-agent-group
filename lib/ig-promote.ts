// Instagram prospect → CRM lead promotion (2026-09-26 Instagram Separation).
//
// One code path for BOTH promoters:
//   • the webhook's auto-qualifier (a valid Indian mobile typed in a DM)
//   • the operator's "Convert to Lead" button (IG view / Prospects tab)
//
// The invariants that make auto-promotion safe (audit 2026-09-26):
//
//  1. RACE-SAFE: the whole check-then-promote runs inside a transaction
//     holding pg_advisory_xact_lock(last10) — the same pattern the WhatsApp
//     webhook uses for find-or-create — so a concurrent inbound WhatsApp
//     message creating a lead with the same number cannot interleave.
//  2. PII-SAFE ON COLLISION: if the phone already belongs to a DIFFERENT
//     lead, we NEVER merge identities and NEVER overwrite that lead. Gluing
//     this IG identity onto the phone-owner's row would hand the phone
//     owner's PII (Lead Brief: name, phone, loan details) to whoever typed
//     the number — the exact cross-lead leak fixed on 2026-09-20. The
//     prospect stays a prospect and the conflict is surfaced for a human.
//     (The UNIQUE partial index uq_leads_phone_key is the final guard: even
//     a lost race lands as 23505 → reported as a conflict, never a crash.)
//  3. NO ROW MOVES: promotion flips is_social_prospect in place, so
//     instagram_messages / comm_logs / ai_conversations history survives.
//  4. SIDE EFFECTS ARE BEST-EFFORT: comm-log, audit, lead score, WhatsApp
//     welcome + form link, call-queue insert — a failure in any of them is
//     logged and reported, never thrown at the caller after COMMIT.

import pool, { query } from "./db"
import { normalizePhone, phoneLast10 } from "./phone"
import { logAudit } from "./audit"
import { refreshLeadScore } from "./scoring"
import { branchWhatsAppCtx, sendApplicationLink } from "./whatsapp"
import { randomUUID } from "crypto"

export type PromoteSource = "auto_dm" | "operator"

export type PromoteOptions = {
  leadId: string
  /** The phone to promote with — will be normalized; required for a first promotion. */
  phone?: string | null
  /** The raw text the customer typed (e.g. "98765 43210") → leads.ig_phone_extracted. */
  rawMatch?: string | null
  source: PromoteSource
  operatorEmail?: string | null
  productInterest?: string | null
  notes?: string | null
  /** Fire the WhatsApp welcome + loan-application form link (default: auto). */
  sendWelcome?: boolean
  /** Push into the bulk-dialer queue after promotion (operator opt-in; auto-promotions default OFF). */
  addToCallQueue?: boolean
  channel?: "phone" | "whatsapp_voice" | "auto"
}

export type PromoteOutcome =
  | {
      ok: true
      lead: Record<string, any>
      /** Already carried this exact phone before the call — nothing changed. */
      alreadyPromoted: boolean
      whatsappSent: boolean | null
      queued: boolean
    }
  | {
      ok: false
      reason: "not_found" | "no_phone" | "invalid_phone" | "conflict"
      /** Set when reason === "conflict": the lead that already owns the number. */
      conflictLeadId?: string
      error?: string
    }

/** The lead row shape we lock and return. */
const LEAD_COLS = `id, name, phone, source, status, branch_id, is_social_prospect,
  promoted_to_crm_at, ig_phone_extracted, instagram_handle, ig_user_id, language, product_interest`

export async function promoteInstagramLead(opts: PromoteOptions): Promise<PromoteOutcome> {
  // ── 0. Validate the phone BEFORE opening the transaction ──
  let phone: string | null = null
  let last10 = ""
  if (opts.phone) {
    phone = normalizePhone(opts.phone)
    last10 = phoneLast10(phone)
    if (!last10 || !/^[6-9]\d{9}$/.test(last10)) {
      return { ok: false, reason: "invalid_phone", error: `Not a valid Indian mobile: ${opts.phone}` }
    }
  }

  const client = await pool.connect()
  let lead: Record<string, any> | null = null
  let alreadyPromoted = false
  let lockedKey = ""
  try {
    await client.query("BEGIN")
    // Advisory lock on the phone key (same family as the WhatsApp webhook's
    // find-or-create): serializes every promote/create racing on this number.
    if (last10) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [last10])
      lockedKey = last10
    }

    const cur = await client.query(`SELECT ${LEAD_COLS} FROM leads WHERE id = $1 FOR UPDATE`, [opts.leadId])
    if (cur.rows.length === 0) {
      await client.query("ROLLBACK")
      return { ok: false, reason: "not_found" }
    }
    // Typed local: cur.rows[0] is `any`, and assigning `any` into `lead`
    // would not narrow the `| null` union for the checks below.
    const row: Record<string, any> = cur.rows[0]
    lead = row

    // Resolve the effective phone: explicit argument first, then what the
    // webhook may have stashed on a previous DM (ig_phone_extracted), then
    // what the lead already carries (idempotent re-promote).
    let effPhone = phone
    if (!effPhone && row.ig_phone_extracted) {
      const cand = normalizePhone(row.ig_phone_extracted)
      if (/^[6-9]\d{9}$/.test(phoneLast10(cand))) effPhone = cand
    }
    if (!effPhone && row.phone && !/^IG/.test(String(row.phone))) effPhone = String(row.phone)
    if (!effPhone) {
      await client.query("ROLLBACK")
      return { ok: false, reason: "no_phone", error: "No phone number provided or previously detected" }
    }
    const effLast10 = phoneLast10(effPhone)
    if (!/^[6-9]\d{9}$/.test(effLast10)) {
      await client.query("ROLLBACK")
      return { ok: false, reason: "invalid_phone", error: `Not a valid Indian mobile: ${effPhone}` }
    }
    phone = effPhone
    last10 = effLast10
    // The effective number may come from the stash (ig_phone_extracted) when
    // the caller passed no explicit phone — lock it now if it isn't locked.
    if (lockedKey !== last10) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [last10])
      lockedKey = last10
    }

    // ── 1. Idempotency / self-conflict: the lead already owns a real phone ──
    const existingKey = row.phone && !/^IG/.test(String(row.phone)) ? phoneLast10(String(row.phone)) : ""
    if (existingKey.length === 10) {
      if (existingKey === last10) {
        alreadyPromoted = true
        // Fall through to a no-op UPDATE below (still stamps promoted_at).
      } else {
        // Operator is pointing this prospect at a different number than the
        // one already on the row — do not silently rewrite history.
        await client.query("ROLLBACK")
        return { ok: false, reason: "conflict", conflictLeadId: row.id, error: "Lead already has a different phone" }
      }
    }

    // ── 2. THE PII GUARD: another lead already owns this number ──
    // Never merge, never overwrite. The prospect stays un-promoted.
    let conflictLeadId: string | null = null
    try {
      const dup = await client.query(
        `SELECT id FROM leads WHERE phone_key = $1 AND id != $2 LIMIT 1`,
        [last10, opts.leadId]
      )
      conflictLeadId = dup.rows[0]?.id || null
    } catch (e: any) {
      if (e?.code !== "42703") throw e // phone_key not on this DB yet → regexp fallback
      const dup = await client.query(
        `SELECT id FROM leads
          WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1 AND id != $2
          LIMIT 1`,
        [last10, opts.leadId]
      )
      conflictLeadId = dup.rows[0]?.id || null
    }
    if (conflictLeadId) {
      await client.query("ROLLBACK")
      return { ok: false, reason: "conflict", conflictLeadId, error: "Phone already belongs to another CRM lead — needs human review" }
    }

    // ── 3. Promote in place (flag flip, never a row move) ──
    const updated = await client.query(
      `UPDATE leads SET
         phone = $2,
         is_social_prospect = false,
         promoted_to_crm_at = COALESCE(promoted_to_crm_at, now()),
         ig_phone_extracted = COALESCE($3, ig_phone_extracted),
         product_interest = COALESCE($4, product_interest),
         notes = CASE
           WHEN $5::text IS NOT NULL AND notes IS NOT NULL AND notes != '' THEN notes || E'\n' || $5
           ELSE COALESCE($5, notes) END,
         updated_at = now()
       WHERE id = $1
       RETURNING ${LEAD_COLS}, lead_code`,
      [opts.leadId, phone, opts.rawMatch || null, opts.productInterest || null, opts.notes || null]
    ).catch(async (e: any) => {
      // Legacy DB without the new columns → promote the old way (phone only).
      if (e?.code !== "42703") throw e
      return client.query(
        `UPDATE leads SET phone = $2, updated_at = now()
         WHERE id = $1
         RETURNING id, name, phone, source, status, branch_id, instagram_handle, ig_user_id, language, product_interest, NULL::text AS lead_code`,
        [opts.leadId, phone]
      )
    })
    if ((updated as any).code === "23505") {
      // Lost the phone_key uniqueness race (a concurrent WhatsApp inbound
      // created the same number between our check and our UPDATE).
      await client.query("ROLLBACK")
      return { ok: false, reason: "conflict", error: "Phone was claimed by another lead mid-promotion" }
    }
    lead = updated.rows[0] || lead
    await client.query("COMMIT")
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {})
    if (e?.code === "23505") {
      return { ok: false, reason: "conflict", error: "Phone was claimed by another lead mid-promotion" }
    }
    return { ok: false, reason: "not_found", error: e?.message || "promote failed" }
  } finally {
    client.release()
  }

  if (!lead) return { ok: false, reason: "not_found" }

  // ── 4. Side effects — best-effort, never thrown ──
  const actor = opts.source === "operator" ? (opts.operatorEmail || "operator") : "priya-auto"
  const masked = `+91 *****${last10.slice(-4)}`

  try {
    await query(
      `INSERT INTO comm_logs (lead_id, type, summary, outcome) VALUES ($1, 'instagram', $2, $3)`,
      [opts.leadId,
        opts.source === "operator"
          ? `Promoted to CRM lead by ${actor} — phone ${masked}`
          : `Instagram prospect auto-promoted to CRM lead (phone ${masked} shared in DM)`,
        "promoted"]
    )
  } catch {}

  try {
    logAudit("instagram prospect promoted", actor, {
      leadId: opts.leadId, source: opts.source, phoneMasked: masked,
    })
  } catch {}

  try { await refreshLeadScore(opts.leadId) } catch {}

  // WhatsApp welcome + one-time loan application link (the deliverable Priya
  // promises in the DM: "I'll send you the exact interest rate breakdown").
  let whatsappSent: boolean | null = null
  if (opts.sendWelcome !== false && !alreadyPromoted) {
    try {
      const token = randomUUID()
      await query(
        `INSERT INTO form_links (token, lead_id, expires_at) VALUES ($1, $2, now() + interval '14 days')`,
        [token, opts.leadId]
      ).catch(async (e: any) => {
        if (e?.code !== "42703") throw e
        await query(`INSERT INTO form_links (token, lead_id) VALUES ($1, $2)`, [token, opts.leadId])
      })
      const waBranch = await branchWhatsAppCtx(lead.branch_id)
      const sent = await sendApplicationLink(phone!, lead.name || "there", token, waBranch)
      whatsappSent = sent.ok
      await query(
        `INSERT INTO comm_logs (lead_id, type, summary, outcome) VALUES ($1, 'whatsapp', $2, $3)`,
        [opts.leadId,
          sent.ok ? `Welcome + loan application form link sent on WhatsApp (${masked})` : `Form link generated; WhatsApp send failed (${sent.error || "not configured"})`,
          sent.ok ? "sent" : "pending"]
      ).catch(() => {})
    } catch (e: any) {
      whatsappSent = false
      console.warn("IG promote welcome send failed (non-fatal):", e?.message)
    }
  }

  // Operator opt-in: push straight into the bulk dialer with high priority.
  // The queue's own protections (anti-stacking index, dial-time compliance)
  // still apply; queue-time DND is intentionally NOT re-checked here because
  // the runner's dial-time gate is the fail-closed authority.
  let queued = false
  if (opts.addToCallQueue) {
    try {
      await query(
        `INSERT INTO outbound_queue
           (lead_id, name, phone, language, product_interest, status, branch_id, channel, priority, scheduled_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, 100, now())`,
        [opts.leadId, lead.name, phone, lead.language || "telugu", lead.product_interest, lead.branch_id, opts.channel || "phone"]
      )
      queued = true
    } catch (e: any) {
      if (e?.code === "23505") queued = false // already pending — anti-stack did its job
      else console.warn("IG promote queue insert failed (non-fatal):", e?.message)
    }
  }

  return { ok: true, lead, alreadyPromoted, whatsappSent, queued }
}
