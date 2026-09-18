// Session auth — HMAC-SHA256 signed cookies via Web Crypto.
// Works in BOTH Next.js Edge middleware and Node API routes (no extra deps).
//
// Cookie format:  base64url(payloadJSON) + "." + base64url(hmacSignature)
// Payload: { email, role, orgId?, branchId?, exp } — exp is a unix-seconds expiry.
//
// Multi-branch fields (2026-09):
//   orgId    — the user's organization (parent account). Usually null: the
//              deployment has ONE org and admin sees all of it.
//   branchId — the user's ACTIVE branch scope. Branch-scoped roles
//              (branch_manager and branch-bound agents/viewers) always carry
//              their branch here; admins/developers carry null (= "all
//              branches") or the branch they switched to via /api/auth/branch.

export type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

export const SESSION_COOKIE = "rag_session"
const SESSION_DAYS = 7

// Roles that may change their own branch scope via /api/auth/branch.
// Everyone else is pinned to the branch assigned in allowed_emails.
export function canSwitchBranch(role: Role): boolean {
  return role === "admin" || role === "developer"
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET missing or too short (min 32 chars). Generate one: openssl rand -hex 32")
  }
  return s
}

const enc = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(getSecret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ])
}

export type Session = { email: string; role: Role; exp: number; orgId?: string | null; branchId?: string | null }

export async function createSessionToken(
  email: string,
  role: Role,
  scope?: { orgId?: string | null; branchId?: string | null }
): Promise<string> {
  const payload: Session = {
    email,
    role,
    orgId: scope?.orgId ?? null,
    branchId: scope?.branchId ?? null,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  }
  const payloadB64 = toBase64Url(enc.encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payloadB64))
  return `${payloadB64}.${toBase64Url(new Uint8Array(sig))}`
}

export async function verifySessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [payloadB64, sigB64] = parts
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      fromBase64Url(sigB64) as unknown as ArrayBuffer,
      enc.encode(payloadB64)
    )
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as Session
    if (!payload?.email || typeof payload.exp !== "number") return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    // Sessions signed before the role field existed: treat as agent, the
    // least-privileged non-viewer role, rather than silently trusting admin.
    if (payload.role !== "admin" && payload.role !== "agent" && payload.role !== "viewer" && payload.role !== "developer" && payload.role !== "branch_manager") payload.role = "agent"
    // Sessions signed before the multi-branch fields existed: normalize to
    // "no branch scope" (= whole company, legacy single-tenant behaviour).
    if (payload.orgId === undefined) payload.orgId = null
    if (payload.branchId === undefined) payload.branchId = null
    return payload
  } catch {
    return null
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  }
}

// ---- Short-lived signed tokens for the 2FA (email OTP) step ------------
// Same HMAC scheme as sessions, different shape: issued by the OAuth
// callback when two_factor_auth is on, consumed by /api/auth/otp once the
// user types the emailed code. 10-minute expiry, single purpose.

export type OtpPending = { kind: "otp"; email: string; role: Role; next: string; exp: number; orgId?: string | null; branchId?: string | null }

export async function createOtpPendingToken(
  email: string,
  role: Role,
  next: string,
  scope?: { orgId?: string | null; branchId?: string | null }
): Promise<string> {
  const payload: OtpPending = {
    kind: "otp",
    email,
    role,
    next,
    orgId: scope?.orgId ?? null,
    branchId: scope?.branchId ?? null,
    exp: Math.floor(Date.now() / 1000) + 600,
  }
  const payloadB64 = toBase64Url(enc.encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payloadB64))
  return `${payloadB64}.${toBase64Url(new Uint8Array(sig))}`
}

export async function verifyOtpPendingToken(token: string | undefined | null): Promise<OtpPending | null> {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      fromBase64Url(parts[1]) as unknown as ArrayBuffer,
      enc.encode(parts[0])
    )
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0]))) as OtpPending
    if (payload?.kind !== "otp" || !payload.email || typeof payload.exp !== "number") return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    if (payload.orgId === undefined) payload.orgId = null
    if (payload.branchId === undefined) payload.branchId = null
    return payload
  } catch {
    return null
  }
}

/** Reads + verifies the session inside a Node API route (defense in depth beyond middleware). */
export async function getSessionFromRequest(req: Request): Promise<Session | null> {
  const cookieHeader = req.headers.get("cookie") || ""
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  return verifySessionToken(match ? decodeURIComponent(match[1]) : null)
}

export type LiveSession = Session & { allowedModules?: string[] | null }

/**
 * Re-validates session against DB in real-time.
 * If user is deleted from allowed_emails, returns null (revokes session instantly).
 * Hydrates live role, branchId, and allowed_modules from DB.
 */
export async function getLiveSession(req: Request): Promise<LiveSession | null> {
  const session = await getSessionFromRequest(req)
  if (!session) return null

  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase()
  const isSystemAdmin = adminEmail !== "" && session.email.toLowerCase() === adminEmail

  if (isSystemAdmin) {
    return { ...session, allowedModules: null }
  }

  try {
    const { query } = await import("@/lib/db")
    const r = await query(
      `SELECT role, org_id, branch_id, allowed_modules FROM allowed_emails WHERE lower(email) = $1 LIMIT 1`,
      [session.email.toLowerCase()]
    )
    if (r.rowCount === 0) {
      // User was removed from allowed_emails — invalidate session immediately
      return null
    }
    const dbRow = r.rows[0]
    session.branchId = dbRow.branch_id ?? session.branchId
    session.orgId = dbRow.org_id ?? session.orgId

    let liveRole: Role | null = null
    const rawRole = dbRow.role || "agent"
    if (["admin", "agent", "viewer", "developer", "branch_manager"].includes(rawRole)) {
      liveRole = rawRole as Role
    } else {
      try {
        const cf = await query(`SELECT config FROM form_configs WHERE id = 'custom_roles_config'`)
        if (cf.rowCount && cf.rows[0]?.config?.roles) {
          const found = cf.rows[0].config.roles.find((cr: any) => cr.id === rawRole)
          if (found?.baseRole) liveRole = found.baseRole as Role
        }
      } catch {}
      if (!liveRole) liveRole = "agent"
    }
    session.role = liveRole

    const allowedModules = dbRow.allowed_modules !== null && dbRow.allowed_modules !== undefined
      ? (Array.isArray(dbRow.allowed_modules) ? dbRow.allowed_modules : [])
      : null

    return { ...session, allowedModules }
  } catch (err) {
    console.error("getLiveSession DB verification error:", err)
    return session
  }
}

/** Reads the session and checks it has one of the allowed roles. Returns null if either check fails. */
export async function requireRole(req: Request, roles: Role[]): Promise<Session | null> {
  const session = await getLiveSession(req)
  if (!session) return null
  if (session.role === "developer") return session
  if (!roles.includes(session.role)) return null
  return session
}

/**
 * Reads the session and checks if the user has access to a specific module key OR one of the allowed base roles.
 * If allowed_modules is explicitly set for the user, it takes precedence over role defaults.
 */
export async function requireModuleOrRole(
  req: Request,
  moduleKey: string,
  allowedRoles: Role[]
): Promise<Session | null> {
  const session = await getLiveSession(req)
  if (!session) return null
  if (session.role === "developer") return session

  if (session.allowedModules !== null && session.allowedModules !== undefined) {
    if (session.allowedModules.includes(moduleKey)) return session
    return null
  }

  if (allowedRoles.includes(session.role)) return session
  return null
}

