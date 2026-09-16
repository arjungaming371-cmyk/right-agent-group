// Lead scoring — deterministic, not LLM-based on purpose.
//
// Runs synchronously at every point a lead's signal changes (call ends,
// WhatsApp reply sent) so the Leads table always sorts hottest-first
// without an extra AI call per page load. 0-100, clamped.

import { db } from "./db"

export type ScoringInputs = {
  interested: string | null       // 'interested' | 'not_interested' | 'unknown'
  loan_amount: number | null
  call_count: number | null
  whatsapp_number: string | null
  last_called_at: string | Date | null
  updated_at: string | Date | null
  sentiment: string | null        // most recent call/message sentiment, if known
}

function daysSince(d: string | Date | null): number | null {
  if (!d) return null
  return (Date.now() - new Date(d).getTime()) / 86_400_000
}

export function computeScore(lead: ScoringInputs): number {
  let score = 20 // baseline for existing as a lead at all

  if (lead.interested === "interested") score += 30
  else if (lead.interested === "not_interested") score -= 30

  if (lead.sentiment === "Positive") score += 20
  else if (lead.sentiment === "Negative") score -= 15

  const amt = Number(lead.loan_amount) || 0
  if (amt >= 2_500_000) score += 15
  else if (amt >= 1_000_000) score += 10
  else if (amt > 0) score += 5

  const calls = Number(lead.call_count) || 0
  score += Math.min(calls * 5, 20)

  if (lead.whatsapp_number) score += 10

  const recency = daysSince(lead.last_called_at) ?? daysSince(lead.updated_at)
  if (recency !== null && recency <= 3) score += 10

  return Math.max(0, Math.min(100, Math.round(score)))
}

/** Recompute and persist a single lead's score. Fire-and-forget safe — never throws into the caller. */
export async function refreshLeadScore(leadId: string, sentiment: string | null = null): Promise<void> {
  if (!leadId) return
  try {
    const { data: lead } = await db
      .from("leads")
      .select("interested, loan_amount, call_count, whatsapp_number, last_called_at, updated_at")
      .eq("id", leadId)
      .single()
    if (!lead) return
    const score = computeScore({ ...lead, sentiment })
    await db.from("leads").update({ score }).eq("id", leadId)
  } catch (e: any) {
    console.error("refreshLeadScore error:", e.message)
  }
}
