-- Per-tenant subscription ledger (no raw card data). Payment settlement via simulation or future PSP webhooks.

CREATE TABLE IF NOT EXISTS business_billing (
    business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    plan_tier VARCHAR(32) NOT NULL DEFAULT 'plus'
        CHECK (plan_tier IN ('plus', 'growth', 'business')),
    subscription_status VARCHAR(32) NOT NULL DEFAULT 'active'
        CHECK (subscription_status IN ('active', 'trialing', 'past_due', 'canceled')),
    current_period_end DATE NOT NULL DEFAULT ((CURRENT_DATE + INTERVAL '1 month')::date),
    billing_address TEXT NOT NULL DEFAULT '',
    payment_method_brand VARCHAR(32),
    payment_method_last4 VARCHAR(4),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_business_billing_modtime ON business_billing;
CREATE TRIGGER update_business_billing_modtime
    BEFORE UPDATE ON business_billing
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE TABLE IF NOT EXISTS billing_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'usd',
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'paid', 'void')),
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_business_created
    ON billing_invoices (business_id, created_at DESC);

CREATE OR REPLACE FUNCTION seed_business_billing_row()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO business_billing (business_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_business_billing ON businesses;
CREATE TRIGGER trg_seed_business_billing
    AFTER INSERT ON businesses
    FOR EACH ROW EXECUTE FUNCTION seed_business_billing_row();

INSERT INTO business_billing (business_id)
SELECT id FROM businesses WHERE deleted_at IS NULL
ON CONFLICT (business_id) DO NOTHING;
