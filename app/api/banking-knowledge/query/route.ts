import { NextRequest, NextResponse } from "next/server"
import { queryBankingKnowledge } from "@/lib/brie/rag"
import { BrieQueryRequest } from "@/lib/brie/types"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BrieQueryRequest
    if (!body || !body.query) {
      return NextResponse.json({ error: "query string is required" }, { status: 400 })
    }

    const result = await queryBankingKnowledge(body)
    return NextResponse.json(result)
  } catch (e: any) {
    console.error("API /api/banking-knowledge/query error:", e.message)
    return NextResponse.json({ error: "Internal knowledge query error", details: e.message }, { status: 500 })
  }
}
