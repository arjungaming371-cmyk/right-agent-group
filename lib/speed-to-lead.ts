// SPEED-TO-LEAD (Outpero's headline feature): the moment a NEW lead lands —
// website form, CSV upload, WhatsApp capture, an operator typing it in —
// Priya dials them, while they are still holding their phone. Outpero
// promises "calls every new lead in under 30 seconds"; this dials in the
// same request that created the lead, i.e. in seconds.
//
// Guards (a machine dialing a human is serious money and real reach):
//   1. Settings kill-switch — dialer_settings.speed_to_lead (dashboard
//      toggle, default ON per operator request; flip to false to restore
//      manual-only dialing).
//   2. THE SAME compliance gate every other dial passes — DND list,
//      Lead-Brain do_not_call stage, TRAI/RBI calling window. Outside the
//      window the lead is QUEUED for the window open instead of dialed.
//   3. Double-dial guard (assertNoActiveDial) — never rings a number that
//      is already ringing.
//   4. One attempt, no retry here — the normal auto-retry matrix owns
//      follow-ups on missed calls.
//   5. Fire-and-forget from the caller's perspective: lead creation NEVER
//      waits on (or fails because of) the dialer.
//
// Channel: dialer_settings.speed_to_lead_channel = "phone" | "whatsapp_voice"
// | "auto" (default "auto": WhatsApp when the lead can be called there, else
// the phone line — the same dual-channel logic the queue's "auto" uses).

import { db, query } from "@/lib/db"
import { normalizePhone } from "@/lib/phone"
import { checkCallCompliance, getCallingWindow, isWithinCallingWindow } from "@/lib/compliance"
import { getDialerSettings } from "@/lib/dialer-settings"
import { nextWindowStartMs } from "@/lib/dialer-logic"
import { assertNoActiveDial, placeOutboundCall, DialError } from "@/lib/outbound-dial"

export type SpeedToLeadLead = {
  id?: string | null
  phone: string
  name?: string | null
  language?: string | null
  branch_id?: string | null
  notes?: string | null
  product_interest?: string | null
  source?: string | null
}

async function triggerEnabled(): Promise<boolean> {
  try {
    const settings = await getDialerSettings()
    return settings.speedToLead !== false
  } catch {
    return false // settings unavailable → never auto-dial on a guess
  }
}

/**
 * Called fire-and-forget AFTER a new lead row exists. Never throws.
 * Returns a short outcome string for the audit log.
 */
export async function speedToLeadDial(lead: SpeedToLeadLead): Promise<string> {
  try {
    if (!(await triggerEnabled())) return "disabled"
    const phone = normalizePhone(lead.phone)
    if (!phone || !lead.id) return "no_phone_or_id"

    const settings = await getDialerSettings()
    // dialer_settings speaks queue vocabulary ("whatsapp_voice"); the dialer
    // chokepoint speaks RequestedChannel ("whatsapp") — translate here.
    const requested: "phone" | "whatsapp" | "auto" =
      settings.speedToLeadChannel === "phone" ? "phone"
      : settings.speedToLeadChannel === "whatsapp_voice" ? "whatsapp"
      : "auto"

    // One live attempt per lead: a number already ringing (or just dialed)
    // must not be double-rung.
    try {
      await assertNoActiveDial(phone)
    } catch {
      return "already_active"
    }

    // Compliance gate — the exact call /api/calls/dial and the bulk dialer
    // use. Outside the window we do NOT drop the lead on the floor: the row
    // goes into the queue scheduled for the window open (same contract as
    // the runner's auto-pause).
    const compliance = await checkCallCompliance({ leadId: lead.id, phone })
    if (!compliance.allowed) {
      if (compliance.code === "outside_window") {
        const window = await getCallingWindow()
        const openAt = new Date(nextWindowStartMs(Date.now(), window.startHour, window.days))
        await db.from("outbound_queue").insert({
          lead_id: lead.id,
          phone,
          name: lead.name || null,
          language: lead.language || "telugu",
          channel: requested,
          branch_id: lead.branch_id || null,
          status: "pending",
          priority: 5,
          scheduled_at: openAt.toISOString(),
          talking_points: lead.notes ? String(lead.notes).slice(0, 1000) : null,
        }).catch(() => {})
        return "queued_for_window"
      }
      return `compliance_${compliance.code || "blocked"}`
    }

    // Track the attempt on the queue like every other dial (outcome radar,
    // retry matrix and the Call Queue view all key off this row). priority 5
    // puts a speed-to-lead redial ahead of any bulk-campaign backlog.
    const { data: row } = await db.from("outbound_queue").insert({
      lead_id: lead.id,
      phone,
      name: lead.name || null,
      language: lead.language || "telugu",
      channel: requested,
      branch_id: lead.branch_id || null,
      status: "dialing",
      priority: 5,
      scheduled_at: new Date().toISOString(),
      talking_points: lead.notes ? String(lead.notes).slice(0, 1000) : null,
    }).select().single()

    try {
      const placed = await placeOutboundCall({
        phone,
        leadId: lead.id,
        language: lead.language || "telugu",
        requested,
        branchId: lead.branch_id || null,
        instructions: lead.notes ? String(lead.notes).slice(0, 1000) : null,
      })
      if (row?.id) {
        await db.from("outbound_queue")
          .update({ status: "called", call_sid: placed.callSid, called_at: new Date().toISOString() })
          .eq("id", row.id)
          .catch(() => {})
      }
      console.log(`⚡ speed-to-lead: lead=${lead.id} dialed via ${placed.channel} (callSid=${placed.callSid})`)
      return `dialed_${placed.channel}`
    } catch (e) {
      const detail = e instanceof DialError ? e.message : e instanceof Error ? e.message : "dial error"
      if (row?.id) {
        await db.from("outbound_queue")
          .update({ status: "failed", outcome_detail: detail.slice(0, 300) })
          .eq("id", row.id)
          .catch(() => {})
      }
      console.error(`⚡ speed-to-lead: lead=${lead.id} dial failed: ${detail}`)
      return "dial_failed"
    }
  } catch (e) {
    console.error("speed-to-lead error:", e instanceof Error ? e.message : e)
    return "error"
  }
}

/** Fire-and-forget wrapper for route handlers — never blocks, never throws. */
export function maybeSpeedToLead(lead: SpeedToLeadLead): void {
  void speedToLeadDial(lead)
}
