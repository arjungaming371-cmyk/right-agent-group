import { NextRequest, NextResponse } from "next/server"
import { uploadWhatsAppMedia, branchWhatsAppCtx } from "@/lib/whatsapp"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Upload media the agent attaches in the chat (photo / video / document) to
// Meta for the WABA number that will send it. Returns { id } — the caller
// then POSTs /api/whatsapp/send with { mediaKind, mediaId, ... }.
//
// WhatsApp media messaging limit is 16 MB (Meta's API accepts up to 100 MB
// on upload, but anything over 16 MB can never be SENT as a message) —
// enforce 16 MB here so users get a clean error instead of a failed send.
const MAX_BYTES = 16 * 1024 * 1024

const ALLOWED = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "video/mp4", "video/3gpp",
  "audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg",
  "application/pdf",
  "application/vnd.ms-powerpoint", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel", "application/rtf", "application/wps-office.docx",
  "text/plain", "text/csv",
])

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "whatsapp", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const branchId = sessionBranchId(session)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: "multipart form-data required" }, { status: 400 })
  }
  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field required" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large — WhatsApp allows up to 16 MB per media message` }, { status: 413 })
  }
  const mime = file.type || "application/octet-stream"
  if (!ALLOWED.has(mime)) {
    return NextResponse.json({ error: `Unsupported file type: ${mime}` }, { status: 415 })
  }

  const waBranch = await branchWhatsAppCtx(branchId)
  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await uploadWhatsAppMedia(
    { buffer, mimeType: mime, filename: file.name || "upload" },
    waBranch
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Upload failed" }, { status: 500 })
  }
  return NextResponse.json({ ok: true, mediaId: result.id, mimeType: mime })
}
