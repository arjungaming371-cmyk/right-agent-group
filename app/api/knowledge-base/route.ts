import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db } from "@/lib/db"
import { requireModuleOrRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

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
export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "knowledge", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const title = typeof body.title === "string" ? body.title.trim() : ""
  const content = typeof body.content === "string" ? body.content.trim() : ""
  if (!title || !content) return NextResponse.json({ error: "title and content required" }, { status: 400 })

  const { data, error } = await db.from("knowledge_base").insert({
    title: title.slice(0, 200),
    content: content.slice(0, 4000),
    category: typeof body.category === "string" ? body.category.slice(0, 100) : null,
    is_active: body.is_active !== false,
    created_by: session.email,
  }).select().single()
  if (error) return apiError(error)
  logAudit("knowledge base entry created", session.email, { id: data?.id, title })
  return NextResponse.json(data)
}

// PATCH — update an entry.
export async function PATCH(req: NextRequest) {
  const session = await requireModuleOrRole(req, "knowledge", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { id, ...rest } = body
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (typeof rest.title === "string") updates.title = rest.title.trim().slice(0, 200)
  if (typeof rest.content === "string") updates.content = rest.content.trim().slice(0, 4000)
  if (typeof rest.category === "string" || rest.category === null) updates.category = rest.category
  if (typeof rest.is_active === "boolean") updates.is_active = rest.is_active

  const { data, error } = await db.from("knowledge_base").update(updates).eq("id", id).select().single()
  if (error) return apiError(error)
  logAudit("knowledge base entry updated", session.email, { id, fields: Object.keys(rest) })
  return NextResponse.json(data)
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
