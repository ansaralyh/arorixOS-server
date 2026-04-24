-- Idempotent migration: business terminology stored per tenant
-- Run against existing DBs that already have businesses.*

CREATE TABLE IF NOT EXISTS business_mode_settings (
    business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    mode VARCHAR(32) NOT NULL DEFAULT 'contractor'
        CHECK (mode IN ('contractor', 'agency', 'personal_brand', 'real_estate', 'custom')),
    custom_labels JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(custom_labels) = 'object'),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_mode_settings_mode ON business_mode_settings(mode);

DROP TRIGGER IF EXISTS update_business_mode_settings_modtime ON business_mode_settings;
CREATE TRIGGER update_business_mode_settings_modtime
    BEFORE UPDATE ON business_mode_settings
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE OR REPLACE FUNCTION seed_business_mode_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO business_mode_settings (business_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_business_mode_settings ON businesses;
CREATE TRIGGER trg_seed_business_mode_settings
    AFTER INSERT ON businesses
    FOR EACH ROW EXECUTE FUNCTION seed_business_mode_settings();

INSERT INTO business_mode_settings (business_id)
SELECT id FROM businesses
ON CONFLICT (business_id) DO NOTHING;
