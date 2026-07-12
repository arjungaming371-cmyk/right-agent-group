import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { logAudit } from "@/lib/audit"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  if (searchParams.get("count")) {
    const { count } = await db.from("loan_applications").select("*", { count: "exact", head: true })
    return NextResponse.json({ count: count ?? 0 })
  }

  const id = searchParams.get("id")
  if (id) {
    const { data, error } = await db.from("loan_applications").select("*").eq("id", id).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 404 })
    return NextResponse.json(data)
  }

  const { data, error } = await db.from("loan_applications").select("*").order("created_at", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await db.from("loan_applications").insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const session = await requireRole(req, ["admin", "agent"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, ...updates } = await req.json()
  const { data, error } = await db.from("loan_applications").update(updates).eq("id", id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  logAudit("loan application updated", session.email, { loanAppId: id, fields: Object.keys(updates) })
  return NextResponse.json(data)
}
