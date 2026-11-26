// Banking Research Intelligence Engine (BRIE) — Document Collector
// Secure, SSRF-safe public document fetcher & content hasher

import crypto from "crypto"

// SSRF Protection: Block private, local, multicast, and loopback IP spaces
const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./, // AWS / Cloud metadata endpoint
  /^0\./,
  /^localhost$/i,
]

export interface SafeFetchResult {
  ok: boolean
  url: string
  status?: number
  contentType?: string
  buffer?: Buffer
  sha256?: string
  error?: string
  sizeBytes?: number
}

/**
 * Validate that a URL is safe to fetch (HTTPS/HTTP only, public domains only, no SSRF)
 */
export function validatePublicUrl(targetUrl: string, allowedDomains?: string[]): { safe: boolean; reason?: string; parsed?: URL } {
  try {
    const parsed = new URL(targetUrl)

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safe: false, reason: "Only HTTP and HTTPS protocols are permitted" }
    }

    const hostname = parsed.hostname.toLowerCase()

    // Check against loopback / private IP patterns
    for (const pattern of PRIVATE_IP_RANGES) {
      if (pattern.test(hostname)) {
        return { safe: false, reason: "Access to local or private network addresses is strictly prohibited (SSRF prevention)" }
      }
    }

    // Optional domain allowlist check
    if (allowedDomains && allowedDomains.length > 0) {
      const match = allowedDomains.some((d) => hostname === d || hostname.endsWith("." + d))
      if (!match) {
        return { safe: false, reason: `Domain ${hostname} is not in the approved institution domain registry` }
      }
    }

    return { safe: true, parsed }
  } catch (e: any) {
    return { safe: false, reason: `Invalid URL format: ${e.message}` }
  }
}

/**
 * Fetch a public banking document or webpage with timeouts, size caps, and SHA-256 hashing
 */
export async function fetchPublicDocument(
  targetUrl: string,
  options?: {
    allowedDomains?: string[]
    maxSizeBytes?: number
    timeoutMs?: number
  }
): Promise<SafeFetchResult> {
  const check = validatePublicUrl(targetUrl, options?.allowedDomains)
  if (!check.safe) {
    return { ok: false, url: targetUrl, error: check.reason }
  }

  const maxBytes = options?.maxSizeBytes || 25 * 1024 * 1024 // 25 MB max limit
  const timeoutMs = options?.timeoutMs || 15000 // 15 second timeout

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BRIE-BankingResearchBot/1.0; +https://rightagentgroup.com/bot)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
      },
      redirect: "follow",
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      return {
        ok: false,
        url: targetUrl,
        status: res.status,
        error: `HTTP error ${res.status}: ${res.statusText}`,
      }
    }

    // Verify redirected URL is still safe
    if (res.url && res.url !== targetUrl) {
      const redirectCheck = validatePublicUrl(res.url, options?.allowedDomains)
      if (!redirectCheck.safe) {
        return { ok: false, url: res.url, error: `Redirect target prohibited: ${redirectCheck.reason}` }
      }
    }

    const arrayBuf = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)

    if (buffer.length > maxBytes) {
      return {
        ok: false,
        url: targetUrl,
        error: `File size (${buffer.length} bytes) exceeds maximum allowable limit (${maxBytes} bytes)`,
      }
    }

    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex")
    const contentType = res.headers.get("content-type") || "application/octet-stream"

    return {
      ok: true,
      url: targetUrl,
      status: res.status,
      contentType,
      buffer,
      sha256,
      sizeBytes: buffer.length,
    }
  } catch (e: any) {
    clearTimeout(timeoutId)
    return {
      ok: false,
      url: targetUrl,
      error: e.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : e.message,
    }
  }
}
