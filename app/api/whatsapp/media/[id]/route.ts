import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { downloadBranchWhatsAppMedia, type BranchWhatsAppCtx } from "@/lib/whatsapp"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Authenticated media proxy for the chat window: streams an image / video /
// audio / document that was sent or received on WhatsApp. The browser never
// sees the WABA token — this endpoint fetches from Meta server-side with the
// right credentials (the branch's own token when the message arrived on a
// branch number, else the env default) and pipes the bytes through.
//
// GET /api/whatsapp/media/[id]?branch=<branch uuid>
// The `branch` hint comes from the message row's branch_id; without it the
// env-level credentials are used (single-number deployments).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "viewer", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { id } = await params
  const mediaId = String(id || "").trim()
  if (!mediaId || !/^[A-Za-z0-9_-]+$/.test(mediaId)) {
    return NextResponse.json({ error: "invalid media id" }, { status: 400 })
  }

  // Resolve the branch's credentials when the caller told us which branch the
  // media belongs to — media ids are WABA-scoped, so the env token alone
  // cannot download media that arrived on a branch number.
  let ctx: BranchWhatsAppCtx = null
  const branchHint = new URL(req.url).searchParams.get("branch")
  const sessionBranch = sessionBranchId(session)
  const wantedBranch = branchHint || sessionBranch || null
  if (wantedBranch) {
    try {
      const b = await query(
        `SELECT id, whatsapp_token, whatsapp_phone_number_id, brand_name FROM branches WHERE id = $1 LIMIT 1`,
        [wantedBranch]
      )
      const row = b.rows[0]
      if (row) {
        ctx = { id: row.id, whatsappToken: row.whatsapp_token || null, whatsappPhoneNumberId: row.whatsapp_phone_number_id || null, brandName: row.brand_name || null }
      }
    } catch {}
  }

  const media = await downloadBranchWhatsAppMedia(mediaId, ctx)
  if (!media) {
    // One retry with the env default credentials — covers messages that came
    // in before branch scoping existed (branch_id NULL) on multi-number setups.
    const fallback = ctx ? await downloadBranchWhatsAppMedia(mediaId, null) : null
    if (!fallback) return NextResponse.json({ error: "media not found or expired" }, { status: 404 })
    return binaryResponse(fallback.buffer, fallback.mimeType, mediaId)
  }
  return binaryResponse(media.buffer, media.mimeType, mediaId)
}

function binaryResponse(buffer: Buffer, mimeType: string, mediaId: string): Response {
  const type = mimeType || "application/octet-stream"
  const disposition = type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/")
    ? "inline" : "attachment"
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(buffer.length),
      "Content-Disposition": `${disposition}; filename="whatsapp-${mediaId.slice(-8)}"`,
      "Cache-Control": "private, max-age=86400",
    },
  })
}
