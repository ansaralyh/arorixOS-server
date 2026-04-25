-- Phase 3: per-lead activity log and conversation messages (tenant-scoped, cascade on lead delete)

CREATE TABLE IF NOT EXISTS crm_lead_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    activity_type VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details TEXT,
    extra JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_activities_lead
    ON crm_lead_activities (business_id, lead_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS crm_lead_conversation_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    sender TEXT NOT NULL,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('system', 'user', 'lead')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_internal BOOLEAN NOT NULL DEFAULT false,
    mentions JSONB,
    campaign_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_messages_lead
    ON crm_lead_conversation_messages (business_id, lead_id, sent_at);
