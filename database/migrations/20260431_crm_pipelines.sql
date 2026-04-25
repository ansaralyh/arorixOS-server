-- CRM: pipelines and stages (per business). Leads (Phase 2) will reference stage rows by id.

CREATE TABLE IF NOT EXISTS crm_pipelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_index INTEGER NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- At most one default pipeline per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_pipelines_one_default
    ON crm_pipelines (business_id)
    WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_crm_pipelines_business ON crm_pipelines (business_id, sort_index);

CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    pipeline_id UUID NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'border-t-slate-400',
    sort_index INTEGER NOT NULL DEFAULT 0,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT crm_pipeline_stages_unique_key UNIQUE (pipeline_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_stages_pipeline ON crm_pipeline_stages (pipeline_id, sort_index);

DROP TRIGGER IF EXISTS update_crm_pipelines_modtime ON crm_pipelines;
CREATE TRIGGER update_crm_pipelines_modtime
    BEFORE UPDATE ON crm_pipelines
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_crm_pipeline_stages_modtime ON crm_pipeline_stages;
CREATE TRIGGER update_crm_pipeline_stages_modtime
    BEFORE UPDATE ON crm_pipeline_stages
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();
