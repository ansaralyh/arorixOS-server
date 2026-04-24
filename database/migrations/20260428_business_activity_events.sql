-- Company Activity feed (per-tenant audit-style events)

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
