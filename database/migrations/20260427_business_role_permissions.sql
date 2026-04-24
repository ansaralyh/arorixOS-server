-- Workspace Roles & Permissions (server-backed policy)
-- One row per business. OWNER always has full access (not stored).
-- JSON shape: { "ADMIN": { "view_financials": true, ... }, "MANAGER": {...}, "MEMBER": {...} }
-- Omitted roles or permission keys use API defaults when merging.

CREATE TABLE IF NOT EXISTS business_role_permissions (
    business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    permissions_by_role JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(permissions_by_role) = 'object'),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_business_role_permissions_modtime ON business_role_permissions;
CREATE TRIGGER update_business_role_permissions_modtime
    BEFORE UPDATE ON business_role_permissions
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE OR REPLACE FUNCTION seed_business_role_permissions_row()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO business_role_permissions (business_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_business_role_permissions ON businesses;
CREATE TRIGGER trg_seed_business_role_permissions
    AFTER INSERT ON businesses
    FOR EACH ROW EXECUTE FUNCTION seed_business_role_permissions_row();

INSERT INTO business_role_permissions (business_id)
SELECT id FROM businesses
ON CONFLICT (business_id) DO NOTHING;
