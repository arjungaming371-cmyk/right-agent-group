-- Rollback for Banking Research Intelligence Engine (BRIE)
DROP TRIGGER IF EXISTS trg_chunk_search_vector ON knowledge_chunks;
DROP FUNCTION IF EXISTS update_chunk_search_vector();

DROP TABLE IF EXISTS brie_audit_events CASCADE;
DROP TABLE IF EXISTS source_monitoring CASCADE;
DROP TABLE IF EXISTS regulatory_instruments CASCADE;
DROP TABLE IF EXISTS ingestion_runs CASCADE;
DROP TABLE IF EXISTS source_conflicts CASCADE;
DROP TABLE IF EXISTS review_tasks CASCADE;
DROP TABLE IF EXISTS objection_scenarios CASCADE;
DROP TABLE IF EXISTS faq_entries CASCADE;
DROP TABLE IF EXISTS knowledge_chunks CASCADE;
DROP TABLE IF EXISTS fee_items CASCADE;
DROP TABLE IF EXISTS pricing_facts CASCADE;
DROP TABLE IF EXISTS eligibility_rules CASCADE;
DROP TABLE IF EXISTS policy_clauses CASCADE;
DROP TABLE IF EXISTS claim_evidence CASCADE;
DROP TABLE IF EXISTS knowledge_claims CASCADE;
DROP TABLE IF EXISTS document_versions CASCADE;
DROP TABLE IF EXISTS source_documents CASCADE;
DROP TABLE IF EXISTS source_registry CASCADE;
DROP TABLE IF EXISTS institution_products CASCADE;
DROP TABLE IF EXISTS product_families CASCADE;
DROP TABLE IF EXISTS institution_domains CASCADE;
DROP TABLE IF EXISTS institutions CASCADE;
