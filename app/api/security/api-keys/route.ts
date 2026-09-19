import { NextRequest, NextResponse } from "next/server"
import { getSystemKeysStatus, setSystemKeys, getTokenUsageStats } from "@/lib/system-keys"
import { requireRole } from "@/lib/auth"

export async function GET(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const status = await getSystemKeysStatus()
    const usage = await getTokenUsageStats()
    return NextResponse.json({ status, usage })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, ["admin", "developer"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const { keys } = await req.json()
    if (!keys || typeof keys !== "object") {
      return NextResponse.json({ error: "keys object required" }, { status: 400 })
    }

    await setSystemKeys(keys, session.email)
    const updatedStatus = await getSystemKeysStatus()
    return NextResponse.json({ ok: true, status: updatedStatus })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
