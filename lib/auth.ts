// Session auth — HMAC-SHA256 signed cookies via Web Crypto.
// Works in BOTH Next.js Edge middleware and Node API routes (no extra deps).
//
// Cookie format:  base64url(payloadJSON) + "." + base64url(hmacSignature)
// Payload: { email, exp } — exp is a unix-seconds expiry.

export const SESSION_COOKIE = "rag_session"
const SESSION_DAYS = 7

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

export type Session = { email: string; exp: number }

export async function createSessionToken(email: string): Promise<string> {
  const payload: Session = { email, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 }
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

/** Reads + verifies the session inside a Node API route (defense in depth beyond middleware). */
export async function getSessionFromRequest(req: Request): Promise<Session | null> {
  const cookieHeader = req.headers.get("cookie") || ""
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  return verifySessionToken(match ? decodeURIComponent(match[1]) : null)
}
