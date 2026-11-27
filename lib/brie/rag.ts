// Banking Research Intelligence Engine (BRIE) — Retrieval-Augmented Generation (RAG)
// Powers AI voice & chat agents with verified, traceable, lender-isolated banking facts.

import { query } from "@/lib/db"
import { BrieQueryRequest, BrieQueryResponse } from "./types"

// Institution detection patterns
const INSTITUTION_PATTERNS: { regex: RegExp; name: string }[] = [
  { regex: /\b(sbi|state bank of india|state bank)\b/i, name: "SBI" },
  { regex: /\b(hdfc|hdfc bank)\b/i, name: "HDFC Bank" },
  { regex: /\b(bajaj|bajaj finance|bajaj finserv)\b/i, name: "Bajaj Finance" },
  { regex: /\b(icici|icici bank)\b/i, name: "ICICI Bank" },
  { regex: /\b(axis|axis bank)\b/i, name: "Axis Bank" },
  { regex: /\b(kotak|kotak mahindra)\b/i, name: "Kotak Bank" },
  { regex: /\b(pnb|punjab national bank)\b/i, name: "PNB" },
  { regex: /\b(bob|bank of baroda)\b/i, name: "Bank of Baroda" },
  { regex: /\b(idfc|idfc first)\b/i, name: "IDFC FIRST Bank" },
  { regex: /\b(indusind|indus ind)\b/i, name: "IndusInd Bank" },
  { regex: /\b(canara|canara bank)\b/i, name: "Canara Bank" },
  { regex: /\b(union bank)\b/i, name: "Union Bank" },
  { regex: /\b(tata capital)\b/i, name: "Tata Capital" },
  { regex: /\b(shriram|shriram finance)\b/i, name: "Shriram Finance" },
  { regex: /\b(lic hfl|lic housing)\b/i, name: "LIC HFL" },
]

// Product topic detection
const TOPIC_PATTERNS: { regex: RegExp; key: string }[] = [
  { regex: /\b(foreclos|prepay|part pay|close early|foreclosure charge|prepayment penalty)\b/i, key: "foreclosure_rule" },
  { regex: /\b(interest rate|rate of interest|starting rate|roi|apr|percentage|eblr|repo rate|mclr)\b/i, key: "interest_rate" },
  { regex: /\b(processing fee|pf|charges|fee schedule|documentation charge|login fee)\b/i, key: "processing_fee" },
  { regex: /\b(eligib|salary|income|cibil|minimum age|vintage)\b/i, key: "eligibility_criteria" },
  { regex: /\b(home loan|housing loan|mortgage|plot loan)\b/i, key: "home_loan" },
  { regex: /\b(personal loan|salaried loan|cash loan)\b/i, key: "personal_loan" },
  { regex: /\b(lap|loan against property)\b/i, key: "lap" },
]

/**
 * Core query function for Banking Research Intelligence
 */
export async function queryBankingKnowledge(req: BrieQueryRequest): Promise<BrieQueryResponse> {
  const q = (req.query || "").trim()

  // 1. Identify Target Institution
  let matchedInstName = req.institution_name || ""
  if (!matchedInstName) {
    for (const pat of INSTITUTION_PATTERNS) {
      if (pat.regex.test(q)) {
        matchedInstName = pat.name
        break
      }
    }
  }

  // 2. Identify Target Product / Claim Topic
  let matchedTopic: string | undefined
  for (const pat of TOPIC_PATTERNS) {
    if (pat.regex.test(q)) {
      matchedTopic = pat.key
      break
    }
  }

  // If no specific lender is identified, return empty / guidance to qualify lender
  if (!matchedInstName && !req.institution_id) {
    return {
      answer_status: "not_found",
      facts: [],
      citations: [],
      summary_for_ai: "No specific bank or lender was identified in the query. For accurate terms, specify the bank (e.g. SBI, HDFC, or Bajaj Finance).",
    }
  }

  try {
    // 3. Fetch Institution Details
    let instRow: any = null
    if (req.institution_id) {
      const res = await query(`SELECT * FROM institutions WHERE id = $1`, [req.institution_id])
      instRow = res.rows[0]
    } else {
      const res = await query(
        `SELECT * FROM institutions WHERE display_name ILIKE $1 OR legal_name ILIKE $1 LIMIT 1`,
        [`%${matchedInstName}%`]
      )
      instRow = res.rows[0]
    }

    if (!instRow) {
      return {
        answer_status: "not_found",
        facts: [],
        citations: [],
        summary_for_ai: `Institution "${matchedInstName}" is not currently in the verified banking research registry.`,
      }
    }

    // 4. Fetch Products for this Institution
    let productQuery = `
      SELECT ip.*, pf.code as family_code, pf.name as family_name, pf.segment
      FROM institution_products ip
      JOIN product_families pf ON ip.product_family_id = pf.id
      WHERE ip.institution_id = $1
    `
    const productParams: any[] = [instRow.id]

    if (matchedTopic === "home_loan") {
      productQuery += ` AND pf.code = 'HOME_LOAN'`
    } else if (matchedTopic === "personal_loan") {
      productQuery += ` AND pf.code = 'PERSONAL_LOAN'`
    } else if (matchedTopic === "lap") {
      productQuery += ` AND pf.code = 'LAP'`
    }

    const prodRes = await query(productQuery, productParams)
    const matchedProduct = prodRes.rows[0] || null

    // 5. Fetch Verified Knowledge Claims with supporting evidence
    let claimsQuery = `
      SELECT kc.*, ce.page_number, ce.section_heading, ce.exact_excerpt, ce.source_url as evidence_url
      FROM knowledge_claims kc
      LEFT JOIN claim_evidence ce ON ce.claim_id = kc.id
      WHERE kc.institution_id = $1
        AND kc.verification_status IN ('published', 'verified')
    `
    const claimsParams: any[] = [instRow.id]

    if (matchedProduct) {
      claimsQuery += ` AND (kc.product_id = $2 OR kc.product_id IS NULL)`
      claimsParams.push(matchedProduct.id)
    }

    if (matchedTopic && ["foreclosure_rule", "interest_rate", "processing_fee", "eligibility_criteria"].includes(matchedTopic)) {
      claimsQuery += ` AND kc.claim_type = $${claimsParams.length + 1}`
      claimsParams.push(matchedTopic)
    }

    claimsQuery += ` ORDER BY kc.created_at DESC LIMIT 6`
    const claimsRes = await query(claimsQuery, claimsParams)

    // 6. Fetch Pricing Facts (Latest effective date first)
    let pricingRow: any = null
    if (matchedProduct) {
      const pRes = await query(
        `SELECT * FROM pricing_facts WHERE institution_id = $1 AND product_id = $2 ORDER BY effective_from DESC NULLS LAST, created_at DESC LIMIT 1`,
        [instRow.id, matchedProduct.id]
      )
      pricingRow = pRes.rows[0]
    }

    // 7. Assemble Structured Citations and Summary
    const facts: any[] = []
    const citations: any[] = []

    for (const row of claimsRes.rows) {
      facts.push({
        key: row.field_key,
        title: row.claim_type.replace(/_/g, " ").toUpperCase(),
        value: row.value_json,
        explanation: row.explanation,
        conditions: row.conditions || [],
        exceptions: row.exceptions || [],
      })

      if (row.exact_excerpt) {
        citations.push({
          title: `${instRow.display_name} — ${row.section_heading || "Official Documentation"}`,
          source_url: row.evidence_url || instRow.official_website,
          page: row.page_number,
          excerpt: row.exact_excerpt,
        })
      }
    }

    // If pricing facts exist but no specific claim matched
    if (pricingRow && facts.length === 0) {
      facts.push({
        key: "pricing_summary",
        title: "INTEREST RATE & CHARGES",
        value: {
          min_rate: pricingRow.rate_min,
          max_rate: pricingRow.rate_max,
          type: pricingRow.rate_type,
          processing_fee: pricingRow.processing_fee,
        },
        explanation: `${instRow.display_name} interest rates for ${matchedProduct?.official_product_name || "this loan"} range from ${pricingRow.rate_min}% to ${pricingRow.rate_max}% p.a. Processing fee: ${pricingRow.processing_fee}.`,
        conditions: ["Subject to applicant credit score and lender approval"],
        exceptions: [],
      })
      if (pricingRow.source_url) {
        citations.push({
          title: `${instRow.display_name} Interest Rate Schedule`,
          source_url: pricingRow.source_url,
        })
      }
    }

    if (facts.length === 0) {
      return {
        answer_status: "not_found",
        institution: {
          id: instRow.id,
          display_name: instRow.display_name,
          legal_name: instRow.legal_name,
          type: instRow.institution_type,
          website: instRow.official_website,
        },
        product: matchedProduct ? { id: matchedProduct.id, name: matchedProduct.official_product_name, segment: matchedProduct.segment } : undefined,
        facts: [],
        citations: [],
        summary_for_ai: `Verified public details for ${instRow.display_name}${matchedProduct ? ` (${matchedProduct.official_product_name})` : ""} are currently being updated in the BRIE repository. Recommend customer verify with the branch schedule directly.`,
      }
    }

    // Construct succinct, conversational summary for Priya
    let summary = `[VERIFIED BANKING FACT — ${instRow.display_name.toUpperCase()}]\n`
    if (matchedProduct) summary += `Product: ${matchedProduct.official_product_name}\n`
    for (const f of facts) {
      summary += `• ${f.title}: ${f.explanation}\n`
      if (f.conditions && f.conditions.length > 0) summary += `  Conditions: ${f.conditions.join("; ")}\n`
      if (f.exceptions && f.exceptions.length > 0) summary += `  Exceptions: ${f.exceptions.join("; ")}\n`
    }
    if (citations.length > 0) {
      summary += `Source Citation: ${citations[0].title} (${citations[0].source_url || "Official Schedule"})`
    }

    return {
      answer_status: "verified",
      institution: {
        id: instRow.id,
        display_name: instRow.display_name,
        legal_name: instRow.legal_name,
        type: instRow.institution_type,
        website: instRow.official_website,
      },
      product: matchedProduct ? { id: matchedProduct.id, name: matchedProduct.official_product_name, segment: matchedProduct.segment } : undefined,
      matched_topic: matchedTopic,
      facts,
      citations,
      summary_for_ai: summary,
      last_verified_at: new Date().toISOString(),
    }
  } catch (e: any) {
    console.error("queryBankingKnowledge error:", e.message)
    return {
      answer_status: "not_found",
      facts: [],
      citations: [],
      summary_for_ai: "Error retrieving verified banking knowledge. Please fall back to standard company loan consultation.",
    }
  }
}
