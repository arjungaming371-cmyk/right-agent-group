-- ==============================================================================
-- BANKING RESEARCH INTELLIGENCE ENGINE (BRIE) — RELATIONAL FOUNDATION
-- Migration: 2026-11-27_banking_research_intelligence.sql
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Financial Institutions Registry
CREATE TABLE IF NOT EXISTS institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    institution_type TEXT NOT NULL CHECK (
        institution_type IN (
            'public_sector_bank',
            'private_sector_bank',
            'small_finance_bank',
            'local_area_bank',
            'regional_rural_bank',
            'foreign_bank',
            'cooperative_bank',
            'nbfc',
            'housing_finance_company',
            'all_india_financial_institution',
            'payments_bank',
            'other'
        )
    ),
    regulatory_authority TEXT DEFAULT 'RBI',
    rbi_registration_number TEXT,
    regulatory_status TEXT NOT NULL DEFAULT 'active' CHECK (regulatory_status IN ('active', 'cancelled', 'suspended', 'unknown')),
    official_website TEXT,
    country_code CHAR(2) DEFAULT 'IN',
    research_priority TEXT NOT NULL DEFAULT 'P1' CHECK (research_priority IN ('P1', 'P2', 'P3')),
    research_status TEXT NOT NULL DEFAULT 'not_started' CHECK (
        research_status IN ('not_started', 'discovered', 'collected', 'extracted', 'needs_review', 'verified', 'published')
    ),
    completion_score INTEGER DEFAULT 0,
    source_registry_ref TEXT,
    last_regulatory_check TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (legal_name)
);

-- Institution Domains Allowlist & Verification
CREATE TABLE IF NOT EXISTS institution_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT TRUE,
    allowed_crawler_status TEXT DEFAULT 'allowed' CHECK (allowed_crawler_status IN ('allowed', 'restricted', 'blocked')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (domain)
);

-- 2. Master Product Taxonomy
CREATE TABLE IF NOT EXISTS product_families (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    parent_id UUID REFERENCES product_families(id) ON DELETE SET NULL,
    segment TEXT NOT NULL CHECK (segment IN ('retail', 'housing', 'vehicle', 'education', 'business', 'msme', 'gold', 'agriculture', 'microfinance', 'corporate', 'specialist', 'schemes')),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Institution Products
CREATE TABLE IF NOT EXISTS institution_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    product_family_id UUID NOT NULL REFERENCES product_families(id) ON DELETE CASCADE,
    official_product_name TEXT NOT NULL,
    product_description TEXT,
    public_status TEXT NOT NULL DEFAULT 'active' CHECK (public_status IN ('active', 'discontinued', 'not_found', 'not_offered_publicly', 'not_researched')),
    source_url TEXT,
    research_status TEXT NOT NULL DEFAULT 'not_started' CHECK (
        research_status IN ('not_started', 'discovered', 'collected', 'extracted', 'needs_review', 'verified', 'published', 'outdated')
    ),
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(institution_id, product_family_id, official_product_name)
);

-- 3. Official Source Registry
CREATE TABLE IF NOT EXISTS source_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    canonical_url TEXT,
    source_type TEXT NOT NULL CHECK (source_type IN ('rbi_direction', 'kfs_document', 'mitc_terms', 'schedule_of_charges', 'interest_rate_page', 'brochure', 'loan_agreement', 'faq', 'other')),
    authority_level TEXT NOT NULL DEFAULT 'lender_primary' CHECK (authority_level IN ('regulatory_primary', 'lender_primary', 'standardized_kfs', 'secondary_reference')),
    allowed_domain TEXT NOT NULL,
    crawl_enabled BOOLEAN DEFAULT TRUE,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_url)
);

-- 4. Immutable Source Documents & Versions
CREATE TABLE IF NOT EXISTS source_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
    institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
    product_id UUID REFERENCES institution_products(id) ON DELETE SET NULL,
    document_title TEXT NOT NULL,
    document_type TEXT NOT NULL,
    language_code TEXT DEFAULT 'en',
    content_type TEXT DEFAULT 'application/pdf',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    storage_uri TEXT NOT NULL,
    published_at TIMESTAMPTZ,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_from DATE,
    effective_until DATE,
    superseded_at TIMESTAMPTZ,
    page_count INTEGER DEFAULT 1,
    extraction_status TEXT DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'extracted', 'partial', 'failed')),
    approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'superseded')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, version_number),
    UNIQUE(document_id, sha256)
);

-- 5. Structured Knowledge Claims
CREATE TABLE IF NOT EXISTS knowledge_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    product_id UUID REFERENCES institution_products(id) ON DELETE CASCADE,
    claim_type TEXT NOT NULL CHECK (claim_type IN ('interest_rate', 'apr', 'processing_fee', 'foreclosure_rule', 'prepayment_penalty', 'eligibility_criteria', 'tenure_range', 'loan_amount_limit', 'documentation_rule', 'gst_treatment', 'general_rule')),
    field_key TEXT NOT NULL,
    value_json JSONB NOT NULL,
    explanation TEXT NOT NULL,
    applicability JSONB DEFAULT '{}',
    conditions JSONB DEFAULT '[]',
    exceptions JSONB DEFAULT '[]',
    unit TEXT,
    effective_from DATE,
    effective_until DATE,
    confidence NUMERIC(5,4) DEFAULT 1.0,
    risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('critical', 'high', 'medium', 'low')),
    verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'approved', 'published', 'rejected', 'outdated', 'conflict')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Exact Supporting Evidence Linking
CREATE TABLE IF NOT EXISTS claim_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL REFERENCES knowledge_claims(id) ON DELETE CASCADE,
    document_version_id UUID NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
    page_number INTEGER,
    section_heading TEXT,
    exact_excerpt TEXT NOT NULL,
    evidence_type TEXT NOT NULL DEFAULT 'clause_quote',
    source_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Policy Clauses & Legal Language Preservation
CREATE TABLE IF NOT EXISTS policy_clauses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    product_id UUID REFERENCES institution_products(id) ON DELETE CASCADE,
    clause_type TEXT NOT NULL,
    legal_text TEXT NOT NULL,
    plain_explanation TEXT NOT NULL,
    borrower_type TEXT DEFAULT 'all',
    conditions JSONB DEFAULT '[]',
    exceptions JSONB DEFAULT '[]',
    document_version_id UUID REFERENCES document_versions(id) ON DELETE SET NULL,
    page_number INTEGER,
    source_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Eligibility Rules & Parameter Thresholds
CREATE TABLE IF NOT EXISTS eligibility_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES institution_products(id) ON DELETE CASCADE,
    criteria_name TEXT NOT NULL,
    operator TEXT NOT NULL DEFAULT '>=',
    criteria_value JSONB NOT NULL,
    borrower_category TEXT DEFAULT 'all',
    conditions JSONB DEFAULT '[]',
    source_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Pricing Facts (Rates, Spreads, Benchmarks, APR)
CREATE TABLE IF NOT EXISTS pricing_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES institution_products(id) ON DELETE CASCADE,
    rate_min NUMERIC(6,2),
    rate_max NUMERIC(6,2),
    rate_type TEXT DEFAULT 'floating' CHECK (rate_type IN ('floating', 'fixed', 'hybrid')),
    benchmark TEXT,
    spread NUMERIC(6,2),
    apr_min NUMERIC(6,2),
    apr_max NUMERIC(6,2),
    processing_fee TEXT,
    effective_from DATE,
    effective_until DATE,
    verification_status TEXT DEFAULT 'verified',
    source_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Fee Items & Schedule of Charges
CREATE TABLE IF NOT EXISTS fee_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    product_id UUID REFERENCES institution_products(id) ON DELETE CASCADE,
    fee_name TEXT NOT NULL,
    calculation_basis TEXT NOT NULL,
    amount_or_percent TEXT NOT NULL,
    gst_applicable BOOLEAN DEFAULT TRUE,
    conditions JSONB DEFAULT '[]',
    exceptions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Searchable Document Chunks (Hybrid FTS + Embeddings)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_version_id UUID NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    product_id UUID REFERENCES institution_products(id) ON DELETE SET NULL,
    page_start INTEGER,
    page_end INTEGER,
    section_path TEXT,
    chunk_text TEXT NOT NULL,
    chunk_hash TEXT NOT NULL,
    approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    metadata JSONB DEFAULT '{}',
    search_vector tsvector,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_version_id, chunk_hash)
);

-- 12. FAQ Entries & Objection Scenarios
CREATE TABLE IF NOT EXISTS faq_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    product_id UUID REFERENCES institution_products(id) ON DELETE SET NULL,
    question TEXT NOT NULL,
    question_variations JSONB DEFAULT '[]',
    approved_answer TEXT NOT NULL,
    intent TEXT NOT NULL,
    conditions JSONB DEFAULT '[]',
    evidence_refs JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS objection_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
    product_id UUID REFERENCES institution_products(id) ON DELETE SET NULL,
    objection_type TEXT NOT NULL,
    customer_utterance_patterns JSONB DEFAULT '[]',
    recommended_strategy TEXT NOT NULL,
    approved_response TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Review & Verification Workflow
CREATE TABLE IF NOT EXISTS review_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID REFERENCES knowledge_claims(id) ON DELETE CASCADE,
    document_version_id UUID REFERENCES document_versions(id) ON DELETE CASCADE,
    task_type TEXT NOT NULL CHECK (task_type IN ('verify_rate', 'verify_fee', 'verify_foreclosure', 'resolve_conflict', 'annual_refresh')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'rejected')),
    assigned_to TEXT,
    reviewed_by TEXT,
    review_notes TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Conflicts & Ingestion Runs
CREATE TABLE IF NOT EXISTS source_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_a UUID NOT NULL REFERENCES knowledge_claims(id) ON DELETE CASCADE,
    claim_b UUID NOT NULL REFERENCES knowledge_claims(id) ON DELETE CASCADE,
    conflict_reason TEXT NOT NULL,
    resolution_status TEXT NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open', 'resolved', 'ignored')),
    resolution_notes TEXT,
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES source_registry(id) ON DELETE SET NULL,
    run_type TEXT NOT NULL CHECK (run_type IN ('discovery', 'crawl', 'extract', 'verify')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    discovered_count INTEGER DEFAULT 0,
    downloaded_count INTEGER DEFAULT 0,
    extracted_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_summary TEXT,
    metadata JSONB DEFAULT '{}'
);

-- 15. Regulatory Instruments & Source Monitoring
CREATE TABLE IF NOT EXISTS regulatory_instruments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    regulator TEXT NOT NULL DEFAULT 'RBI' CHECK (regulator IN ('RBI', 'TRAI', 'GOI', 'NHB', 'NABARD')),
    title TEXT NOT NULL,
    reference_code TEXT NOT NULL,
    applicability JSONB DEFAULT '[]',
    publication_date DATE,
    effective_date DATE,
    source_url TEXT,
    summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(regulator, reference_code)
);

CREATE TABLE IF NOT EXISTS source_monitoring (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
    frequency_hours INTEGER DEFAULT 24,
    last_checked_at TIMESTAMPTZ,
    last_etag TEXT,
    last_content_hash TEXT,
    status TEXT DEFAULT 'healthy' CHECK (status IN ('healthy', 'changed', 'broken', 'restricted')),
    change_detected BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. BRIE Audit Events
CREATE TABLE IF NOT EXISTS brie_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    previous_state JSONB,
    new_state JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_institutions_type ON institutions(institution_type);
CREATE INDEX IF NOT EXISTS idx_institutions_status ON institutions(regulatory_status);
CREATE INDEX IF NOT EXISTS idx_products_institution ON institution_products(institution_id);
CREATE INDEX IF NOT EXISTS idx_products_family ON institution_products(product_family_id);
CREATE INDEX IF NOT EXISTS idx_claims_product ON knowledge_claims(product_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON knowledge_claims(verification_status);
CREATE INDEX IF NOT EXISTS idx_claims_type ON knowledge_claims(claim_type);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON document_versions(sha256);
CREATE INDEX IF NOT EXISTS idx_chunks_inst_prod ON knowledge_chunks(institution_id, product_id);
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON knowledge_chunks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_review_status ON review_tasks(status, priority);
CREATE INDEX IF NOT EXISTS idx_ingestion_status ON ingestion_runs(status);

-- Trigger to maintain search_vector on knowledge_chunks
CREATE OR REPLACE FUNCTION update_chunk_search_vector() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := to_tsvector('english', COALESCE(NEW.chunk_text, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chunk_search_vector ON knowledge_chunks;
CREATE TRIGGER trg_chunk_search_vector
BEFORE INSERT OR UPDATE OF chunk_text ON knowledge_chunks
FOR EACH ROW EXECUTE FUNCTION update_chunk_search_vector();
