-- Versioned JSON snapshot of CRM Settings UI state per business (Phase 4).
-- crm_config shape aligns with arorixOS CrmSettingsState; schema_version for forward-compatible reads.

CREATE TABLE IF NOT EXISTS business_crm_settings (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  schema_version SMALLINT NOT NULL DEFAULT 1,
  crm_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_crm_settings_updated_at ON business_crm_settings (updated_at);

DROP TRIGGER IF EXISTS update_business_crm_settings_modtime ON business_crm_settings;
CREATE TRIGGER update_business_crm_settings_modtime
  BEFORE UPDATE ON business_crm_settings
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();
