// PROVIDER HEALTH — a tiny in-memory ledger of how external providers are
// behaving, so System Health can show "last failure / last success" instead
// of just a green dot. Single-process by design (pm2 fork mode = one Node
// process); a restart clears it, which is honest: it reflects what THIS
// process has seen.
//
// Never store secrets or full request bodies — provider name, ok/fail,
// a short error string, latency.

export type ProviderHealthEntry = {
  lastOkAt: string | null
  lastFailAt: string | null
  lastError: string | null
  consecutiveFails: number
  totalOk: number
  totalFail: number
}

const REGISTRY = new Map<string, ProviderHealthEntry>()

function blank(): ProviderHealthEntry {
  return { lastOkAt: null, lastFailAt: null, lastError: null, consecutiveFails: 0, totalOk: 0, totalFail: 0 }
}

export function recordProviderHealth(provider: string, ok: boolean, error?: string | null, latencyMs?: number): void {
  const entry = REGISTRY.get(provider) || blank()
  const now = new Date().toISOString()
  if (ok) {
    entry.lastOkAt = now
    entry.consecutiveFails = 0
    entry.totalOk += 1
  } else {
    entry.lastFailAt = now
    entry.consecutiveFails += 1
    entry.totalFail += 1
    const detail = error ? String(error).slice(0, 200) : "unknown error"
    const ms = typeof latencyMs === "number" ? ` (${Math.round(latencyMs)}ms)` : ""
    entry.lastError = `${detail}${ms}`
  }
  REGISTRY.set(provider, entry)
}

export function getProviderHealth(): Record<string, ProviderHealthEntry> {
  const out: Record<string, ProviderHealthEntry> = {}
  for (const [k, v] of REGISTRY.entries()) out[k] = { ...v }
  return out
}
