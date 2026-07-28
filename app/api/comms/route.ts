import { NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { db } from "@/lib/db"

export async function GET() {
  const { data, error } = await db
    .from("comm_logs")
    .select("*, leads(name)")
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) return apiError(error)
  return NextResponse.json(data ?? [])
}
