// Edge-safe session verification.
//
// This module intentionally has no imports. The complete auth module also
// contains Node/Postgres-backed helpers, and importing it from middleware
// bundles `pg` into the Edge runtime. Keeping the cookie verifier here makes
// the middleware artifact portable while API routes retain their live DB
// authorization checks.

export type Role = "admin" | "agent" | "viewer" | "developer" | "branch_manager"

export const SESSION_COOKIE = "rag_session"

export type Session = {
  email: string
  role: Role
  exp: number
  orgId?: string | null
  branchId?: string | null
  epoch?: number
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET missing or too short (min 32 chars). Generate one: openssl rand -hex 32")
  }
  return secret
}

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  )
}

export async function verifySessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [payloadB64, signatureB64] = parts

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      fromBase64Url(signatureB64) as unknown as ArrayBuffer,
      encoder.encode(payloadB64),
    )
    if (!valid) return null

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as Session & { kind?: string }
    if (!payload?.email || typeof payload.exp !== "number") return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    // OTP-pending tokens share the signing key but must never become sessions.
    if (payload.kind === "otp") return null

    // Preserve the legacy-token compatibility rules from lib/auth.ts.
    if (!["admin", "agent", "viewer", "developer", "branch_manager"].includes(payload.role)) {
      payload.role = "agent"
    }
    if (payload.orgId === undefined) payload.orgId = null
    if (payload.branchId === undefined) payload.branchId = null
    return payload
  } catch {
    return null
  }
}
