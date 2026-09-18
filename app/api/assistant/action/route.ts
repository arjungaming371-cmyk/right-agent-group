import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { normalizePhone } from "@/lib/phone"

export const dynamic = "force-dynamic"

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
    const body = await req.json()
    const { type, payload } = body

    if (!type || !payload) {
      return NextResponse.json({ error: "Action type and payload are required" }, { status: 400 })
    }

    switch (type) {
      case "update_script": {
        const { language = "base", content } = payload
        if (!content || !content.trim()) {
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
        const { title, content, category = "General", is_active = true } = payload
        if (!title?.trim() || !content?.trim()) {
          return NextResponse.json({ error: "Title and content are required for Knowledge Base entry" }, { status: 400 })
        }

        const { data, error } = await db
          .from("knowledge_base")
          .insert({
            title: title.trim().slice(0, 200),
            content: content.trim().slice(0, 4000),
            category: category ? category.slice(0, 100) : "General",
            is_active: is_active !== false,
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
        const { id, title, content, category, is_active } = payload
        if (!id) return NextResponse.json({ error: "Knowledge base entry id required" }, { status: 400 })

        const updates: Record<string, any> = { updated_at: new Date().toISOString() }
        if (typeof title === "string") updates.title = title.trim().slice(0, 200)
        if (typeof content === "string") updates.content = content.trim().slice(0, 4000)
        if (typeof category === "string") updates.category = category.slice(0, 100)
        if (typeof is_active === "boolean") updates.is_active = is_active

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
        const { id, title } = payload
        if (!id) return NextResponse.json({ error: "Knowledge base entry id required" }, { status: 400 })

        await db.from("knowledge_base").delete().eq("id", id)
        logAudit("knowledge base entry deleted via ops assistant", session.email, { id, title })
        return NextResponse.json({
          success: true,
          message: `Knowledge Base entry "${title || id}" deleted.`,
        })
      }

      case "add_lead": {
        let { name, phone, product_interest, loan_amount, notes, city, address } = payload
        if (!phone) {
          return NextResponse.json({ error: "Lead phone number is required" }, { status: 400 })
        }

        const normalized = normalizePhone(phone)
        const { data, error } = await db
          .from("leads")
          .insert({
            name: name?.trim() || "New Lead",
            phone: normalized,
            product_interest: product_interest || "personal",
            loan_amount: loan_amount ? parseFloat(loan_amount) : null,
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
        const { phone, reason } = payload
        if (!phone) return NextResponse.json({ error: "Phone number required" }, { status: 400 })
        const normalized = normalizePhone(phone)

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
        const { key, enabled } = payload
        if (!key) return NextResponse.json({ error: "Security key required" }, { status: 400 })

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
        const { id, phone, status, score, notes, product_interest, interested } = payload
        if (!id && !phone) {
          return NextResponse.json({ error: "Lead ID or phone number is required" }, { status: 400 })
        }

        const updates: Record<string, any> = { updated_at: new Date().toISOString() }
        if (typeof status === "string") updates.status = status
        if (typeof score === "number") updates.score = score
        if (typeof notes === "string") updates.notes = notes
        if (typeof product_interest === "string") updates.product_interest = product_interest
        if (typeof interested === "string") updates.interested = interested

        let result
        if (id) {
          result = await db.from("leads").update(updates).eq("id", id).select().single()
        } else {
          const norm = normalizePhone(phone)
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
        const { id, status, notes } = payload
        if (!id) return NextResponse.json({ error: "Loan application ID is required" }, { status: 400 })

        const updates: Record<string, any> = { updated_at: new Date().toISOString() }
        if (typeof status === "string") updates.status = status
        if (typeof notes === "string") updates.notes = notes

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
        const { phone } = payload
        if (!phone) return NextResponse.json({ error: "Phone number required" }, { status: 400 })
        const normalized = normalizePhone(phone)

        await query(`DELETE FROM dnd_suppression WHERE phone = $1`, [normalized])
        logAudit("dnd removed via ops assistant", session.email, { phone: normalized })
        return NextResponse.json({
          success: true,
          message: `Phone ${normalized} removed from DND suppression list.`,
        })
      }

      default:
        return NextResponse.json({ error: `Unknown action type: ${type}` }, { status: 400 })
    }
  } catch (err: any) {
    console.error("Ops assistant action failed:", err)
    return NextResponse.json({ error: err.message || "Failed to execute action" }, { status: 500 })
  }
}
