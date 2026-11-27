// Banking Research Intelligence Engine (BRIE) — Core Types & Schemas

export type InstitutionType =
  | "public_sector_bank"
  | "private_sector_bank"
  | "small_finance_bank"
  | "local_area_bank"
  | "regional_rural_bank"
  | "foreign_bank"
  | "cooperative_bank"
  | "nbfc"
  | "housing_finance_company"
  | "all_india_financial_institution"
  | "payments_bank"
  | "other"

export type RegulatoryStatus = "active" | "cancelled" | "suspended" | "unknown"
export type ResearchPriority = "P1" | "P2" | "P3"
export type ResearchStatus =
  | "not_started"
  | "discovered"
  | "collected"
  | "extracted"
  | "needs_review"
  | "verified"
  | "published"
  | "outdated"

export type ClaimType =
  | "interest_rate"
  | "apr"
  | "processing_fee"
  | "foreclosure_rule"
  | "prepayment_penalty"
  | "eligibility_criteria"
  | "tenure_range"
  | "loan_amount_limit"
  | "documentation_rule"
  | "gst_treatment"
  | "general_rule"

export type VerificationStatus =
  | "pending"
  | "verified"
  | "approved"
  | "published"
  | "rejected"
  | "outdated"
  | "conflict"

export type RiskLevel = "critical" | "high" | "medium" | "low"

export interface Institution {
  id: string
  legal_name: string
  display_name: string
  institution_type: InstitutionType
  regulatory_authority?: string
  rbi_registration_number?: string
  regulatory_status: RegulatoryStatus
  official_website?: string
  country_code: string
  research_priority: ResearchPriority
  research_status: ResearchStatus
  completion_score: number
  source_registry_ref?: string
  last_regulatory_check?: string
  created_at: string
  updated_at: string
}

export interface InstitutionDomain {
  id: string
  institution_id: string
  domain: string
  is_primary: boolean
  is_verified: boolean
  allowed_crawler_status: "allowed" | "restricted" | "blocked"
}

export interface ProductFamily {
  id: string
  code: string
  name: string
  parent_id?: string
  segment: string
  description?: string
}

export interface InstitutionProduct {
  id: string
  institution_id: string
  product_family_id: string
  official_product_name: string
  product_description?: string
  public_status: "active" | "discontinued" | "not_found" | "not_offered_publicly" | "not_researched"
  source_url?: string
  research_status: ResearchStatus
  last_verified_at?: string
  created_at: string
  updated_at: string
}

export interface KnowledgeClaim {
  id: string
  institution_id: string
  product_id?: string
  claim_type: ClaimType
  field_key: string
  value_json: Record<string, any>
  explanation: string
  applicability: Record<string, any>
  conditions: string[]
  exceptions: string[]
  unit?: string
  effective_from?: string
  effective_until?: string
  confidence: number
  risk_level: RiskLevel
  verification_status: VerificationStatus
  citations?: ClaimCitation[]
}

export interface ClaimCitation {
  document_id?: string
  document_version_id?: string
  document_title?: string
  page_number?: number
  section_heading?: string
  exact_excerpt: string
  source_url?: string
}

export interface PolicyClause {
  id: string
  institution_id: string
  product_id?: string
  clause_type: string
  legal_text: string
  plain_explanation: string
  borrower_type: string
  conditions: string[]
  exceptions: string[]
  document_version_id?: string
  page_number?: number
  source_url?: string
}

export interface PricingFact {
  id: string
  institution_id: string
  product_id: string
  rate_min?: number
  rate_max?: number
  rate_type: "floating" | "fixed" | "hybrid"
  benchmark?: string
  spread?: number
  apr_min?: number
  apr_max?: number
  processing_fee?: string
  effective_from?: string
  effective_until?: string
  verification_status: string
  source_url?: string
}

export interface FeeItem {
  id: string
  institution_id: string
  product_id?: string
  fee_name: string
  calculation_basis: string
  amount_or_percent: string
  gst_applicable: boolean
  conditions: string[]
  exceptions: string[]
}

export interface BrieQueryRequest {
  query: string
  institution_id?: string
  institution_name?: string
  product_id?: string
  product_name?: string
  language?: string
  as_of_date?: string
}

export interface BrieQueryResponse {
  answer_status: "verified" | "review" | "conflict" | "not_found" | "restricted" | "outdated"
  institution?: {
    id: string
    display_name: string
    legal_name: string
    type: InstitutionType
    website?: string
  }
  product?: {
    id: string
    name: string
    segment: string
  }
  matched_topic?: string
  facts: {
    key: string
    title: string
    value: any
    explanation: string
    conditions: string[]
    exceptions: string[]
  }[]
  clauses?: {
    clause_type: string
    plain_explanation: string
    legal_text: string
    exceptions: string[]
  }[]
  citations: {
    title: string
    source_url?: string
    page?: number
    excerpt?: string
  }[]
  summary_for_ai: string
  last_verified_at?: string
}
