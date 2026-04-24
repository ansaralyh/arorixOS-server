-- Phase 1: persist EIN, formation dates, compliance label on businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ein VARCHAR(50);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS formation_date DATE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS annual_report_due DATE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS compliance_status VARCHAR(100);
