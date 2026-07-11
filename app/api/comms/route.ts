import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET() {
  const { data, error } = await db
    .from("comm_logs")
    .select("*, leads(name)")
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
