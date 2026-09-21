// Official Instagram Graph API Client (Meta Cloud API).
// Handles Instagram Direct Messages (DMs), Post Comments (Public Replies),
// and Private DM Replies to Post Comments.
//
// Env (.env):
//   INSTAGRAM_ACCESS_TOKEN   Meta Page/User Access Token with instagram_manage_messages & instagram_manage_comments
//   INSTAGRAM_ACCOUNT_ID     Instagram Business Account ID
//   INSTAGRAM_APP_SECRET     Meta App Secret (for webhook signature verification)
//   INSTAGRAM_VERIFY_TOKEN   Webhook verification token
//

const GRAPH = "https://graph.facebook.com/v21.0"
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || ""
const ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID || ""

function graphBase(token: string) {
  return token.startsWith("IG") ? "https://graph.instagram.com/v21.0" : "https://graph.facebook.com/v21.0"
}

export type BranchInstagramCtx = {
  id: string
  instagramToken?: string | null
  instagramAccountId?: string | null
  brandName?: string | null
} | null

/** Load a branch's Instagram context (null -> env-level default credentials). */
export async function branchInstagramCtx(branchId: string | null | undefined): Promise<BranchInstagramCtx> {
  if (!branchId) return null
  try {
    const { getBranch } = await import("./branches")
    const b = await getBranch(branchId)
    if (!b) return null
    return {
      id: b.id,
      instagramToken: (b as any).instagram_token || null,
      instagramAccountId: (b as any).instagram_account_id || null,
      brandName: b.brand_name,
    }
  } catch {
    return null
  }
}

function credsFor(branch?: BranchInstagramCtx): { token: string; accountId: string; configured: boolean } {
  const token = branch?.instagramToken || process.env.INSTAGRAM_ACCESS_TOKEN || TOKEN
  const accountId = branch?.instagramAccountId || process.env.INSTAGRAM_ACCOUNT_ID || ACCOUNT_ID
  return { token, accountId, configured: !!(token && accountId) }
}

/** Check health/configuration of Instagram API. */
export async function checkInstagramHealth(branch?: BranchInstagramCtx): Promise<{ ok: boolean; message: string }> {
  const { token, accountId, configured } = credsFor(branch)
  if (!configured) {
    return { ok: false, message: "INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_ACCOUNT_ID is missing" }
  }
  try {
    const base = graphBase(token)
    const target = (token.startsWith("IG") && !accountId) ? "me" : accountId
    const res = await fetch(`${base}/${target}?fields=id,username,name&access_token=${token}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { ok: false, message: err?.error?.message || `HTTP ${res.status}` }
    }
    const data = await res.json()
    return { ok: true, message: `Connected to @${data.username || data.id}` }
  } catch (e: any) {
    return { ok: false, message: e.message }
  }
}

/**
 * Send an Instagram Direct Message (DM) to a recipient user ID.
 */
export async function sendInstagramText(
  recipientIgUserId: string,
  text: string,
  branch?: BranchInstagramCtx
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { token, accountId, configured } = credsFor(branch)
  if (!configured) {
    console.warn(`[Instagram] DM unsent to ${recipientIgUserId} — INSTAGRAM_ACCESS_TOKEN/ACCOUNT_ID not configured`)
    return { ok: false, error: "Instagram API not configured" }
  }

  try {
    const res = await fetch(`${graphBase(token)}/${accountId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientIgUserId },
        message: { text },
      }),
    })

    const body = await res.json()
    if (!res.ok || body.error) {
      const msg = body?.error?.message || `HTTP ${res.status}`
      console.error(`[Instagram] DM send failed to ${recipientIgUserId}:`, msg)
      return { ok: false, error: msg }
    }

    return { ok: true, messageId: body.message_id || body.id }
  } catch (e: any) {
    console.error(`[Instagram] Exception during DM send:`, e.message)
    return { ok: false, error: e.message }
  }
}

/**
 * Public reply to a comment on an Instagram post.
 */
export async function replyInstagramComment(
  commentId: string,
  text: string,
  branch?: BranchInstagramCtx
): Promise<{ ok: boolean; replyId?: string; error?: string }> {
  const { token, configured } = credsFor(branch)
  if (!configured) {
    return { ok: false, error: "Instagram API not configured" }
  }

  try {
    const res = await fetch(`${graphBase(token)}/${commentId}/replies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: text }),
    })

    const body = await res.json()
    if (!res.ok || body.error) {
      const msg = body?.error?.message || `HTTP ${res.status}`
      console.error(`[Instagram] Comment reply failed for ${commentId}:`, msg)
      return { ok: false, error: msg }
    }

    return { ok: true, replyId: body.id }
  } catch (e: any) {
    console.error(`[Instagram] Exception during comment reply:`, e.message)
    return { ok: false, error: e.message }
  }
}

/**
 * Send a Private DM Reply to a user who left a comment on an Instagram post.
 */
export async function privateReplyInstagramComment(
  commentId: string,
  text: string,
  branch?: BranchInstagramCtx
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { token, accountId, configured } = credsFor(branch)
  if (!configured) {
    return { ok: false, error: "Instagram API not configured" }
  }

  try {
    const res = await fetch(`${graphBase(token)}/${accountId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text },
      }),
    })

    const body = await res.json()
    if (!res.ok || body.error) {
      const msg = body?.error?.message || `HTTP ${res.status}`
      console.error(`[Instagram] Private DM reply to comment ${commentId} failed:`, msg)
      return { ok: false, error: msg }
    }

    return { ok: true, messageId: body.message_id || body.id }
  } catch (e: any) {
    console.error(`[Instagram] Exception during private DM reply to comment:`, e.message)
    return { ok: false, error: e.message }
  }
}
