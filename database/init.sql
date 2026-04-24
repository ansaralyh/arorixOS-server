-- ==============================================================================
-- V1 SCHEMA: ARORIX OS CORE & ONBOARDING
-- Highly optimized for PostgreSQL with UUIDs, Indexes, and Data Integrity
-- ==============================================================================

-- Enable UUID extension (usually enabled by default in modern PG, but good practice)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Function to automatically update the 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ==========================================
-- 1. USERS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    
    -- Soft delete for data retention compliance
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_users_modtime ON users;
CREATE TRIGGER update_users_modtime 
    BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();


-- ==========================================
-- 1b. USER_PREFERENCES (account settings: notifications, theme flags)
-- ==========================================
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    sms_notifications BOOLEAN NOT NULL DEFAULT FALSE,
    marketing_emails BOOLEAN NOT NULL DEFAULT TRUE,
    dark_mode BOOLEAN NOT NULL DEFAULT FALSE,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_user_preferences_modtime ON user_preferences;
CREATE TRIGGER update_user_preferences_modtime
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE OR REPLACE FUNCTION seed_user_preferences_row()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_preferences (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_user_preferences ON users;
CREATE TRIGGER trg_seed_user_preferences
    AFTER INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION seed_user_preferences_row();

INSERT INTO user_preferences (user_id)
SELECT id FROM users WHERE deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;


-- ==========================================
-- 2. BUSINESSES TABLE (Tenants)
-- ==========================================
CREATE TABLE IF NOT EXISTS businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100), -- e.g., LLC, C-Corp
    industry VARCHAR(100),
    
    -- Contact & Address
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(255),
    street VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    zip_code VARCHAR(50),
    country VARCHAR(100),
    
    -- Payment & Subscription Status
    is_paid BOOLEAN DEFAULT FALSE,

    -- Compliance & formation (Phase 1 onboarding — editable in OS)
    ein VARCHAR(50),
    formation_date DATE,
    annual_report_due DATE,
    compliance_status VARCHAR(100),
    
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_businesses_modtime ON businesses;
CREATE TRIGGER update_businesses_modtime 
    BEFORE UPDATE ON businesses 
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();


-- ==========================================
-- 2b. BUSINESS_MODE_SETTINGS (tenant terminology / CRM labels)
-- One row per business. JSONB overrides apply when mode = 'custom'.
-- ==========================================
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

-- Existing databases / re-runs: ensure every business has a settings row
INSERT INTO business_mode_settings (business_id)
SELECT id FROM businesses
ON CONFLICT (business_id) DO NOTHING;


-- ==========================================
-- 2c. BUSINESS_ROLE_PERMISSIONS (workspace permission matrix per tenant)
-- OWNER is implicit full access; only ADMIN / MANAGER / MEMBER overrides are stored.
-- permissions_by_role JSONB: { "ADMIN": { "permission_key": true }, ... }
-- ==========================================
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


-- ==========================================
-- 2d. BUSINESS_ACTIVITY_EVENTS (Company Activity feed)
-- ==========================================
CREATE TABLE IF NOT EXISTS business_activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_label VARCHAR(255),
    action VARCHAR(32) NOT NULL,
    category VARCHAR(64) NOT NULL,
    item_title TEXT NOT NULL,
    details TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_activity_events_business_created
    ON business_activity_events (business_id, created_at DESC, id DESC);


-- ==========================================
-- 2e. BUSINESS_COMMUNICATIONS (verified outbound email via Resend, SMS display)
-- ==========================================
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


-- ==========================================
-- 3. BUSINESS_MEMBERS (Multi-Tenancy Join)
-- ==========================================
CREATE TABLE IF NOT EXISTS business_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER')),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- A user can only have one role per business
    CONSTRAINT uq_user_business UNIQUE(user_id, business_id)
);

-- Indexes for fast JOINs and permission checks
CREATE INDEX IF NOT EXISTS idx_business_members_user_id ON business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_business_members_business_id ON business_members(business_id);

-- At most one OWNER per business
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_members_one_owner
  ON business_members (business_id)
  WHERE role = 'OWNER';


-- ==========================================
-- 3b. BUSINESS_INVITATIONS (teammate invites)
-- ==========================================
CREATE TABLE IF NOT EXISTS business_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'MEMBER'
        CHECK (role IN ('ADMIN', 'MANAGER', 'MEMBER')),
    invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    accepted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_invitations_business_pending
  ON business_invitations (business_id)
  WHERE status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_invitations_pending_email
  ON business_invitations (business_id, lower(email))
  WHERE status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_invitations_token_hash
  ON business_invitations (token_hash);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_business_members_modtime ON business_members;
CREATE TRIGGER update_business_members_modtime 
    BEFORE UPDATE ON business_members 
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_business_invitations_modtime ON business_invitations;
CREATE TRIGGER update_business_invitations_modtime
    BEFORE UPDATE ON business_invitations
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();


-- ==========================================
-- 4. FORMATION_REQUESTS (Onboarding & Partner API)
-- ==========================================
CREATE TABLE IF NOT EXISTS formation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- State Machine for the API process
    status VARCHAR(50) DEFAULT 'PENDING_SUBMISSION' 
        CHECK (status IN ('PENDING_SUBMISSION', 'PROCESSING', 'COMPLETED', 'FAILED')),
    
    partner_order_id VARCHAR(255),
    
    -- Core Legal Data
    state_of_formation VARCHAR(100) NOT NULL,
    desired_name VARCHAR(255) NOT NULL,
    backup_name VARCHAR(255),
    
    -- JSONB for flexible Add-ons (Highly scalable for future funnel changes)
    -- e.g., {"boi_reporting": true, "operating_agmt": true, "ein_service": false}
    addons JSONB DEFAULT '{}'::jsonb,
    
    -- Fulfillment
    documents_url TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast dashboard loading and webhook lookups
CREATE INDEX IF NOT EXISTS idx_formation_requests_business_id ON formation_requests(business_id);
CREATE INDEX IF NOT EXISTS idx_formation_requests_status ON formation_requests(status);
CREATE INDEX IF NOT EXISTS idx_formation_requests_partner_order_id ON formation_requests(partner_order_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_formation_requests_modtime ON formation_requests;
CREATE TRIGGER update_formation_requests_modtime 
    BEFORE UPDATE ON formation_requests 
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();
