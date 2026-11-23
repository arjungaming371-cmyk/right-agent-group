DELETE FROM knowledge_base WHERE title IN (
  'Education loan interest rates and banking partners',
  'Business loan interest rates and banking partners',
  'Personal loan interest rates and banking partners',
  'Vehicle loan interest rates for four wheeler and two wheeler'
);

INSERT INTO knowledge_base (title, category, content, is_active, source_type)
VALUES 
('Education loan interest rates and banking partners', 'Loans', 'Education loan interest rates start from 7.15% per annum with State Bank of India (SBI) and top partner banks. We arrange education loans for higher studies in India and abroad (USA, UK, Canada, Australia, Europe). Loan tenure is up to 15 years with flexible repayment and moratorium during course period plus 6 to 12 months. Covers tuition fees, living expenses, travel, and books. Collateral-free options available based on student academic merit and co-applicant profile. Quick approvals with partner banks.', true, 'manual'),
('Business loan interest rates and banking partners', 'Loans', 'Business loan interest rates start from 9.0% per annum with public sector banks and leading NBFC partners in Hyderabad. Unsecured collateral-free business loans available up to ₹75 Lakhs for business expansion, working capital, inventory purchase, and machinery. Fast approval with minimal documentation: last 2-3 years ITR, 6 months bank statement, and business registration proof. Repayment tenures up to 7 years with affordable EMIs.', true, 'manual'),
('Personal loan interest rates and banking partners', 'Loans', 'Personal loan interest rates start from 9.99% per annum with HDFC Bank, ICICI Bank, and leading lending partners. Available for salaried and self-employed individuals for medical emergencies, weddings, debt consolidation, and home renovation. Fast digital approval within 24 to 48 hours with minimal documents (PAN, Aadhaar, 3 months payslips, 6 months bank statement). Tenures from 1 to 5 years.', true, 'manual'),
('Vehicle loan interest rates for four wheeler and two wheeler', 'Loans', 'Vehicle loan interest rates start from 7.30% per annum for Four Wheeler (Car Loans) with SBI and leading banks with tenure up to 7 years. Two Wheeler (Bike Loans) start from 7.60% per annum with tenure up to 4 years. Quick processing, up to 90-100% on-road funding on eligible profiles, and instant pre-approvals for new and pre-owned vehicles.', true, 'manual');
