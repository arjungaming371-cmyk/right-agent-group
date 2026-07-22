// Regulatory guardrails for outbound calling — TRAI TCCCPR calling-window
// rules, RBI Fair Practices Code (stricter hours for lending-adjacent
// calls), and a DND/opt-out suppression list.
//
// checkCallCompliance() is the ONE function every outbound-calling code
// path should call before dialing. It combines three checks:
//   1. Lead Brain's do_not_call stage (lib/lead-brain.ts)
//   2. The DND suppression list (dnd_suppression table)
//   3. The configured calling window (compliance_settings table)
//
// IMPORTANT — what this is NOT: a live sync with TRAI's National Customer
// Preference Register (NCPR). Real NCPR access requires registering as a
// Registered Telemarketer (RTM) on a telecom operator's DLT platform — a
// business/legal registration step, not something application code can do
// on its own. dnd_suppression is a list YOU control: numbers added
// manually, CSV-uploaded (e.g. from an NCPR extract once you ARE
// registered), or auto-added whenever a lead's stage becomes do_not_call.
//
// The default calling window (8:00-19:00 IST, Mon-Sat) follows RBI's
// stricter Fair Practices Code hours rather than TRAI's more permissive
// 9:00-21:00 general telemarketing window, since this is a lending
// business — adjust from the dashboard if your specific registration
// (NBFC-linked digital lender vs. pure lead-generation telemarketer) calls
// for a different rule. This is a technical guardrail matching a
// good-faith reading of public guidance, not a legal compliance guarantee
// — verify with your own compliance advisor.

import { query } from "./db"
import { isDoNotCall } from "./lead-brain"

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // India Standard Time, UTC+5:30 — no DST, fixed offset is safe
const DAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

type ComplianceSettings = {
  enabled: boolean
  startHour: number
  endHour: number
  days: Set<string>
}

// Settings rarely change, but a dashboard edit should take effect fast —
// short cache + explicit invalidation from the PATCH route, same shape as
// lib/llm.ts's script cache.
let _cache: ComplianceSettings | null = null
let _cacheTime = 0
const CACHE_TTL = 60 * 1000

async function getSettings(): Promise<ComplianceSettings> {
  const now = Date.now()
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache
  const res = await query(`SELECT key, value FROM compliance_settings`)
  const map: Record<string, string> = {}
  for (const row of res.rows) map[row.key] = row.value
  const settings: ComplianceSettings = {
    enabled: map.calling_window_enabled !== "false",
    startHour: parseInt(map.calling_window_start_hour ?? "8", 10),
    endHour: parseInt(map.calling_window_end_hour ?? "19", 10),
    days: new Set((map.calling_window_days ?? "mon,tue,wed,thu,fri,sat").split(",").map((s) => s.trim().toLowerCase())),
  }
  _cache = settings
  _cacheTime = now
  return settings
}

export function invalidateComplianceCache(): void {
  _cache = null
}

/** Is `at` (defaults to now) within the configured calling window, in IST? */
export async function isWithinCallingWindow(at: Date = new Date()): Promise<boolean> {
  const settings = await getSettings()
  if (!settings.enabled) return true
  const ist = new Date(at.getTime() + IST_OFFSET_MS)
  const day = DAY_CODES[ist.getUTCDay()]
  if (!settings.days.has(day)) return false
  const hour = ist.getUTCHours()
  return hour >= settings.startHour && hour < settings.endHour
}

function last10(phone: string): string {
  return (phone || "").replace(/\D/g, "").slice(-10)
}

export async function isDndSuppressed(phone: string): Promise<boolean> {
  const digits = last10(phone)
  if (digits.length !== 10) return false
  try {
    const res = await query(
      `SELECT 1 FROM dnd_suppression WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1 LIMIT 1`,
      [digits]
    )
    return res.rows.length > 0
  } catch (e: any) {
    console.error("isDndSuppressed check error (failing open — call proceeds):", e.message)
    return false
  }
}

export type ComplianceCode = "do_not_call" | "dnd_suppressed" | "outside_window"
export type ComplianceResult = { allowed: boolean; reason?: string; code?: ComplianceCode }

/**
 * The single gate every outbound-calling route should check before
 * dialing. Same fail-open philosophy as lib/lead-brain.ts's isDoNotCall —
 * a DB error here must never silently disable outbound calling app-wide.
 * `code` is a machine-readable reason (vs. `reason`'s human-readable text)
 * so callers like the bulk dialer can record specifically why an item was
 * skipped without string-matching the message.
 */
export async function checkCallCompliance(opts: { leadId?: string | null; phone: string }): Promise<ComplianceResult> {
  try {
    if (await isDoNotCall({ leadId: opts.leadId, phone: opts.phone })) {
      return { allowed: false, code: "do_not_call", reason: "This lead is marked Do Not Call." }
    }
    if (await isDndSuppressed(opts.phone)) {
      return { allowed: false, code: "dnd_suppressed", reason: "This number is on the DND/opt-out suppression list." }
    }
    if (!(await isWithinCallingWindow())) {
      const settings = await getSettings()
      return {
        allowed: false,
        code: "outside_window",
        reason: `Outside the permitted calling window (${settings.startHour}:00–${settings.endHour}:00 IST, ${Array.from(settings.days).join("/")}). TRAI/RBI restrict outbound telemarketing and collection calls to specific hours.`,
      }
    }
    return { allowed: true }
  } catch (e: any) {
    console.error("checkCallCompliance error (failing open — call proceeds):", e.message)
    return { allowed: true }
  }
}
