import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { normalizePhone } from "@/lib/phone"
import { checkCallCompliance } from "@/lib/compliance"
import { sanitizeCustomFields } from "@/lib/script-studio"

export const dynamic = "force-dynamic"

// The proposal payload arrives from the CLIENT — parsed out of the model's
// reply (or tampered with by a compromised session). The system prompt is a
// convention, NOT validation: every enum below is enforced server-side so a
// hallucinated or malicious payload can't write arbitrary status strings,
// script languages or security keys into the DB.
const ACTION_TYPES = new Set([
  "update_script", "update_campaign_template", "add_kb_entry", "update_kb_entry", "delete_kb_entry",
  "add_lead", "update_lead", "update_loan", "add_dnd", "remove_dnd", "toggle_security",
  "queue_lead_call",
])
const SCRIPT_LANGUAGES = new Set(["base", "english", "hindi", "telugu"])
const LEAD_STATUSES = new Set(["new", "contacted", "qualified", "callback", "lost"])
const LOAN_STATUSES = new Set(["approved", "underwriting", "rejected", "documents_pending"])
const PRODUCT_INTERESTS = new Set(["personal", "business", "home"])
const KB_CATEGORIES = new Set(["Loans", "General", "FAQ", "Policies"])
const SECURITY_KEY_RE = /^[a-z0-9_]{1,64}$/i

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function str(v: unknown, maxLen: number): string {
  return typeof v === "string" ? v.trim().slice(0, maxLen) : ""
}

export async function POST(req: NextRequest) {
  // CRITICAL SECURITY: Only Admin commands can execute dashboard changes!
  const session = await requireRole(req, ["admin"])
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized. Only administrators can approve and execute dashboard modifications." },
      { status: 403 }
    )
  }

  try {
    const body = asRecord(await req.json().catch(() => null))
    // The voice widget sends `actionType` (voice-assistant.tsx) while the
    // QuickChat commander sends `type` (quick-chat.tsx) — accept both, or
    // every "Approve & Execute" from the voice path 400s here.
    const type = typeof body.type === "string" ? body.type : typeof body.actionType === "string" ? body.actionType : undefined
    const payload = body.payload

    if (typeof type !== "string" || !ACTION_TYPES.has(type) || !payload) {
      return NextResponse.json({ error: "Valid action type and payload are required" }, { status: 400 })
    }
    const p = asRecord(payload)

    switch (type) {
      case "update_script": {
        const language = typeof p.language === "string" && SCRIPT_LANGUAGES.has(p.language) ? p.language : "base"
        const content = str(p.content, 20000)
        if (!content) {
          return NextResponse.json({ error: "Script content cannot be empty" }, { status: 400 })
        }

        await query(`
          CREATE TABLE IF NOT EXISTS ai_scripts (
            id SERIAL PRIMARY KEY,
            language TEXT NOT NULL UNIQUE,
            content TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT now(),
            updated_by TEXT DEFAULT 'admin'
          )
        `)

        await query(
          `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
           VALUES ($1, $2, now(), $3)
           ON CONFLICT (language) DO UPDATE
             SET content = EXCLUDED.content,
                 updated_at = now(),
                 updated_by = EXCLUDED.updated_by`,
          [language, content.trim(), session.email]
        )

        logAudit("ai script updated via ops assistant", session.email, { language, length: content.length })
        return NextResponse.json({
          success: true,
          message: `Priya's ${language} script successfully updated.`,
          details: { language, contentLength: content.length },
        })
      }

      case "add_kb_entry": {
        const title = str(p.title, 200)
        const content = str(p.content, 4000)
        const category = str(p.category, 100)
        if (!title || !content) {
          return NextResponse.json({ error: "Title and content are required for Knowledge Base entry" }, { status: 400 })
        }

        const { data, error } = await db
          .from("knowledge_base")
          .insert({
            title,
            content,
            category: KB_CATEGORIES.has(category) ? category : "General",
            is_active: p.is_active !== false,
            created_by: session.email,
          })
          .select()
          .single()

        if (error) throw new Error(error.message)

        logAudit("knowledge base entry created via ops assistant", session.email, { title, id: data?.id })
        return NextResponse.json({
          success: true,
          message: `Knowledge Base entry "${title}" successfully added.`,
          details: data,
        })
      }

      case "update_kb_entry": {
        const id = str(p.id, 64)
        if (!id) return NextResponse.json({ error: "Knowledge base entry id required" }, { status: 400 })

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        const title = typeof p.title === "string" ? p.title.trim().slice(0, 200) : ""
        const content = typeof p.content === "string" ? p.content.trim().slice(0, 4000) : ""
        const category = typeof p.category === "string" ? p.category.slice(0, 100) : ""
        if (title) updates.title = title
        if (content) updates.content = content
        if (category && KB_CATEGORIES.has(category)) updates.category = category
        if (typeof p.is_active === "boolean") updates.is_active = p.is_active

        const { data, error } = await db.from("knowledge_base").update(updates).eq("id", id).select().single()
        if (error) throw new Error(error.message)

        logAudit("knowledge base entry updated via ops assistant", session.email, { id })
        return NextResponse.json({
          success: true,
          message: `Knowledge Base entry successfully updated.`,
          details: data,
        })
      }

      case "delete_kb_entry": {
        const id = str(p.id, 64)
        const title = str(p.title, 200)
        if (!id) return NextResponse.json({ error: "Knowledge base entry id required" }, { status: 400 })

        await db.from("knowledge_base").delete().eq("id", id)
        logAudit("knowledge base entry deleted via ops assistant", session.email, { id, title })
        return NextResponse.json({
          success: true,
          message: `Knowledge Base entry "${title || id}" deleted.`,
        })
      }

      case "update_campaign_template": {
        // The assistant's Brief-Priya flow (Outpero's "Swara HR sets the
        // script"): a full campaign brief with {merge_field} placeholders,
        // stored under the Script Studio's ai_scripts key. Same validation
        // as /api/script-studio save.
        const content = str(p.content, 20000)
        if (!content) return NextResponse.json({ error: "Campaign template content cannot be empty" }, { status: 400 })
        if (content.length > 40000) return NextResponse.json({ error: "Campaign template too long (max 40,000 characters)" }, { status: 400 })

        await query(
          `INSERT INTO ai_scripts (language, content, updated_at, updated_by)
           VALUES ('campaign_template', $1, now(), $2)
           ON CONFLICT (language) DO UPDATE
             SET content = EXCLUDED.content, updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [content.trim(), session.email]
        )
        logAudit("campaign template updated via ops assistant", session.email, { length: content.length })
        return NextResponse.json({
          success: true,
          message: "Priya's campaign brief saved — the Upload and Call Queue consoles now offer it as the campaign agenda, and every {merge_field} is personalized per lead at dial time.",
          details: { key: "campaign_template", contentLength: content.length },
        })
      }

      case "queue_lead_call": {
        // "Call this lead now / put them at the front of the queue" — the
        // assistant queues the number for the dialer (never dials directly:
        // the campaign runner owns dialing, compliance stays in one place).
        const phone = str(p.phone, 20)
        if (!phone) return NextResponse.json({ error: "Lead phone number is required" }, { status: 400 })
        const normalized = normalizePhone(phone)
        if (!normalized) return NextResponse.json({ error: "Phone number could not be parsed — use digits with country code" }, { status: 400 })

        // The same regulatory gate queue-time uses: DNC/DND refuse, outside
        // the calling window is FINE (queueing for later is the point).
        const compliance = await checkCallCompliance({ phone: normalized })
        if (!compliance.allowed && (compliance.code === "do_not_call" || compliance.code === "dnd_suppressed")) {
          return NextResponse.json({ error: `Compliance blocks this number: ${compliance.reason || compliance.code}` }, { status: 403 })
        }

        const name = str(p.name, 120)
        const language = ["telugu", "hindi", "english"].includes(String(p.language)) ? String(p.language) : "telugu"
        const talkingPoints = str(p.talking_points, 1000) || null
        const urgent = p.priority === "urgent" || p.priority === true
        let scheduledAt = new Date().toISOString()
        if (typeof p.scheduled_at === "string") {
          const d = new Date(p.scheduled_at)
          if (!isNaN(d.getTime())) scheduledAt = d.toISOString()
        }

        // Find-or-create the lead (last-10 match, same as every queue path).
        const last10 = normalized.replace(/\D/g, "").slice(-10)
        const existing = await query(
          `SELECT id FROM leads WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1 LIMIT 1`,
          [last10]
        )
        let leadId: string | undefined = existing.rows[0]?.id
        if (!leadId) {
          const { data: lead, error } = await db.from("leads").insert({
            name: name || "Unknown", phone: normalized, language,
            product_interest: str(p.product_interest, 120) || null,
            notes: "Created via Ops Assistant", source: "Ops Assistant",
            status: "new", score: 50,
          }).select().single()
          if (error) throw new Error(error.message)
          leadId = lead?.id
        }

        try {
          await db.from("outbound_queue").insert({
            lead_id: leadId || null,
            name: name || null, phone: normalized, language,
            talking_points: talkingPoints,
            custom_fields: sanitizeCustomFields(p.custom_fields),
            status: "pending",
            channel: "auto",
            priority: urgent ? 100 : 0,
            scheduled_at: scheduledAt,
          })
        } catch (e: unknown) {
          if ((e as { code?: string })?.code === "23505") {
            return NextResponse.json({ success: true, message: "That number is already pending in the call queue — no duplicate was created." })
          }
          throw e
        }
        logAudit("lead queued via ops assistant", session.email, { phone: normalized, urgent })
        return NextResponse.json({
          success: true,
          message: urgent
            ? "Lead queued at the FRONT of the call queue — Priya dials them on the next campaign tick."
            : "Lead queued — Priya dials them when the campaign runs (or outside the calling window, at the next window open).",
          details: { phone: normalized, leadId, urgent },
        })
      }

      case "add_lead": {
        const name = str(p.name, 120)
        const phone = str(p.phone, 20)
        const notes = str(p.notes, 2000)
        const city = str(p.city, 120)
        const address = str(p.address, 500)
        if (!phone) {
          return NextResponse.json({ error: "Lead phone number is required" }, { status: 400 })
        }

        const normalized = normalizePhone(phone)
        if (!normalized) {
          return NextResponse.json({ error: "Phone number could not be parsed — use digits with country code" }, { status: 400 })
        }
        const loanAmountRaw = typeof p.loan_amount === "string" || typeof p.loan_amount === "number" ? Number(p.loan_amount) : null
        const loanAmount = loanAmountRaw !== null && Number.isFinite(loanAmountRaw) && loanAmountRaw > 0 ? loanAmountRaw : null
        const productInterest = typeof p.product_interest === "string" && PRODUCT_INTERESTS.has(p.product_interest) ? p.product_interest : "personal"
        // NOTE: leads has no `city` column (city lives on loan_applications)
        // — the old insert crashed with "column city does not exist" whenever
        // the model filled it in. Non-column fields fold into notes instead.
        const cityNote = city ? `City: ${city}` : ""
        const { data, error } = await db
          .from("leads")
          .insert({
            name: name || "New Lead",
            phone: normalized,
            product_interest: productInterest,
            loan_amount: loanAmount,
            address: address || null,
            notes: [notes || "Created via Ops Assistant", cityNote].filter(Boolean).join(" — "),
            status: "new",
            score: 50,
          })
          .select()
          .single()

        if (error) throw new Error(error.message)

        logAudit("lead added via ops assistant", session.email, { name, phone: normalized, id: data?.id })
        return NextResponse.json({
          success: true,
          message: `Lead ${name || normalized} added successfully to pipeline.`,
          details: data,
        })
      }

      case "add_dnd": {
        const phone = str(p.phone, 20)
        const reason = str(p.reason, 200)
        if (!phone) return NextResponse.json({ error: "Phone number required" }, { status: 400 })
        const normalized = normalizePhone(phone)
        if (!normalized) return NextResponse.json({ error: "Phone number could not be parsed" }, { status: 400 })

        await query(
          `INSERT INTO dnd_suppression (phone, reason, added_by) VALUES ($1, $2, $3)
           ON CONFLICT (phone) DO NOTHING`,
          [normalized, reason || "Added via Ops Assistant", session.email]
        )

        logAudit("dnd added via ops assistant", session.email, { phone: normalized })
        return NextResponse.json({
          success: true,
          message: `Phone ${normalized} successfully added to DND suppression list.`,
        })
      }

      case "toggle_security": {
        const key = str(p.key, 64)
        const enabled = Boolean(p.enabled)
        if (!key) return NextResponse.json({ error: "Security key required" }, { status: 400 })
        if (!SECURITY_KEY_RE.test(key)) {
          return NextResponse.json({ error: "Invalid security key format" }, { status: 400 })
        }

        await query(
          `INSERT INTO security_settings (key, enabled, updated_by, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, Boolean(enabled), session.email]
        )

        logAudit("security setting toggled via ops assistant", session.email, { key, enabled })
        return NextResponse.json({
          success: true,
          message: `Security setting "${key}" set to ${enabled ? "ENABLED" : "DISABLED"}.`,
        })
      }

      case "update_lead": {
        const id = str(p.id, 64)
        const phone = str(p.phone, 20)
        if (!id && !phone) {
          return NextResponse.json({ error: "Lead ID or phone number is required" }, { status: 400 })
        }

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (typeof p.status === "string") {
          if (!LEAD_STATUSES.has(p.status)) {
            return NextResponse.json({ error: `Invalid lead status "${p.status.slice(0, 40)}"` }, { status: 400 })
          }
          updates.status = p.status
        }
        if (typeof p.score === "number" && Number.isFinite(p.score)) {
          updates.score = Math.max(0, Math.min(100, Math.round(p.score)))
        }
        if (typeof p.notes === "string") updates.notes = p.notes.slice(0, 2000)
        if (typeof p.product_interest === "string" && PRODUCT_INTERESTS.has(p.product_interest)) updates.product_interest = p.product_interest
        if (typeof p.interested === "string") updates.interested = p.interested.slice(0, 40)
        // "Schedule a callback for tomorrow 6pm" — callback_at feeds the
        // Calendar + speech-scheduler; an explicit null clears it.
        if ("callback_at" in p) {
          if (p.callback_at === null) {
            updates.callback_at = null
          } else if (typeof p.callback_at === "string") {
            const d = new Date(p.callback_at)
            if (isNaN(d.getTime())) {
              return NextResponse.json({ error: "callback_at is not a valid date" }, { status: 400 })
            }
            updates.callback_at = d.toISOString()
          }
        }
        if (typeof p.callback_note === "string") updates.callback_note = p.callback_note.slice(0, 300)

        let result
        if (id) {
          result = await db.from("leads").update(updates).eq("id", id).select().single()
        } else {
          const norm = normalizePhone(phone)
          if (!norm) return NextResponse.json({ error: "Phone number could not be parsed" }, { status: 400 })
          result = await db.from("leads").update(updates).eq("phone", norm).select().single()
        }

        if (result.error) throw new Error(result.error.message)

        logAudit("lead updated via ops assistant", session.email, { id: id || result.data?.id, updates })
        return NextResponse.json({
          success: true,
          message: `Lead ${result.data?.name || id || phone} successfully updated.`,
          details: result.data,
        })
      }

      case "update_loan": {
        const id = str(p.id, 64)
        if (!id) return NextResponse.json({ error: "Loan application ID is required" }, { status: 400 })

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (typeof p.status === "string") {
          if (!LOAN_STATUSES.has(p.status)) {
            return NextResponse.json({ error: `Invalid loan status "${p.status.slice(0, 40)}"` }, { status: 400 })
          }
          updates.status = p.status
        }
        if (typeof p.notes === "string") updates.notes = p.notes.slice(0, 2000)

        const { data, error } = await db.from("loan_applications").update(updates).eq("id", id).select().single()
        if (error) throw new Error(error.message)

        // `status` is NOT in scope here (it compiled only because the DOM lib
        // declares a global `status: string` — undefined in Node). Report the
        // value actually written.
        const nextStatus = typeof updates.status === "string" ? updates.status : null
        logAudit("loan application updated via ops assistant", session.email, { id, status: nextStatus })
        return NextResponse.json({
          success: true,
          message: nextStatus
            ? `Loan application status updated to "${nextStatus}".`
            : `Loan application #${id.slice(0, 8)} updated.`,
          details: data,
        })
      }

      case "remove_dnd": {
        const phone = str(p.phone, 20)
        if (!phone) return NextResponse.json({ error: "Phone number required" }, { status: 400 })
        const normalized = normalizePhone(phone)
        if (!normalized) return NextResponse.json({ error: "Phone number could not be parsed" }, { status: 400 })

        await query(`DELETE FROM dnd_suppression WHERE phone = $1`, [normalized])
        logAudit("dnd removed via ops assistant", session.email, { phone: normalized })
        return NextResponse.json({
          success: true,
          message: `Phone ${normalized} removed from DND suppression list.`,
        })
      }

      default:
        return NextResponse.json({ error: "Unknown action type" }, { status: 400 })
    }
  } catch (err) {
    console.error("Ops assistant action failed:", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to execute action" }, { status: 500 })
  }
}
