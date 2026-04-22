-- 1. Create Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create Businesses Table
CREATE TABLE IF NOT EXISTS businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100),
    industry VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(255),
    street VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    zip_code VARCHAR(50),
    country VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create Business Members (Join Table for Multi-Tenancy)
CREATE TABLE IF NOT EXISTS business_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, business_id)
);

-- 4. Create Formation Requests (Partner API Tracking)
CREATE TABLE IF NOT EXISTS formation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'PENDING_SUBMISSION' CHECK (status IN ('PENDING_SUBMISSION', 'PROCESSING', 'COMPLETED', 'FAILED')),
    partner_order_id VARCHAR(255),
    state_of_formation VARCHAR(100) NOT NULL,
    desired_name VARCHAR(255) NOT NULL,
    backup_name VARCHAR(255),
    has_boi_reporting BOOLEAN DEFAULT FALSE,
    has_operating_agmt BOOLEAN DEFAULT FALSE,
    has_ein_service BOOLEAN DEFAULT FALSE,
    documents_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Function to automatically update the updated_at column
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update updated_at
CREATE TRIGGER update_users_modtime BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_businesses_modtime BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_business_members_modtime BEFORE UPDATE ON business_members FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_formation_requests_modtime BEFORE UPDATE ON formation_requests FOR EACH ROW EXECUTE FUNCTION update_modified_column();
