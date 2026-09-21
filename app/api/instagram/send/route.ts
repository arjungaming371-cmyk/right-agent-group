import { NextRequest, NextResponse } from "next/server"
import { db, query } from "@/lib/db"
import { sendInstagramText, replyInstagramComment, branchInstagramCtx } from "@/lib/instagram"
import { requireModuleOrRole } from "@/lib/auth"
import { sessionBranchId } from "@/lib/branches"

export async function POST(req: NextRequest) {
  const session = await requireModuleOrRole(req, "instagram", ["admin", "agent", "branch_manager"])
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { recipientIgUserId, message, leadId, type, commentId, username } = await req.json()
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 })

  const branchId = sessionBranchId(session)

  // FIX (2026-09-20): verify the lead belongs to the caller's branch before
  // writing records onto it (cross-branch write, same as the WhatsApp path).
  if (leadId && branchId) {
    const owner = await db.from("leads").select("branch_id").eq("id", leadId).single()
    if (!owner.data || owner.data.branch_id !== branchId) {
      return NextResponse.json({ error: "Lead not found in your branch" }, { status: 404 })
    }
  }

  const igBranch = await branchInstagramCtx(branchId)

  let result: { ok: boolean; messageId?: string; replyId?: string; error?: string }

  if (type === "comment" && commentId) {
    result = await replyInstagramComment(commentId, message, igBranch)
  } else {
    if (!recipientIgUserId) {
      return NextResponse.json({ error: "recipientIgUserId required for DM" }, { status: 400 })
    }
    result = await sendInstagramText(recipientIgUserId, message, igBranch)
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Failed to send Instagram message" }, { status: 500 })
  }

  // Insert Outbound DM / Comment Record
  await query(
    `INSERT INTO instagram_messages (lead_id, ig_user_id, ig_username, direction, type, content, status, ig_message_id, comment_id, branch_id)
     VALUES ($1, $2, $3, 'outbound', $4, $5, 'sent', $6, $7, $8)`,
    [
      leadId || null,
      recipientIgUserId || "unknown",
      username || null,
      type === "comment" ? "comment" : "dm",
      message,
      result.messageId || null,
      commentId || null,
      branchId,
    ]
  ).catch(() => {})

  if (leadId) {
    await db
      .from("comm_logs")
      .insert({ lead_id: leadId, type: "instagram", summary: message.slice(0, 140), outcome: "sent" })
      .catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
