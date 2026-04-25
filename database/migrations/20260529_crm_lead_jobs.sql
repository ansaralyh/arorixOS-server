-- CRM: jobs per lead (source of truth for lead sheet Jobs tab; wire API after this exists).

CREATE TABLE IF NOT EXISTS crm_lead_jobs (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in-progress', 'completed', 'on-hold')),
  service_category TEXT NOT NULL DEFAULT '',
  assigned_to TEXT NOT NULL DEFAULT '',
  assigned_employees JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  zip_code TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  linked_estimate_id UUID REFERENCES crm_lead_estimates(id) ON DELETE SET NULL,
  linked_invoice_id UUID REFERENCES crm_lead_invoices(id) ON DELETE SET NULL,
  linked_estimate_number TEXT NOT NULL DEFAULT '',
  linked_invoice_number TEXT NOT NULL DEFAULT '',
  calendar_event_id TEXT NOT NULL DEFAULT '',
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_rate NUMERIC(14,4) NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'dollar')),
  discount_value NUMERIC(14,4) NOT NULL DEFAULT 0,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_jobs_lead
  ON crm_lead_jobs (business_id, lead_id);

DROP TRIGGER IF EXISTS update_crm_lead_jobs_modtime ON crm_lead_jobs;
CREATE TRIGGER update_crm_lead_jobs_modtime
  BEFORE UPDATE ON crm_lead_jobs
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();
