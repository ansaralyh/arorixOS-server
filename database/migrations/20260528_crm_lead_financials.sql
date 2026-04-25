-- CRM: estimates & invoices per lead (server source of truth for lead sheet Money tabs).

CREATE TABLE IF NOT EXISTS crm_lead_estimates (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  estimate_number TEXT NOT NULL,
  numeric_sequence INT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  service_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'approved', 'declined', 'expired', 'converted')),
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_rate NUMERIC(14,4) NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'dollar')),
  discount_value NUMERIC(14,4) NOT NULL DEFAULT 0,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_lead_estimates_business_num
  ON crm_lead_estimates (business_id, estimate_number);
CREATE INDEX IF NOT EXISTS idx_crm_lead_estimates_lead
  ON crm_lead_estimates (business_id, lead_id);

CREATE TABLE IF NOT EXISTS crm_lead_invoices (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  estimate_id UUID REFERENCES crm_lead_estimates(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  numeric_sequence INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid', 'overdue')),
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'dollar')),
  discount_value NUMERIC(14,4) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(14,4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  issue_date TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_lead_invoices_business_num
  ON crm_lead_invoices (business_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_crm_lead_invoices_lead
  ON crm_lead_invoices (business_id, lead_id);

DROP TRIGGER IF EXISTS update_crm_lead_estimates_modtime ON crm_lead_estimates;
CREATE TRIGGER update_crm_lead_estimates_modtime
  BEFORE UPDATE ON crm_lead_estimates
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_crm_lead_invoices_modtime ON crm_lead_invoices;
CREATE TRIGGER update_crm_lead_invoices_modtime
  BEFORE UPDATE ON crm_lead_invoices
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();
