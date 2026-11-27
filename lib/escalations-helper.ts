/**
 * Helper utilities for Escalations and Human Attention Queue.
 */

export function buildComprehensiveDescription(item: any): string {
  // If rich AI memory summary exists from the autonomous intelligence engine:
  if (item.memory_summary && String(item.memory_summary).trim().length > 25) {
    const mem = String(item.memory_summary).trim()
    if (item.category === "loan_confirmed") {
      return `🟢 LOAN CONFIRMED ON CALL — ${mem}`
    } else if (item.category === "callback") {
      const cbDetails = [
        item.quote ? `Follow-up quote: "${item.quote}".` : (item.notes ? `Notes: ${item.notes}` : ""),
        `Lead Intel: ${mem}`
      ].filter(Boolean).join(" ")
      return `📞 CALLBACK REQUESTED — ${cbDetails}`
    } else if (item.category === "branch_visit" || item.category === "Office Visit") {
      const visitDetails = [
        item.notes || "Customer confirmed in-person office visit.",
        item.location ? `Branch Location: ${item.location}.` : "",
        `Lead Intel: ${mem}`
      ].filter(Boolean).join(" ")
      return `🏢 OFFICE VISIT SCHEDULED — ${visitDetails}`
    }
    return mem
  }

  const parts: string[] = []
  const product = item.product_interest ? String(item.product_interest).toUpperCase() : "LOAN"
  const amount = item.loan_amount ? `₹${Number(item.loan_amount).toLocaleString("en-IN")}` : ""
  const location = item.lead_address || item.city || item.location || ""
  const profile = item.employment_type ? `Occupation/Profile: ${item.employment_type}.` : ""

  if (item.category === "loan_confirmed" || item.category === "Loan Confirmed") {
    parts.push(`🟢 LOAN CONFIRMED ON CALL — Caller confirmed requirement for ${product}${amount ? ` of ${amount}` : ""}${location ? ` in ${location}` : ""}.`)
    if (profile) parts.push(profile)
    if (item.call_duration) {
      const mins = Math.floor(item.call_duration / 60)
      const secs = item.call_duration % 60
      parts.push(`Discussed in detail on a ${mins > 0 ? `${mins}m ` : ""}${secs}s call (${item.call_language || "Telugu"}).`)
    }
    parts.push(`Follow up with customer for KYC, college/income documentation & bank file processing.`)
  } else if (item.category === "callback" || item.category === "Callback") {
    parts.push(`📞 CALLBACK REQUESTED — Follow-up requested for ${product}${amount ? ` (${amount})` : ""}.`)
    if (item.quote) parts.push(`Customer note: "${item.quote}".`)
    if (location) parts.push(`Location: ${location}.`)
  } else if (item.category === "branch_visit" || item.category === "Office Visit") {
    parts.push(`🏢 OFFICE VISIT — In-person appointment requested.`)
    if (item.location) parts.push(`Branch: ${item.location}.`)
    if (item.quote) parts.push(`Notes: "${item.quote}".`)
  } else {
    parts.push(`⚠️ ATTENTION NEEDED — Customer requested human assistance during conversation.`)
    if (item.quote) parts.push(`Statement: "${item.quote}".`)
    if (item.call_duration) parts.push(`Call duration: ${item.call_duration}s.`)
  }

  return parts.join(" ")
}
