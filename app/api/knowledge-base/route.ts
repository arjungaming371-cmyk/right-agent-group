import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { validateKbEntries } from "@/lib/kb-rules"

export const dynamic = "force-dynamic"

// GET — list all entries (any logged-in role with knowledge module access).
export async function GET(req: NextRequest) {
  const session = await requireModuleOrRole(req, "knowledge", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { data, error } = await db.from("knowledge_base").select("*").order("created_at", { ascending: false })
  if (error) return apiError(error)
  return NextResponse.json(data ?? [])
}

// POST — create an entry. admin+agent, same tier as leads/loan_applications.
// 2026-09-30: every entry is validated against the script's strict rules
// (lib/kb-rules.ts — no approval guarantees, no OTP/payment solicitation, no
// invented phone/email/address) BEFORE it can enter the KB. The KB grounds
// Priya's live answers, so a non-compliant entry IS a live-call violation.
export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "knowledge", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const title = typeof body.title === "string" ? body.title.trim() : ""
  const content = typeof body.content === "string" ? body.content.trim() : ""
  if (!title || !content) return NextResponse.json({ error: "title and content required" }, { status: 400 })
  const category = typeof body.category === "string" ? body.category.slice(0, 100) : null

  const { violations, warnings } = validateKbEntries([{ title, content, category }])
  if (violations.length > 0) {
    return NextResponse.json(
      { error: "entry violates the call-script compliance rules", violations },
      { status: 422 }
    )
  }

  const { data, error } = await db.from("knowledge_base").insert({
    title: title.slice(0, 200),
    content: content.slice(0, 4000),
    category,
    is_active: body.is_active !== false,
    created_by: session.email,
  }).select().single()
  if (error) return apiError(error)
  logAudit("knowledge base entry created", session.email, { id: data?.id, title })
  return warnings.length > 0 ? NextResponse.json({ ...data, warnings }) : NextResponse.json(data)
}

// PATCH — update an entry. Same compliance gate as POST: an edit must not
// be able to smuggle a script violation into an existing entry.
export async function PATCH(req: NextRequest) {
  const session = await requireModuleOrRole(req, "knowledge", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { id, ...rest } = body
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  // Validate the RESULTING entry (existing content + applied updates) so a
  // content-only or title-only edit is checked as a whole.
  const current = await db.from("knowledge_base").select("title, content, category").eq("id", id).single()
  if (current.error) return apiError(current.error)
  const nextEntry = {
    title: typeof rest.title === "string" ? rest.title.trim() : current.data?.title ?? "",
    content: typeof rest.content === "string" ? rest.content.trim() : current.data?.content ?? "",
    category: typeof rest.category === "string" ? rest.category : current.data?.category ?? null,
  }
  const { violations, warnings } = validateKbEntries([nextEntry])
  if (violations.length > 0) {
    return NextResponse.json(
      { error: "entry violates the call-script compliance rules", violations },
      { status: 422 }
    )
  }

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (typeof rest.title === "string") updates.title = rest.title.trim().slice(0, 200)
  if (typeof rest.content === "string") updates.content = rest.content.trim().slice(0, 4000)
  if (typeof rest.category === "string" || rest.category === null) updates.category = rest.category
  if (typeof rest.is_active === "boolean") updates.is_active = rest.is_active

  const { data, error } = await db.from("knowledge_base").update(updates).eq("id", id).select().single()
  if (error) return apiError(error)
  logAudit("knowledge base entry updated", session.email, { id, fields: Object.keys(rest) })
  return warnings.length > 0 ? NextResponse.json({ ...data, warnings }) : NextResponse.json(data)
}

// DELETE — remove an entry (?id=...).
export async function DELETE(req: NextRequest) {
  const session = await requireModuleOrRole(req, "knowledge", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  const { error } = await db.from("knowledge_base").delete().eq("id", id)
  if (error) return apiError(error)
  logAudit("knowledge base entry deleted", session.email, { id })
  return NextResponse.json({ ok: true })
}
