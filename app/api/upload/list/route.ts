import { NextResponse } from "next/server"
import { db } from "@/lib/db"
export async function GET() {
  const { data } = await db.from("uploaded_files").select("*").order("created_at",{ascending:false}).limit(50)
  return NextResponse.json(data ?? [])
}
