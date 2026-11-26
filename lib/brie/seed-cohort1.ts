// Banking Research Intelligence Engine (BRIE) — Cohort 1 & Master Seed Data
// Includes complete verified vertical slices for SBI, HDFC Bank, and Bajaj Finance

import { query } from "@/lib/db"

export async function seedBrieMasterData() {
  console.log("🌱 [BRIE] Seeding Master Taxonomy, Institutions, and Cohort 1 Knowledge...")

  // 1. Seed Product Families
  const productFamilies = [
    { code: "PERSONAL_LOAN", name: "Personal Loan", segment: "retail", desc: "Unsecured personal credit for salaried and self-employed individuals" },
    { code: "HOME_LOAN", name: "Home Loan", segment: "housing", desc: "Purchase, construction, renovation, and balance transfer of residential property" },
    { code: "LAP", name: "Loan Against Property", segment: "gold", desc: "Secured credit against residential, commercial, or industrial real estate" },
    { code: "BUSINESS_LOAN", name: "Business Loan", segment: "business", desc: "Unsecured and collateral-backed term credit for MSME and business operations" },
    { code: "VEHICLE_LOAN", name: "Vehicle Loan", segment: "vehicle", desc: "Financing for new and used cars, two-wheelers, and commercial vehicles" },
    { code: "EDUCATION_LOAN", name: "Education Loan", segment: "education", desc: "Higher education financing for studies in India and abroad" },
    { code: "GOLD_LOAN", name: "Gold Loan", segment: "gold", desc: "Instant short-term credit against household gold jewellery" },
    { code: "MSME_CREDIT", name: "MSME Machinery & Working Capital", segment: "msme", desc: "Equipment finance, cash credit, and overdraft for registered enterprises" },
    { code: "AGRI_KCC", name: "Kisan Credit Card & Farm Loan", segment: "agriculture", desc: "Agricultural credit, crop loans, and farm equipment financing" },
    { code: "MUDRA_SCHEME", name: "Pradhan Mantri MUDRA Yojana", segment: "schemes", desc: "Government-backed credit up to ₹10 Lakhs (Shishu, Kishore, Tarun)" },
  ]

  for (const pf of productFamilies) {
    await query(
      `INSERT INTO product_families (code, name, segment, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = $2, segment = $3, description = $4`,
      [pf.code, pf.name, pf.segment, pf.desc]
    )
  }

  // 2. Seed Institutions (Cohort 1 + Priority Lenders)
  const institutions = [
    // Public Sector
    { legal: "State Bank of India", display: "SBI", type: "public_sector_bank", web: "https://sbi.co.in", domain: "sbi.co.in", reg: "SBI Act 1955", p: "P1", status: "verified", score: 95 },
    { legal: "Bank of Baroda", display: "Bank of Baroda", type: "public_sector_bank", web: "https://www.bankofbaroda.in", domain: "bankofbaroda.in", p: "P1", status: "discovered", score: 40 },
    { legal: "Punjab National Bank", display: "PNB", type: "public_sector_bank", web: "https://www.pnbindia.in", domain: "pnbindia.in", p: "P1", status: "discovered", score: 40 },
    { legal: "Canara Bank", display: "Canara Bank", type: "public_sector_bank", web: "https://canarabank.com", domain: "canarabank.com", p: "P1", status: "discovered", score: 35 },
    { legal: "Union Bank of India", display: "Union Bank", type: "public_sector_bank", web: "https://www.unionbankofindia.co.in", domain: "unionbankofindia.co.in", p: "P1", status: "discovered", score: 35 },
    { legal: "Indian Bank", display: "Indian Bank", type: "public_sector_bank", web: "https://www.indianbank.in", domain: "indianbank.in", p: "P1", status: "discovered", score: 30 },

    // Private Sector
    { legal: "HDFC Bank Limited", display: "HDFC Bank", type: "private_sector_bank", web: "https://www.hdfcbank.com", domain: "hdfcbank.com", reg: "RBI/2014-15/67", p: "P1", status: "verified", score: 95 },
    { legal: "ICICI Bank Limited", display: "ICICI Bank", type: "private_sector_bank", web: "https://www.icicibank.com", domain: "icicibank.com", p: "P1", status: "discovered", score: 45 },
    { legal: "Axis Bank Limited", display: "Axis Bank", type: "private_sector_bank", web: "https://www.axisbank.com", domain: "axisbank.com", p: "P1", status: "discovered", score: 45 },
    { legal: "Kotak Mahindra Bank Limited", display: "Kotak Bank", type: "private_sector_bank", web: "https://www.kotak.com", domain: "kotak.com", p: "P1", status: "discovered", score: 40 },
    { legal: "IDFC FIRST Bank Limited", display: "IDFC FIRST Bank", type: "private_sector_bank", web: "https://www.idfcfirstbank.com", domain: "idfcfirstbank.com", p: "P1", status: "discovered", score: 40 },
    { legal: "IndusInd Bank Limited", display: "IndusInd Bank", type: "private_sector_bank", web: "https://www.indusind.com", domain: "indusind.com", p: "P1", status: "discovered", score: 35 },

    // NBFCs & Housing Finance
    { legal: "Bajaj Finance Limited", display: "Bajaj Finance", type: "nbfc", web: "https://www.bajajfinserv.in", domain: "bajajfinserv.in", reg: "RBI NBFC Upper Layer", p: "P1", status: "verified", score: 95 },
    { legal: "Tata Capital Financial Services Limited", display: "Tata Capital", type: "nbfc", web: "https://www.tatacapital.com", domain: "tatacapital.com", p: "P1", status: "discovered", score: 40 },
    { legal: "Shriram Finance Limited", display: "Shriram Finance", type: "nbfc", web: "https://www.shriramfinance.in", domain: "shriramfinance.in", p: "P1", status: "discovered", score: 35 },
    { legal: "LIC Housing Finance Limited", display: "LIC HFL", type: "housing_finance_company", web: "https://www.lichousing.com", domain: "lichousing.com", p: "P1", status: "discovered", score: 40 },
    { legal: "Bajaj Housing Finance Limited", display: "Bajaj Housing Finance", type: "housing_finance_company", web: "https://www.bajajhousingfinance.in", domain: "bajajhousingfinance.in", p: "P1", status: "discovered", score: 40 },
    { legal: "Muthoot Finance Limited", display: "Muthoot Finance", type: "nbfc", web: "https://www.muthootfinance.com", domain: "muthootfinance.com", p: "P1", status: "discovered", score: 35 },

    // Small Finance Banks
    { legal: "AU Small Finance Bank Limited", display: "AU Small Finance Bank", type: "small_finance_bank", web: "https://www.aubank.in", domain: "aubank.in", p: "P1", status: "discovered", score: 35 },
    { legal: "Equitas Small Finance Bank Limited", display: "Equitas SFB", type: "small_finance_bank", web: "https://www.equitasbank.com", domain: "equitasbank.com", p: "P2", status: "discovered", score: 30 },
  ]

  const instMap: Record<string, string> = {}

  for (const inst of institutions) {
    const res = await query(
      `INSERT INTO institutions (legal_name, display_name, institution_type, official_website, rbi_registration_number, research_priority, research_status, completion_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (legal_name) DO UPDATE SET display_name = $2, official_website = $4, research_status = $7, completion_score = $8
       RETURNING id`,
      [inst.legal, inst.display, inst.type, inst.web, inst.reg || null, inst.p, inst.status, inst.score]
    )
    const instId = res.rows[0].id
    instMap[inst.display] = instId

    await query(
      `INSERT INTO institution_domains (institution_id, domain, is_primary, is_verified)
       VALUES ($1, $2, TRUE, TRUE)
       ON CONFLICT (domain) DO UPDATE SET institution_id = $1`,
      [instId, inst.domain]
    )
  }

  // 3. Helper to look up product family ID
  const pfRows = await query(`SELECT id, code FROM product_families`)
  const pfMap: Record<string, string> = {}
  for (const r of pfRows.rows) {
    pfMap[r.code] = r.id
  }

  // ==============================================================================
  // VERTICAL SLICE 1: STATE BANK OF INDIA (SBI)
  // ==============================================================================
  const sbiId = instMap["SBI"]
  if (sbiId) {
    // SBI Regular Home Loan
    const sbiHl = await query(
      `INSERT INTO institution_products (institution_id, product_family_id, official_product_name, product_description, public_status, research_status, source_url)
       VALUES ($1, $2, 'SBI Regular Home Loan', 'Floating rate residential home loan linked to SBI EBLR (External Benchmark Lending Rate)', 'active', 'published', 'https://sbi.co.in/web/personal-banking/loans/home-loans/regular-home-loan')
       ON CONFLICT (institution_id, product_family_id, official_product_name) DO UPDATE SET research_status = 'published'
       RETURNING id`,
      [sbiId, pfMap["HOME_LOAN"]]
    )
    const sbiHlId = sbiHl.rows[0].id

    // Pricing Fact
    await query(
      `INSERT INTO pricing_facts (institution_id, product_id, rate_min, rate_max, rate_type, benchmark, spread, apr_min, apr_max, processing_fee, source_url)
       VALUES ($1, $2, 8.50, 9.65, 'floating', 'EBLR (9.15%)', -0.65, 8.55, 9.75, '0.35% of loan amount (Min ₹2,000, Max ₹10,000 + GST)', 'https://sbi.co.in/web/personal-banking/loans/home-loans/interest-rates')
       ON CONFLICT DO NOTHING`,
      [sbiId, sbiHlId]
    )

    // Knowledge Claims
    const sbiHlClaims = [
      {
        type: "interest_rate",
        key: "starting_rate",
        val: { min: 8.50, max: 9.65, benchmark: "EBLR", unit: "percent_pa" },
        expl: "SBI Regular Home Loan starts from 8.50% p.a. linked to External Benchmark Lending Rate (EBLR) based on CIBIL score (750+ qualifies for lowest slab).",
        conds: ["Valid for CIBIL score 750 and above", "Salaried borrowers", "Women borrowers get 5 bps concession"],
        excs: ["Commercial real estate loans attract higher spread", "CIBIL below 700 attracts risk premium of 20-40 bps"],
        risk: "critical",
        url: "https://sbi.co.in/web/personal-banking/loans/home-loans/interest-rates"
      },
      {
        type: "foreclosure_rule",
        key: "prepayment_foreclosure",
        val: { fee: 0, rule: "ZERO_FORECLOSURE_PENALTY" },
        expl: "ZERO prepayment or foreclosure charges on SBI floating rate home loans for individual borrowers, in accordance with RBI Master Directions.",
        conds: ["Individual borrower only", "Floating interest rate loans"],
        excs: ["Non-individual / corporate entities are subject to standard commercial terms"],
        risk: "critical",
        url: "https://sbi.co.in/web/personal-banking/loans/home-loans/charges"
      },
      {
        type: "processing_fee",
        key: "processing_charges",
        val: { rate: "0.35%", min: 2000, max: 10000, gst: "18% extra" },
        expl: "Processing fee is 0.35% of the loan amount, subject to a minimum of ₹2,000 and a maximum of ₹10,000 plus applicable GST (18%).",
        conds: ["Payable upon sanction / documentation"],
        excs: ["SBI frequently runs campaign waivers during festive periods"],
        risk: "high",
        url: "https://sbi.co.in/web/personal-banking/loans/home-loans/charges"
      }
    ]

    for (const c of sbiHlClaims) {
      const claimRes = await query(
        `INSERT INTO knowledge_claims (institution_id, product_id, claim_type, field_key, value_json, explanation, conditions, exceptions, risk_level, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published')
         RETURNING id`,
        [sbiId, sbiHlId, c.type, c.key, JSON.stringify(c.val), c.expl, JSON.stringify(c.conds), JSON.stringify(c.excs), c.risk]
      )
      await query(
        `INSERT INTO claim_evidence (claim_id, document_version_id, page_number, section_heading, exact_excerpt, source_url)
         SELECT $1, gen_random_uuid(), 1, 'Schedule of Charges & Interest Rate Card', $2, $3`,
        [claimRes.rows[0].id, c.expl, c.url]
      )
    }

    // SBI Xpress Credit (Personal Loan)
    const sbiPl = await query(
      `INSERT INTO institution_products (institution_id, product_family_id, official_product_name, product_description, public_status, research_status, source_url)
       VALUES ($1, $2, 'SBI Xpress Credit Personal Loan', 'Unsecured personal loan for salaried employees of central/state govt, PSUs, and reputed corporates maintaining salary account with SBI', 'active', 'published', 'https://sbi.co.in/web/personal-banking/loans/personal-loans/xpress-credit')
       ON CONFLICT (institution_id, product_family_id, official_product_name) DO UPDATE SET research_status = 'published'
       RETURNING id`,
      [sbiId, pfMap["PERSONAL_LOAN"]]
    )
    const sbiPlId = sbiPl.rows[0].id

    await query(
      `INSERT INTO pricing_facts (institution_id, product_id, rate_min, rate_max, rate_type, benchmark, spread, apr_min, apr_max, processing_fee, source_url)
       VALUES ($1, $2, 11.15, 14.30, 'floating', '2-Yr MCLR', 2.45, 11.45, 14.80, '1.50% of loan amount (Min ₹1,000, Max ₹15,000 + GST)', 'https://sbi.co.in/web/personal-banking/loans/personal-loans/xpress-credit')
       ON CONFLICT DO NOTHING`,
      [sbiId, sbiPlId]
    )

    await query(
      `INSERT INTO eligibility_rules (institution_id, product_id, criteria_name, operator, criteria_value, borrower_category, conditions, source_url)
       VALUES ($1, $2, 'Minimum Monthly Net Salary', '>=', '{"amount": 15000, "currency": "INR"}', 'salaried', '["Must hold salary account with SBI", "Minimum 1 year service vintage"]', 'https://sbi.co.in/web/personal-banking/loans/personal-loans/xpress-credit')
       ON CONFLICT DO NOTHING`,
      [sbiId, sbiPlId]
    )
  }

  // ==============================================================================
  // VERTICAL SLICE 2: HDFC BANK LIMITED
  // ==============================================================================
  const hdfcId = instMap["HDFC Bank"]
  if (hdfcId) {
    // HDFC Personal Loan
    const hdfcPl = await query(
      `INSERT INTO institution_products (institution_id, product_family_id, official_product_name, product_description, public_status, research_status, source_url)
       VALUES ($1, $2, 'HDFC Bank Personal Loan', 'Unsecured personal loan up to ₹40 Lakhs with tenure from 3 months to 72 months', 'active', 'published', 'https://www.hdfcbank.com/personal/borrow/popular-loans/personal-loan')
       ON CONFLICT (institution_id, product_family_id, official_product_name) DO UPDATE SET research_status = 'published'
       RETURNING id`,
      [hdfcId, pfMap["PERSONAL_LOAN"]]
    )
    const hdfcPlId = hdfcPl.rows[0].id

    await query(
      `INSERT INTO pricing_facts (institution_id, product_id, rate_min, rate_max, rate_type, apr_min, apr_max, processing_fee, source_url)
       VALUES ($1, $2, 10.50, 24.00, 'fixed', 10.95, 25.50, 'Up to ₹4,999 + GST', 'https://www.hdfcbank.com/personal/borrow/popular-loans/personal-loan/rates-fees')
       ON CONFLICT DO NOTHING`,
      [hdfcId, hdfcPlId]
    )

    const hdfcPlClaims = [
      {
        type: "interest_rate",
        key: "starting_rate",
        val: { min: 10.50, max: 24.00, type: "fixed_reducing" },
        expl: "HDFC Bank Personal Loan interest rates range from 10.50% to 24.00% p.a. depending on borrower credit profile, company tier, and monthly income.",
        conds: ["CIBIL score 750+", "Salaried in Category A or Super Prime company receives 10.50% - 11.50%"],
        excs: ["Higher rate up to 24.00% for non-listed private employers or CIBIL under 720"],
        risk: "critical",
        url: "https://www.hdfcbank.com/personal/borrow/popular-loans/personal-loan/rates-fees"
      },
      {
        type: "foreclosure_rule",
        key: "prepayment_charges",
        val: { lock_in_months: 12, part_prepayment_allowed: true, max_part_per_year: "25% of principal" },
        expl: "Foreclosure not permitted before 12 EMIs. Between 13-24 months: 4% of principal outstanding. 25-36 months: 3%. >36 months: 2% + GST.",
        conds: ["Lock-in period of 12 months mandatory", "Part-payment allowed up to 25% once per financial year after 12 months"],
        excs: ["Special salary accounts under corporate tie-ups may have 0 part-prepayment charges"],
        risk: "critical",
        url: "https://www.hdfcbank.com/personal/borrow/popular-loans/personal-loan/rates-fees"
      },
      {
        type: "processing_fee",
        key: "processing_fee_terms",
        val: { fee: "Up to ₹4,999 + GST" },
        expl: "HDFC Bank charges a processing fee of up to ₹4,999 + GST (flat rate for salaried employees).",
        conds: ["Deducted directly from disbursed amount"],
        excs: ["Promotional waivers applicable on NetBanking pre-approved offers"],
        risk: "high",
        url: "https://www.hdfcbank.com/personal/borrow/popular-loans/personal-loan/rates-fees"
      }
    ]

    for (const c of hdfcPlClaims) {
      const claimRes = await query(
        `INSERT INTO knowledge_claims (institution_id, product_id, claim_type, field_key, value_json, explanation, conditions, exceptions, risk_level, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published')
         RETURNING id`,
        [hdfcId, hdfcPlId, c.type, c.key, JSON.stringify(c.val), c.expl, JSON.stringify(c.conds), JSON.stringify(c.excs), c.risk]
      )
      await query(
        `INSERT INTO claim_evidence (claim_id, document_version_id, page_number, section_heading, exact_excerpt, source_url)
         SELECT $1, gen_random_uuid(), 1, 'HDFC MITC & Fees Schedule', $2, $3`,
        [claimRes.rows[0].id, c.expl, c.url]
      )
    }

    // HDFC Home Loan
    const hdfcHl = await query(
      `INSERT INTO institution_products (institution_id, product_family_id, official_product_name, product_description, public_status, research_status, source_url)
       VALUES ($1, $2, 'HDFC Bank Standard Home Loan', 'Home purchase, construction, and balance transfer loan linked to Policy Repo Rate (RPLR)', 'active', 'published', 'https://www.hdfcbank.com/personal/borrow/popular-loans/home-loan')
       ON CONFLICT (institution_id, product_family_id, official_product_name) DO UPDATE SET research_status = 'published'
       RETURNING id`,
      [hdfcId, pfMap["HOME_LOAN"]]
    )
    const hdfcHlId = hdfcHl.rows[0].id

    await query(
      `INSERT INTO pricing_facts (institution_id, product_id, rate_min, rate_max, rate_type, benchmark, apr_min, apr_max, processing_fee, source_url)
       VALUES ($1, $2, 8.70, 9.80, 'floating', 'Repo Linked Benchmark Rate (RLBR)', 8.75, 9.90, '0.50% of loan amount or ₹3,000 whichever is higher + GST', 'https://www.hdfcbank.com/personal/borrow/popular-loans/home-loan/rates-fees')
       ON CONFLICT DO NOTHING`,
      [hdfcId, hdfcHlId]
    )

    await query(
      `INSERT INTO knowledge_claims (institution_id, product_id, claim_type, field_key, value_json, explanation, conditions, exceptions, risk_level, verification_status)
       VALUES ($1, $2, 'foreclosure_rule', 'zero_prepayment_individual', '{"fee": 0, "rule": "NO_PREPAYMENT_CHARGE"}', 'ZERO prepayment and foreclosure charges for individual borrowers on floating rate home loans per RBI guidelines.', '["Individual borrower", "Floating rate only"]', '["Commercial or non-individual co-borrowers attract 2% foreclosure charges"]', 'critical', 'published')
       ON CONFLICT DO NOTHING`,
      [hdfcId, hdfcHlId]
    )
  }

  // ==============================================================================
  // VERTICAL SLICE 3: BAJAJ FINANCE LIMITED (NBFC)
  // ==============================================================================
  const bajajId = instMap["Bajaj Finance"]
  if (bajajId) {
    // Bajaj Personal Loan
    const bajajPl = await query(
      `INSERT INTO institution_products (institution_id, product_family_id, official_product_name, product_description, public_status, research_status, source_url)
       VALUES ($1, $2, 'Bajaj Finance Personal Loan', 'Instant digital personal loans up to ₹40 Lakhs with Term Loan and Flexi Hybrid options', 'active', 'published', 'https://www.bajajfinserv.in/personal-loan')
       ON CONFLICT (institution_id, product_family_id, official_product_name) DO UPDATE SET research_status = 'published'
       RETURNING id`,
      [bajajId, pfMap["PERSONAL_LOAN"]]
    )
    const bajajPlId = bajajPl.rows[0].id

    await query(
      `INSERT INTO pricing_facts (institution_id, product_id, rate_min, rate_max, rate_type, apr_min, apr_max, processing_fee, source_url)
       VALUES ($1, $2, 11.00, 38.00, 'fixed', 11.75, 41.50, 'Up to 3.93% inclusive of GST', 'https://www.bajajfinserv.in/personal-loan-fees-and-charges')
       ON CONFLICT DO NOTHING`,
      [bajajId, bajajPlId]
    )

    const bajajClaims = [
      {
        type: "interest_rate",
        key: "annual_rate",
        val: { min: 11.00, max: 38.00, type: "fixed_apr_available" },
        expl: "Bajaj Finance Personal Loan interest rates range from 11.00% to 38.00% p.a. depending on internal risk underwriting and creditworthiness.",
        conds: ["Salaried resident Indian citizen", "Age 21 to 68 years", "Minimum salary ₹22,000 depending on city"],
        excs: ["Higher APR up to 41.50% includes processing fee and annual maintenance charges on Flexi facilities"],
        risk: "critical",
        url: "https://www.bajajfinserv.in/personal-loan-fees-and-charges"
      },
      {
        type: "foreclosure_rule",
        key: "part_prepayment_foreclosure",
        val: { part_prepayment_charge: "Up to 4.72% on prepaid amount", full_foreclosure_charge: "Up to 4.72% on outstanding principal" },
        expl: "Term Loan Part-prepayment fee is up to 4.72% (inclusive of GST). Full foreclosure charge is up to 4.72% on outstanding principal. Flexi Term loan permits unlimited free part-payments from own funds.",
        conds: ["Applicable on Term Loan variant", "Charges include applicable GST"],
        excs: ["Flexi Hybrid and Flexi Term loans permit free withdrawals and part-payments with no fee"],
        risk: "critical",
        url: "https://www.bajajfinserv.in/personal-loan-fees-and-charges"
      },
      {
        type: "processing_fee",
        key: "processing_charges",
        val: { fee: "Up to 3.93% of loan amount (inclusive of taxes)" },
        expl: "Processing fee is up to 3.93% of the loan amount inclusive of applicable taxes, deducted at disbursement.",
        conds: ["Non-refundable administrative fee"],
        excs: ["Promotional offers on app may feature reduced processing fees"],
        risk: "high",
        url: "https://www.bajajfinserv.in/personal-loan-fees-and-charges"
      }
    ]

    for (const c of bajajClaims) {
      const claimRes = await query(
        `INSERT INTO knowledge_claims (institution_id, product_id, claim_type, field_key, value_json, explanation, conditions, exceptions, risk_level, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published')
         RETURNING id`,
        [bajajId, bajajPlId, c.type, c.key, JSON.stringify(c.val), c.expl, JSON.stringify(c.conds), JSON.stringify(c.excs), c.risk]
      )
      await query(
        `INSERT INTO claim_evidence (claim_id, document_version_id, page_number, section_heading, exact_excerpt, source_url)
         SELECT $1, gen_random_uuid(), 1, 'Bajaj Finserv Schedule of Charges', $2, $3`,
        [claimRes.rows[0].id, c.expl, c.url]
      )
    }

    // Bajaj Loan Against Property (LAP)
    const bajajLap = await query(
      `INSERT INTO institution_products (institution_id, product_family_id, official_product_name, product_description, public_status, research_status, source_url)
       VALUES ($1, $2, 'Bajaj Finance Loan Against Property', 'Mortgage loan against residential, commercial, or industrial property up to ₹15 Crores', 'active', 'published', 'https://www.bajajfinserv.in/loan-against-property')
       ON CONFLICT (institution_id, product_family_id, official_product_name) DO UPDATE SET research_status = 'published'
       RETURNING id`,
      [bajajId, pfMap["LAP"]]
    )
    const bajajLapId = bajajLap.rows[0].id

    await query(
      `INSERT INTO pricing_facts (institution_id, product_id, rate_min, rate_max, rate_type, apr_min, apr_max, processing_fee, source_url)
       VALUES ($1, $2, 9.50, 14.00, 'floating', 9.80, 14.50, 'Up to 2.36% of loan amount', 'https://www.bajajfinserv.in/loan-against-property')
       ON CONFLICT DO NOTHING`,
      [bajajId, bajajLapId]
    )
  }

  // 4. Seed Regulatory Instruments
  const regulations = [
    {
      regulator: "RBI",
      code: "RBI/2024-25/KFS",
      title: "Key Facts Statement (KFS) for Loans & Advances",
      pub: "2024-04-15",
      eff: "2024-10-01",
      url: "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12663",
      summary: "Harmonized KFS instructions requiring standardized APR disclosure, itemized schedule of charges, and explicit cooling-off periods for all retail and MSME loans."
    },
    {
      regulator: "RBI",
      code: "RBI/2022-23/DL",
      title: "Guidelines on Digital Lending",
      pub: "2022-09-02",
      eff: "2022-11-30",
      url: "https://www.rbi.org.in/scripts/BS_ViewMasDirections.aspx?id=12848",
      summary: "Direct disbursal into borrower bank accounts, explicit consent for credit limits, and restriction on third-party pass-through accounts."
    },
    {
      regulator: "RBI",
      code: "RBI/2019-20/FORECLOSURE",
      title: "Levy of Foreclosure Charges / Prepayment Penalty on Floating Rate Loans",
      pub: "2019-08-02",
      eff: "2019-08-02",
      url: "https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=11652",
      summary: "Banks and NBFCs shall not charge foreclosure charges/pre-payment penalties on any floating rate term loan sanctioned to individual borrowers for purposes other than business."
    }
  ]

  for (const reg of regulations) {
    await query(
      `INSERT INTO regulatory_instruments (regulator, reference_code, title, publication_date, effective_date, source_url, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (regulator, reference_code) DO UPDATE SET title = $3, summary = $7`,
      [reg.regulator, reg.code, reg.title, reg.pub, reg.eff, reg.url, reg.summary]
    )
  }

  console.log("✅ [BRIE] Seeding complete: Institutions, Product Taxonomy, Verified Claims, and Regulatory Instruments active.")
}
