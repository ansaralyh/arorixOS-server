-- Per-lead file attachments (binary in DB; max size enforced in application).

CREATE TABLE IF NOT EXISTS crm_lead_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL,
  folder TEXT NOT NULL DEFAULT 'other',
  tags TEXT[] NOT NULL DEFAULT '{}',
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_files_lead ON crm_lead_files (business_id, lead_id, created_at DESC);
