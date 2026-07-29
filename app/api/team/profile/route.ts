import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { getSessionFromRequest } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Self-service profile editing — a user can ONLY ever update their OWN row
// (session.email), never anyone else's. Name/address/phone/age are free text
// the user controls about themselves; there is nothing here an admin needs
// to gate, since it can't affect anyone but the editor's own profile.

const MAX_NAME = 80
const MAX_PHONE = 30
const MAX_ADDRESS = 300
// Data-URI avatar cap — keeps a photo out of the "waste" territory the rest
// of this project just got cleaned of. 300KB is generous for a profile photo
// and small enough not to bloat every /api/team response.
const MAX_AVATAR_BYTES = 300 * 1024

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}) as any)
  const updates: Record<string, any> = {}

  if (typeof body?.displayName === "string") {
    const name = body.displayName.trim()
    if (!name || name.length > MAX_NAME) {
      return NextResponse.json({ error: `Name must be 1-${MAX_NAME} characters` }, { status: 400 })
    }
    updates.display_name = name
  }

  if (typeof body?.phone === "string") {
    const phone = body.phone.trim()
    if (phone.length > MAX_PHONE) return NextResponse.json({ error: "Phone number too long" }, { status: 400 })
    updates.phone = phone || null
  }

  if (typeof body?.address === "string") {
    const address = body.address.trim()
    if (address.length > MAX_ADDRESS) return NextResponse.json({ error: "Address too long" }, { status: 400 })
    updates.address = address || null
  }

  if (body?.age !== undefined && body?.age !== null && body?.age !== "") {
    const age = Number(body.age)
    if (!Number.isInteger(age) || age < 16 || age > 100) {
      return NextResponse.json({ error: "Age must be a whole number between 16 and 100" }, { status: 400 })
    }
    updates.age = age
  } else if (body?.age === null || body?.age === "") {
    updates.age = null
  }

  if (typeof body?.avatarUrl === "string") {
    const avatar = body.avatarUrl.trim()
    if (avatar) {
      // Rough size check for a data: URI upload — base64 runs ~4/3 the
      // original byte size, so this catches an oversized photo before it
      // ever reaches the database.
      if (avatar.startsWith("data:") && avatar.length > MAX_AVATAR_BYTES * 1.4) {
        return NextResponse.json({ error: "Photo is too large — please use a smaller image (under ~300KB)" }, { status: 400 })
      }
      if (!avatar.startsWith("data:image/") && !/^https?:\/\//.test(avatar)) {
        return NextResponse.json({ error: "Invalid photo" }, { status: 400 })
      }
    }
    updates.avatar_url = avatar || null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 })
  }

  // Editing name or photo here flips this on permanently, so a future Google
  // login never silently overwrites what the user just set (see the OAuth
  // callback's upsert).
  if ("display_name" in updates || "avatar_url" in updates) {
    updates.profile_customized = true
  }

  const cols = Object.keys(updates)
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(", ")
  const values = cols.map((c) => updates[c])

  await query(
    `INSERT INTO team_profiles (email, ${cols.join(", ")})
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")})
     ON CONFLICT (email) DO UPDATE SET ${setClause}`,
    [session.email, ...values]
  )

  return NextResponse.json({ ok: true })
}
