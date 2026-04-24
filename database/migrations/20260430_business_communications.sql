-- Outbound business email (verify via Resend) + optional SMS display number

CREATE TABLE IF NOT EXISTS business_communications (
    business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    outbound_email VARCHAR(255),
    outbound_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_token_hash VARCHAR(64),
    verification_expires_at TIMESTAMPTZ,
    sms_phone VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_business_communications_modtime ON business_communications;
CREATE TRIGGER update_business_communications_modtime
    BEFORE UPDATE ON business_communications
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_communications_verification_token
    ON business_communications (verification_token_hash)
    WHERE verification_token_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION seed_business_communications_row()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO business_communications (business_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_business_communications ON businesses;
CREATE TRIGGER trg_seed_business_communications
    AFTER INSERT ON businesses
    FOR EACH ROW EXECUTE FUNCTION seed_business_communications_row();

INSERT INTO business_communications (business_id)
SELECT id FROM businesses
ON CONFLICT (business_id) DO NOTHING;
