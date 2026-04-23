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
-- 3. BUSINESS_MEMBERS (Multi-Tenancy Join)
-- ==========================================
CREATE TABLE IF NOT EXISTS business_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- A user can only have one role per business
    CONSTRAINT uq_user_business UNIQUE(user_id, business_id)
);

-- Indexes for fast JOINs and permission checks
CREATE INDEX IF NOT EXISTS idx_business_members_user_id ON business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_business_members_business_id ON business_members(business_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_business_members_modtime ON business_members;
CREATE TRIGGER update_business_members_modtime 
    BEFORE UPDATE ON business_members 
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
