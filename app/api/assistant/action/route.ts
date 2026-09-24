import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { normalizePhone } from "@/lib/phone"

export const dynamic = "force-dynamic"

// The proposal payload arrives from the CLIENT — parsed out of the model's
// reply (or tampered with by a compromised session). The system prompt is a
// convention, NOT validation: every enum below is enforced server-side so a
// hallucinated or malicious payload can't write arbitrary status strings,
// script languages or security keys into the DB.
const ACTION_TYPES = new Set([
  "update_script", "add_kb_entry", "update_kb_entry", "delete_kb_entry",
  "add_lead", "update_lead", "update_loan", "add_dnd", "remove_dnd", "toggle_security",
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
    const { type, payload } = body

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
        const { data, error } = await db
          .from("leads")
          .insert({
            name: name || "New Lead",
            phone: normalized,
            product_interest: productInterest,
            loan_amount: loanAmount,
            city: city || null,
            address: address || null,
            notes: notes || "Created via Ops Assistant",
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

        logAudit("loan application updated via ops assistant", session.email, { id, status })
        return NextResponse.json({
          success: true,
          message: `Loan application #${id} status updated to "${status}".`,
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
