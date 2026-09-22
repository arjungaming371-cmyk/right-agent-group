// Multi-branch (multi-tenant) core — the ONE module every branch-aware
// surface goes through.
//
// Model:
//   organizations (parent account, owns billing)
//     └── branches (sub-accounts: own DLT ExoPhone, own WhatsApp number,
//                   own branding, own quotas, own script overrides)
//           └── branch_scoped data (leads, calls, whatsapp, loans, uploads)
//
// Roles (lib/auth.ts):
//   admin / developer            → all branches (branchId in session = active
//                                  selection, null = whole company)
//   branch_manager / agent / viewer → pinned to session.branchId (their
//                                  allowed_emails row decides; they cannot
//                                  switch)
//
// Everything here is server-only (imports lib/db lazily so edge middleware
// never pulls this in).

import type { Session } from "./auth"

export type BranchRow = {
  id: string
  org_id: string
  name: string
  code: string
  region: string | null
  status: "active" | "suspended"
  exotel_sid: string | null
  exotel_api_key: string | null
  exotel_api_token: string | null
  exotel_caller_id: string | null
  exotel_flow_app_id: string | null
  whatsapp_phone_number_id: string | null
  whatsapp_token: string | null
  whatsapp_display_name: string | null
  instagram_account_id: string | null
  instagram_token: string | null
  brand_name: string | null
  brand_logo_url: string | null
  brand_primary_color: string
  brand_tagline: string | null
  monthly_call_limit: number | null
  monthly_whatsapp_limit: number | null
  max_ai_employees: number | null
  created_at?: string
  updated_at?: string
}

// Public-safe subset — what /api/branding may serve to unauthenticated pages.
export type BrandingInfo = {
  orgName: string
  brandName: string
  logoUrl: string | null
  primaryColor: string
  tagline: string | null
  branchCode: string | null
}

export function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * The branch scope a session may READ/WRITE:
 *  - branch-scoped roles: ALWAYS their session.branchId (the route stamps new
 *    rows with it and filters lists by it).
 *  - admin/developer: session.branchId — which is null when they are viewing
 *    the whole company, or a branch they actively switched into.
 *
 * Never trust a request's branchId param for scoping decisions; this value is
 * signed into the session cookie, so branch managers cannot escalate by
 * passing another branch's id in the body.
 */
export function sessionBranchId(session: Session | null): string | null {
  return session?.branchId || null
}

/** Admin/developer gate — the roles that may manage branches at all. */
export function canManageBranches(session: Session | null): boolean {
  return session?.role === "admin" || session?.role === "developer"
}

// ---------------------------------------------------------------------------
// Branch resolution — the two routing identities
// ---------------------------------------------------------------------------

/** Last-10-digits match for ExoPhone/caller-id style numbers. */
export function digits10(phone: string | null | undefined): string {
  return (phone || "").replace(/\D/g, "").slice(-10)
}

/**
 * INBOUND CALLS: which branch owns the number that was called?
 * The ExoPhone (DLT-approved caller ID) is the branch's routing identity.
 * Falls back to the deployment-level EXOTEL_CALLER_ID → null (= HQ, i.e. the
 * env-configured default Exotel account, no branch override).
 */
export async function resolveBranchByCallerId(calledNumber: string | null | undefined): Promise<BranchRow | null> {
  const digits = digits10(calledNumber)
  if (!digits) return null
  const { query } = await import("./db")
  try {
    const res = await query(
      `SELECT * FROM branches
        WHERE right(regexp_replace(exotel_caller_id, '\\D', '', 'g'), 10) = $1
        LIMIT 1`,
      [digits]
    )
    return (res.rows[0] as BranchRow) || null
  } catch (e: any) {
    console.error("resolveBranchByCallerId error (falling back to HQ):", e.message)
    return null
  }
}

/**
 * INBOUND WHATSAPP: which branch owns the WhatsApp Business number the
 * customer wrote to? metadata.phone_number_id is the routing identity Meta
 * puts in EVERY webhook payload.
 */
export async function resolveBranchByWhatsAppPhoneId(phoneNumberId: string | null | undefined): Promise<BranchRow | null> {
  if (!phoneNumberId) return null
  const { query } = await import("./db")
  try {
    const res = await query(`SELECT * FROM branches WHERE whatsapp_phone_number_id = $1 LIMIT 1`, [phoneNumberId])
    return (res.rows[0] as BranchRow) || null
  } catch (e: any) {
    console.error("resolveBranchByWhatsAppPhoneId error (falling back to default WABA):", e.message)
    return null
  }
}

/** Branch row by id (cached 60s — branch config changes are rare). */
const _branchCache = new Map<string, { row: BranchRow | null; at: number }>()
const BRANCH_CACHE_TTL = 60_000

export async function getBranch(branchId: string | null | undefined): Promise<BranchRow | null> {
  if (!branchId) return null
  const hit = _branchCache.get(branchId)
  if (hit && Date.now() - hit.at < BRANCH_CACHE_TTL) return hit.row
  const { query } = await import("./db")
  try {
    const res = await query(`SELECT * FROM branches WHERE id = $1 LIMIT 1`, [branchId])
    const row = (res.rows[0] as BranchRow) || null
    _branchCache.set(branchId, { row, at: Date.now() })
    return row
  } catch (e: any) {
    console.error("getBranch error:", e.message)
    return null
  }
}

export function invalidateBranchCache(branchId?: string) {
  if (branchId) _branchCache.delete(branchId)
  else _branchCache.clear()
}

// ---------------------------------------------------------------------------
// Scripts — per-branch customization with a 3-level fallback chain
// ---------------------------------------------------------------------------

/**
 * Resolve the script for branch + employee + language:
 *   1) branch_scripts(branch, employee, language)
 *   2) branch_scripts(branch, NULL, language)   — branch-wide override
 *   3) null — caller falls back to the org-level ai_scripts/default
 */
export async function resolveBranchScript(
  branchId: string | null | undefined,
  employeeId: string | null | undefined,
  language: string
): Promise<string | null> {
  if (!branchId) return null
  const { query } = await import("./db")
  try {
    const res = await query(
      `SELECT content FROM branch_scripts
        WHERE branch_id = $1 AND language = $2
          AND (employee_id = $3 OR employee_id IS NULL)
        ORDER BY (employee_id = $3) DESC, updated_at DESC
        LIMIT 1`,
      [branchId, language, employeeId || null]
    )
    return res.rows[0]?.content || null
  } catch (e: any) {
    console.error("resolveBranchScript error:", e.message)
    return null
  }
}

/**
 * Public branding for a branch (white-label). Falls back to the
 * organization row, then to the deployment defaults — customer-facing pages
 * (promo site, loan form) render unbranded rather than broken.
 */
export async function getBranding(branchId: string | null | undefined): Promise<BrandingInfo> {
  const fallback: BrandingInfo = {
    orgName: process.env.NEXT_PUBLIC_ORG_NAME || "Right Agent Group",
    brandName: process.env.NEXT_PUBLIC_ORG_NAME || "Right Agent Group",
    logoUrl: null,
    primaryColor: "#4f46e5",
    tagline: null,
    branchCode: null,
  }
  if (!branchId) return fallback
  const { query } = await import("./db")
  try {
    const res = await query(
      `SELECT b.brand_name, b.brand_logo_url, b.brand_primary_color, b.brand_tagline, b.code AS branch_code,
              o.name AS org_name
         FROM branches b LEFT JOIN organizations o ON o.id = b.org_id
        WHERE b.id = $1 LIMIT 1`,
      [branchId]
    )
    const row = res.rows[0]
    if (!row) return fallback
    return {
      orgName: row.org_name || fallback.orgName,
      brandName: row.brand_name || row.org_name || fallback.brandName,
      logoUrl: row.brand_logo_url || null,
      primaryColor: row.brand_primary_color || fallback.primaryColor,
      tagline: row.brand_tagline || null,
      branchCode: row.branch_code || null,
    }
  } catch (e: any) {
    console.error("getBranding error (using defaults):", e.message)
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Usage metering + quotas (centralized billing, per-branch limits)
// ---------------------------------------------------------------------------

export type UsageKind = "call" | "call_seconds" | "whatsapp" | "stt_seconds" | "tts_characters" | "llm_tokens"

// Atomic upsert — every send/call records usage fire-and-forget; races are
// resolved by the primary key (branch_id, month).
export async function recordUsage(branchId: string | null | undefined, kind: UsageKind, amount: number = 1): Promise<void> {
  if (!branchId) return
  const column =
    kind === "call" ? "calls_made"
    : kind === "call_seconds" ? "call_seconds"
    : kind === "whatsapp" ? "whatsapp_messages"
    : kind === "stt_seconds" ? "stt_seconds"
    : kind === "tts_characters" ? "tts_characters"
    : "llm_tokens"
  const { query } = await import("./db")
  try {
    await query(
      `INSERT INTO branch_usage (branch_id, month, ${column}) VALUES ($1, $2, $3)
       ON CONFLICT (branch_id, month)
       DO UPDATE SET ${column} = branch_usage.${column} + $3, updated_at = now()`,
      [branchId, currentMonth(), amount]
    )
  } catch (e: any) {
    // Metering must NEVER break the customer-facing path — log and move on.
    console.error(`branch_usage record error (${kind}):`, e.message)
  }
}

export type QuotaCheck = { ok: boolean; reason?: string; used?: number; limit?: number }

/**
 * Quota gate for business-initiated actions. Called BEFORE an outbound call
 * is placed and BEFORE a template send goes out. A suspended branch fails
 * everything; a branch over its monthly limit fails that dimension only.
 * DB errors fail OPEN for calls already in-flight paths... no — they fail
 * CLOSED only for WhatsApp template sends (regulatory risk), and OPEN for
 * outbound calls (a transient DB blip should not stall the sales team; the
 * limit is a commercial control, not a compliance one).
 */
export async function checkQuota(branchId: string | null | undefined, kind: "call" | "whatsapp"): Promise<QuotaCheck> {
  if (!branchId) return { ok: true } // HQ / un-branded deployment — unlimited (env-level costs)
  const branch = await getBranch(branchId)
  if (!branch) return { ok: true } // unknown branch id — treat as HQ rather than break the flow
  if (branch.status === "suspended") {
    return { ok: false, reason: `Branch "${branch.name}" is suspended — reactivate it in Branches to resume outreach.` }
  }
  const limit = kind === "call" ? branch.monthly_call_limit : branch.monthly_whatsapp_limit
  if (!limit || limit <= 0) return { ok: true } // NULL/0 = unlimited
  const { query } = await import("./db")
  try {
    const res = await query(
      `SELECT ${kind === "call" ? "calls_made" : "whatsapp_messages"} AS used
         FROM branch_usage WHERE branch_id = $1 AND month = $2`,
      [branchId, currentMonth()]
    )
    const used = parseInt(res.rows[0]?.used || "0", 10)
    if (used >= limit) {
      return { ok: false, reason: `Branch "${branch.name}" hit its monthly ${kind} limit (${used}/${limit}).`, used, limit }
    }
    return { ok: true, used, limit }
  } catch (e: any) {
    console.error("checkQuota error:", e.message)
    // See docstring: calls fail open; WhatsApp sends fail closed.
    return kind === "call" ? { ok: true } : { ok: false, reason: "Quota check unavailable — message suppressed (fail-closed)." }
  }
}

/** Which AI Employees serve a branch (shared book + dedicated assignments). */
export async function getBranchAiEmployees(branchId: string | null | undefined) {
  const { query } = await import("./db")
  if (!branchId) {
    // HQ view: everything active.
    const res = await query(`SELECT * FROM ai_employees WHERE is_active = true ORDER BY name`)
    return res.rows
  }
  const res = await query(
    `SELECT e.* FROM ai_employees e
      WHERE e.is_active = true AND (e.scope = 'shared' OR EXISTS (
        SELECT 1 FROM branch_ai_employees ba WHERE ba.employee_id = e.id AND ba.branch_id = $1))
      ORDER BY (EXISTS (SELECT 1 FROM branch_ai_employees ba WHERE ba.employee_id = e.id AND ba.branch_id = $1 AND ba.is_primary)) DESC, e.name`,
    [branchId]
  )
  return res.rows
}

export type BranchVoice = { provider: "sarvam" | "cartesia"; speaker: string }

/**
 * The VOICE the branch's primary AI Employee speaks with — resolved once at
 * call start from the branch's primary assignment (then any assignment).
 * null → the deployment defaults (SARVAM_TTS_SPEAKER / CARTESIA_VOICE_ID),
 * which keeps single-tenant deployments and un-configured branches exactly
 * as they were.
 */
export async function getBranchVoice(branchId: string | null | undefined): Promise<BranchVoice | null> {
  if (!branchId) return null
  const { query } = await import("./db")
  try {
    const res = await query(
      `SELECT e.voice_provider, e.voice_speaker
         FROM branch_ai_employees ba JOIN ai_employees e ON e.id = ba.employee_id
        WHERE ba.branch_id = $1 AND e.is_active = true AND e.voice_speaker IS NOT NULL
        ORDER BY ba.is_primary DESC, e.created_at
        LIMIT 1`,
      [branchId]
    )
    const row = res.rows[0]
    if (!row?.voice_speaker) return null
    return { provider: row.voice_provider === "cartesia" ? "cartesia" : "sarvam", speaker: String(row.voice_speaker) }
  } catch (e: any) {
    console.error("getBranchVoice error (using deployment default voice):", e.message)
    return null
  }
}
