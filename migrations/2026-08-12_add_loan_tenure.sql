-- Migration: Add loan_tenure to loan_applications and leads
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS loan_tenure INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS loan_tenure INTEGER;
