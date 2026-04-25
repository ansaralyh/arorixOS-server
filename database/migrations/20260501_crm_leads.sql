-- CRM leads (per business). Stage is identified by stage_key within the pipeline (matches crm_pipeline_stages.stage_key).

CREATE TABLE IF NOT EXISTS crm_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    pipeline_id UUID NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    account_type TEXT NOT NULL DEFAULT 'personal' CHECK (account_type IN ('personal', 'commercial')),
    urgency TEXT CHECK (urgency IS NULL OR urgency IN ('low', 'medium', 'high')),
    last_campaign_touched_at TIMESTAMPTZ,
    last_campaign_name TEXT,
    last_campaign_channel TEXT,
    reply_status TEXT NOT NULL DEFAULT 'none' CHECK (reply_status IN ('none', 'pending', 'replied')),
    next_suggested_action TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_business ON crm_leads (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_business_owner ON crm_leads (business_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_business_pipeline_stage
    ON crm_leads (business_id, pipeline_id, stage_key);

DROP TRIGGER IF EXISTS update_crm_leads_modtime ON crm_leads;
CREATE TRIGGER update_crm_leads_modtime
    BEFORE UPDATE ON crm_leads
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();
