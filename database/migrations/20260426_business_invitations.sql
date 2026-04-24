-- Teammates: pending invites + stricter membership (one OWNER per business, MANAGER role)

-- 1) Allow MANAGER on existing memberships (matches OS Teammates UI)
ALTER TABLE business_members DROP CONSTRAINT IF EXISTS business_members_role_check;
ALTER TABLE business_members ADD CONSTRAINT business_members_role_check
  CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER'));

-- 2) At most one OWNER per business (fast guard; partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_members_one_owner
  ON business_members (business_id)
  WHERE role = 'OWNER';

-- 3) Pending / historical invitations (token stored hashed only)
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

DROP TRIGGER IF EXISTS update_business_invitations_modtime ON business_invitations;
CREATE TRIGGER update_business_invitations_modtime
  BEFORE UPDATE ON business_invitations
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();
