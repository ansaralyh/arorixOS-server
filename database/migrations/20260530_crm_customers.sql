-- CRM: explicit customer rows (one per lead) when a lead becomes a "customer" (see customerStageKeys in crm_config).

CREATE TABLE IF NOT EXISTS crm_customers (
  lead_id UUID PRIMARY KEY REFERENCES crm_leads(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  became_customer_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crm_customers_business ON crm_customers (business_id, became_customer_at DESC);

-- Mark existing “sold” leads as customers (default pipeline’s won column); safe if empty.
INSERT INTO crm_customers (lead_id, business_id)
SELECT l.id, l.business_id
FROM crm_leads l
WHERE l.stage_key = 'sold'
ON CONFLICT (lead_id) DO NOTHING;
