import { NextResponse } from "next/server"
import { db } from "@/lib/db"
export async function GET() {
  const { count } = await db.from("whatsapp_messages").select("*",{count:"exact",head:true}).eq("direction","inbound").eq("status","received")
  return NextResponse.json({ count: count ?? 0 })
}
